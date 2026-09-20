import { BadGatewayException, Logger } from '@nestjs/common';
import type { DrizzleDB } from '../../database/database.types';
import type { DiscoveryService, DiscoveryResult } from './discovery.service';
import type { Candidate } from './discovery.schema';
import type { ExtractionService } from './extraction.service';
import type { ExtractedRecipe } from './extraction.schema';
import type { ImageService } from './image.service';
import { RecipesService } from './recipes.service';
import type { CleanedPage, ScrapeService } from './scrape.service';
import { RecipeTrace } from './trace';

/**
 * The §7.1 walk. Every collaborator is a stub — this is about which candidate
 * wins and what happens when one doesn't, not about the network.
 */

const candidates: Candidate[] = [
  {
    url: 'https://one.test/pancakes',
    site_name: 'One',
    title: 'Pancakes',
    why: 'first',
  },
  {
    url: 'https://two.test/pancakes',
    site_name: 'Two',
    title: 'Pancakes',
    why: 'second',
  },
  {
    url: 'https://three.test/pancakes',
    site_name: 'Three',
    title: 'Pancakes',
    why: 'third',
  },
];

const recipe: ExtractedRecipe = {
  is_recipe: true,
  rejection_reason: null,
  title: 'Fluffy Pancakes',
  description: null,
  ingredients: [{ heading: null, items: ['1 cup flour'] }],
  steps: ['Mix.'],
  notes: [],
  origin: null,
  servings: 4,
  yield_text: null,
  prep_minutes: null,
  cook_minutes: null,
  total_minutes: 20,
  image_url: null,
};

const page: CleanedPage = {
  text: 'a'.repeat(500),
  title: 'Pancakes',
  ogImageUrl: null,
  siteName: 'Example',
  canonicalUrl: null,
};

/** A minimal insert().values().returning() chain over one fake row. */
function fakeDb(): DrizzleDB {
  let nextId = 1;
  return {
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: () =>
          Promise.resolve([
            {
              ...row,
              id: nextId++,
              imageFilename: row.imageFilename ?? null,
              imageMimeType: row.imageMimeType ?? null,
              createdAt: new Date('2026-09-20T00:00:00Z'),
              updatedAt: new Date('2026-09-20T00:00:00Z'),
            },
          ]),
      }),
    }),
  } as unknown as DrizzleDB;
}

interface Stubs {
  /** Per-URL behaviour for the fetch+clean step. */
  scrape: Record<string, 'ok' | 'fail'>;
  /** Per-URL behaviour for the extraction step. */
  extract: Record<string, 'recipe' | 'not-a-recipe'>;
  /** Page text web_fetch already pulled, for the §4.3 fallback. */
  fetchedText?: Map<string, string>;
}

function build(stubs: Stubs) {
  const scraped: string[] = [];
  const extracted: string[] = [];

  const discovery = {
    discover: (): Promise<DiscoveryResult> =>
      Promise.resolve({
        interpretedAs: 'homemade pancakes',
        candidates,
        fetchedText: stubs.fetchedText ?? new Map(),
      }),
  } as unknown as DiscoveryService;

  const scraper = {
    scrape: (url: string) => {
      scraped.push(url);
      if (stubs.scrape[url] === 'fail') {
        return Promise.reject(
          new BadGatewayException(
            "Couldn't fetch that page (403 from example.com).",
          ),
        );
      }
      return Promise.resolve({
        page,
        fetched: { html: '', bytes: 500, ms: 12, finalUrl: url },
      });
    },
  } as unknown as ScrapeService;

  const extraction = {
    extract: (_page: CleanedPage, url: string) => {
      extracted.push(url);
      if (stubs.extract[url] === 'not-a-recipe') {
        return Promise.resolve({
          ok: false as const,
          rejectionReason: 'This is a roundup, not a recipe.',
        });
      }
      return Promise.resolve({ ok: true as const, recipe });
    },
  } as unknown as ExtractionService;

  const images = {
    download: () => Promise.resolve(null),
    remove: () => Promise.resolve(),
  } as unknown as ImageService;

  const service = new RecipesService(
    fakeDb(),
    discovery,
    scraper,
    extraction,
    images,
    new RecipeTrace(),
  );

  return { service, scraped, extracted };
}

// The walk logs every attempt (§6.4); the failures here are expected, not noise.
beforeAll(() => Logger.overrideLogger([]));
afterAll(() => Logger.overrideLogger(console));

describe('RecipesService.find — the candidate walk', () => {
  it('takes the first candidate when it works', async () => {
    const { service, scraped } = build({
      scrape: {},
      extract: {},
    });

    const result = await service.find('give me a homemade pancakes recipe');

    expect(scraped).toEqual(['https://one.test/pancakes']);
    expect(result.recipe.title).toBe('Fluffy Pancakes');
    expect(result.interpretedAs).toBe('homemade pancakes');
    expect(result.why).toBe('first');
    // The runners-up come back, so "try a different source" costs no second
    // discovery call (§3.6).
    expect(result.alternates.map((a) => a.url)).toEqual([
      'https://two.test/pancakes',
      'https://three.test/pancakes',
    ]);
  });

  it('moves on when the first candidate 403s', async () => {
    const { service, scraped, extracted } = build({
      scrape: { 'https://one.test/pancakes': 'fail' },
      extract: {},
    });

    const result = await service.find('pancakes');

    expect(scraped).toEqual([
      'https://one.test/pancakes',
      'https://two.test/pancakes',
    ]);
    // A page we never fetched is never extracted from.
    expect(extracted).toEqual(['https://two.test/pancakes']);
    expect(result.why).toBe('second');
  });

  it('moves on when the first candidate is not a recipe', async () => {
    const { service, extracted } = build({
      scrape: {},
      extract: { 'https://one.test/pancakes': 'not-a-recipe' },
    });

    const result = await service.find('pancakes');

    expect(extracted).toEqual([
      'https://one.test/pancakes',
      'https://two.test/pancakes',
    ]);
    expect(result.why).toBe('second');
  });

  it('falls back to the web_fetch text when all three fail our own fetch', async () => {
    // Cloudflare 403s us on pages Anthropic's web_fetch reached comfortably.
    const { service, extracted } = build({
      scrape: {
        'https://one.test/pancakes': 'fail',
        'https://two.test/pancakes': 'fail',
        'https://three.test/pancakes': 'fail',
      },
      extract: {},
      fetchedText: new Map([['two.test/pancakes', 'b'.repeat(900)]]),
    });

    const result = await service.find('pancakes');

    // All three attempted directly, then the one page web_fetch actually held.
    expect(extracted).toEqual(['https://two.test/pancakes']);
    expect(result.why).toBe('second');
  });

  it('422s when every candidate fails and there is no fallback text', async () => {
    const { service } = build({
      scrape: {
        'https://one.test/pancakes': 'fail',
        'https://two.test/pancakes': 'fail',
        'https://three.test/pancakes': 'fail',
      },
      extract: {},
    });

    await expect(service.find('pancakes')).rejects.toMatchObject({
      status: 422,
      message: "Couldn't find that one online.",
    });
  });

  it('stores what you typed, for the deferred "more like this"', async () => {
    const { service } = build({ scrape: {}, extract: {} });
    const result = await service.find('give me a homemade pancakes recipe');
    expect(result.recipe.requestText).toBe(
      'give me a homemade pancakes recipe',
    );
  });
});

describe('RecipesService.scrape — the pasted-URL path', () => {
  it('surfaces is_recipe: false as the model’s own rejection', async () => {
    const { service } = build({
      scrape: {},
      extract: { 'https://one.test/pancakes': 'not-a-recipe' },
    });

    await expect(
      service.scrape('https://one.test/pancakes'),
    ).rejects.toMatchObject({
      status: 422,
      message: 'This is a roundup, not a recipe.',
    });
  });

  it('records no requestText — there was no request', async () => {
    const { service } = build({ scrape: {}, extract: {} });
    const result = await service.scrape('https://one.test/pancakes');
    expect(result.requestText).toBeNull();
  });
});
