import { ConfigService } from '@nestjs/config';
import type { Resolver } from './fetch-guard';
import { ScrapeService } from './scrape.service';

/**
 * The redirect half of §4.1: the guard re-runs on every hop, because a public
 * URL redirecting to 127.0.0.1 is the whole attack. `fetch` is stubbed, so no
 * request leaves the machine either way.
 */

const publicResolver: Resolver = () =>
  Promise.resolve([{ address: '93.184.216.34' }]);

function html(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

function redirectTo(location: string): Response {
  // `Response.redirect` refuses non-absolute and some private URLs, so the
  // header is set by hand.
  return new Response(null, { status: 302, headers: { location } });
}

function scraperWith(responses: Record<string, Response | (() => Response)>) {
  const requested: string[] = [];
  const service = new ScrapeService(new ConfigService());
  service.resolver = publicResolver;

  const original = globalThis.fetch;
  globalThis.fetch = ((input: URL | RequestInfo) => {
    const url =
      input instanceof Request ? input.url : new URL(String(input)).toString();
    requested.push(url);
    const match = responses[url];
    if (!match)
      return Promise.resolve(new Response('missing', { status: 404 }));
    return Promise.resolve(typeof match === 'function' ? match() : match);
  }) as typeof fetch;

  return {
    service,
    requested,
    restore: () => void (globalThis.fetch = original),
  };
}

describe('ScrapeService.fetchHtml', () => {
  it('rejects a public URL that redirects to a private one', async () => {
    const { service, requested, restore } = scraperWith({
      'https://a.test/recipe': redirectTo('http://127.0.0.1:8080/admin'),
    });

    try {
      await expect(
        service.fetchHtml('https://a.test/recipe'),
      ).rejects.toMatchObject({
        status: 400,
        message: "That URL isn't reachable from the server.",
      });
      // The private hop was guarded before any request went out.
      expect(requested).toEqual(['https://a.test/recipe']);
    } finally {
      restore();
    }
  });

  it('follows an ordinary redirect and returns the final URL', async () => {
    const { service, restore } = scraperWith({
      'https://a.test/recipe': redirectTo('https://a.test/recipes/pancakes'),
      'https://a.test/recipes/pancakes': html('<p>pancakes</p>'),
    });

    try {
      const result = await service.fetchHtml('https://a.test/recipe');
      // The final URL is what resolves relative image URLs later.
      expect(result.finalUrl).toBe('https://a.test/recipes/pancakes');
    } finally {
      restore();
    }
  });

  it('gives up after three hops', async () => {
    const { service, restore } = scraperWith({
      'https://a.test/1': redirectTo('https://a.test/2'),
      'https://a.test/2': redirectTo('https://a.test/3'),
      'https://a.test/3': redirectTo('https://a.test/4'),
      'https://a.test/4': redirectTo('https://a.test/5'),
      'https://a.test/5': html('<p>too far</p>'),
    });

    try {
      await expect(service.fetchHtml('https://a.test/1')).rejects.toMatchObject(
        {
          status: 502,
        },
      );
    } finally {
      restore();
    }
  });

  it('rejects a non-HTML content type as 415', async () => {
    const { service, restore } = scraperWith({
      'https://a.test/recipe.pdf': new Response('%PDF-1.4', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    });

    try {
      await expect(
        service.fetchHtml('https://a.test/recipe.pdf'),
      ).rejects.toMatchObject({
        status: 415,
        message: "That link isn't a web page.",
      });
    } finally {
      restore();
    }
  });

  it('reports a non-2xx as 502, naming the status and host', async () => {
    const { service, restore } = scraperWith({
      'https://a.test/recipe': new Response('nope', { status: 503 }),
    });

    try {
      await expect(
        service.fetchHtml('https://a.test/recipe'),
      ).rejects.toMatchObject({
        status: 502,
        message: "Couldn't fetch that page (503 from a.test).",
      });
    } finally {
      restore();
    }
  });

  it('rejects an oversized body while streaming, on the declared length', async () => {
    const { service, restore } = scraperWith({
      'https://a.test/huge': html('<p>x</p>', {
        'content-length': String(6 * 1024 * 1024),
      }),
    });

    try {
      await expect(
        service.fetchHtml('https://a.test/huge'),
      ).rejects.toMatchObject({
        status: 413,
      });
    } finally {
      restore();
    }
  });

  it('never leaves the machine for a blocked scheme', async () => {
    const { service, requested, restore } = scraperWith({});

    try {
      await expect(
        service.fetchHtml('file:///etc/passwd'),
      ).rejects.toMatchObject({
        status: 400,
        message: "That doesn't look like a web address.",
      });
      expect(requested).toEqual([]);
    } finally {
      restore();
    }
  });
});
