import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cheerio from 'cheerio';
import {
  guardUrl,
  pinnedDispatcher,
  MAX_REDIRECTS,
  type Resolver,
} from './fetch-guard';

export interface CleanedPage {
  text: string;
  title: string | null;
  ogImageUrl: string | null;
  siteName: string | null;
  canonicalUrl: string | null;
}

/** What the fetch produced, for the `recipe.fetch` trace event. */
export interface FetchOutcome {
  html: string;
  bytes: number;
  ms: number;
  /** The URL we ended on, after redirects. Resolves relative image URLs. */
  finalUrl: string;
}

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MIN_TEXT_CHARS = 200;

/** Definitely chrome. A whitelist strip keeps everything else (§4.2). */
const STRIP = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'form',
  'button',
  'nav',
  'header',
  'footer',
  'aside[role=complementary]',
].join(',');

/** Elements whose boundaries become newlines in the text rendering. */
const BLOCK =
  'address,article,blockquote,br,div,dd,dl,dt,fieldset,figcaption,figure,h1,h2,h3,h4,h5,h6,hr,li,main,ol,p,pre,section,table,tr,td,th,ul';

@Injectable()
export class ScrapeService {
  private readonly timeoutMs: number;
  private readonly maxPageChars: number;

  /**
   * Overridable so tests can exercise the redirect walk without DNS. Not a
   * constructor parameter: Nest cannot resolve a bare function type.
   */
  resolver: Resolver | undefined;

  constructor(config: ConfigService) {
    this.timeoutMs = config.get<number>('RECIPE_FETCH_TIMEOUT_MS', 10_000);
    this.maxPageChars = config.get<number>('RECIPE_MAX_PAGE_CHARS', 250_000);
  }

  /**
   * Fetch one URL through the guard, following redirects by hand so the guard
   * re-runs on every hop. A discovered URL gets no more trust than a pasted one.
   */
  async fetchHtml(rawUrl: string): Promise<FetchOutcome> {
    const started = Date.now();
    let current = rawUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const guard = await guardUrl(current, this.resolver);
      if (!guard.ok) {
        if (guard.reason === 'malformed' || guard.reason === 'scheme') {
          throw new BadRequestException(
            "That doesn't look like a web address.",
          );
        }
        throw new BadRequestException(
          "That URL isn't reachable from the server.",
        );
      }

      // Pinned so the connection actually goes to the address the guard just
      // checked, not whatever `fetch` re-resolves the hostname to a moment later.
      const dispatcher = pinnedDispatcher(guard.addresses);
      try {
        let response: Response;
        try {
          response = await fetch(guard.url, {
            redirect: 'manual',
            signal: AbortSignal.timeout(this.timeoutMs),
            dispatcher,
            headers: {
              // Some sites 403 a bare fetch. An honest UA gets further than none.
              'user-agent':
                'Mozilla/5.0 (compatible; meMyselfAndApp recipe box/0.1)',
              accept: 'text/html,application/xhtml+xml',
            },
          } as RequestInit);
        } catch {
          throw new BadGatewayException(
            `Couldn't fetch that page (no response from ${guard.url.hostname}).`,
          );
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new BadGatewayException(
              `Couldn't fetch that page (${response.status} from ${guard.url.hostname}).`,
            );
          }
          current = new URL(location, guard.url).toString();
          continue;
        }

        if (!response.ok) {
          throw new BadGatewayException(
            `Couldn't fetch that page (${response.status} from ${guard.url.hostname}).`,
          );
        }

        const contentType = response.headers.get('content-type') ?? '';
        const mime = contentType.split(';')[0].trim().toLowerCase();
        if (mime !== 'text/html' && mime !== 'application/xhtml+xml') {
          throw new UnsupportedMediaTypeException(
            "That link isn't a web page.",
          );
        }

        const html = await readCapped(response, MAX_HTML_BYTES);
        return {
          html,
          bytes: Buffer.byteLength(html),
          ms: Date.now() - started,
          finalUrl: guard.url.toString(),
        };
      } finally {
        await dispatcher.close();
      }
    }

    throw new BadGatewayException(
      "Couldn't fetch that page (too many redirects).",
    );
  }

  /**
   * Strip chrome, keep everything else, render to text. cheerio rather than a
   * readability port: recipe pages routinely park the ingredient list in a
   * sidebar that readability heuristics discard.
   */
  clean(html: string): CleanedPage {
    const $ = cheerio.load(html);

    // Captured before the strip, since <title> lives inside <head> and the meta
    // tags would survive anyway — but canonical/og are easier to read up front.
    const title =
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      null;
    const ogImageUrl =
      $('meta[property="og:image"]').attr('content')?.trim() || null;
    const siteName =
      $('meta[property="og:site_name"]').attr('content')?.trim() || null;
    const canonicalUrl =
      $('link[rel="canonical"]').attr('href')?.trim() || null;

    $(STRIP).remove();
    $('*')
      .contents()
      .filter((_, node) => node.type === 'comment')
      .remove();

    // Block boundaries become newlines; list items get a leading "- " so the
    // model reads an ingredient list as a list rather than a run-on sentence.
    $('li').each((_, el) => {
      $(el).prepend('- ');
    });
    $(BLOCK).each((_, el) => {
      $(el).append('\n');
      $(el).prepend('\n');
    });

    const text = ($('body').length ? $('body').text() : $.root().text())
      .replace(/\r/g, '')
      .replace(/[ \t ]+/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { text, title, ogImageUrl, siteName, canonicalUrl };
  }

  /**
   * No silent truncation (§4.2). A quarter-million characters isn't a recipe
   * page and shouldn't be quietly half-fed to the model.
   */
  assertUsable(page: CleanedPage): void {
    if (page.text.length > this.maxPageChars) {
      throw new PayloadTooLargeException('That page is too large to process.');
    }
    if (page.text.length < MIN_TEXT_CHARS) {
      throw new UnprocessableEntityException(
        'That page had no readable text — it may need JavaScript to render.',
      );
    }
  }

  /** The whole path for one URL: guard, fetch, clean, check. */
  async scrape(
    url: string,
  ): Promise<{ page: CleanedPage; fetched: FetchOutcome }> {
    const fetched = await this.fetchHtml(url);
    const page = this.clean(fetched.html);
    this.assertUsable(page);
    return { page, fetched };
  }
}

/** Enforces the size cap while streaming, not after. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new PayloadTooLargeException('That page is too large to process.');
  }

  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeException('That page is too large to process.');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString('utf8');
}
