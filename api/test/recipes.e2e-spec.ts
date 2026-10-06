import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DiscoveryService } from '../src/apps/recipes/discovery.service';
import { ExtractionService } from '../src/apps/recipes/extraction.service';
import { ANTHROPIC } from '../src/apps/recipes/anthropic.provider';
import { ScrapeService } from '../src/apps/recipes/scrape.service';
import { DRIZZLE } from '../src/database/database.constants';
import type { DrizzleDB } from '../src/database/database.types';
import { recipeSettings, recipes } from '../src/database/schema';
import { assertTestDatabase } from './test-database';

/**
 * find → get → patch → delete against the real database, with both model stages
 * stubbed (§11.3: no test may call the Anthropic API).
 *
 * Runs against the `_test` database (see setup-env.ts), which needs the
 * migrations applied — never the dev one: it deletes every row between tests.
 */

// The module refuses to boot without a key (§10); the stubs mean it is unused.
process.env.ANTHROPIC_API_KEY ??= 'test-key-not-used';

const candidate = {
  url: 'https://example.test/pancakes',
  site_name: 'Example',
  title: 'Fluffy Pancakes',
  why: 'a single recipe with an ingredient list and numbered steps',
};

const extracted = {
  is_recipe: true,
  rejection_reason: null,
  title: 'Fluffy Buttermilk Pancakes',
  description: 'Tall, tender, and ten minutes start to finish.',
  ingredients: [
    {
      heading: null,
      items: ['1 1/2 cups all-purpose flour', '1 1/4 cups buttermilk'],
    },
  ],
  steps: ['Whisk the dry ingredients together.', 'Cook on a buttered griddle.'],
  notes: ['Rest the batter five minutes for a taller pancake.'],
  origin: null,
  servings: 4,
  yield_text: null,
  prep_minutes: 5,
  cook_minutes: 10,
  total_minutes: 15,
  image_url: null,
};

/** Stands in for stage 1. Returns a URL and nothing else, as the real one does. */
const discoveryStub = {
  discover: () =>
    Promise.resolve({
      interpretedAs: 'homemade buttermilk pancakes',
      candidates: [candidate],
      fetchedText: new Map<string, string>(),
    }),
};

/** The fetch, so the suite makes no network request of its own either. */
const scrapeStub = {
  scrape: (url: string) =>
    Promise.resolve({
      page: {
        text: 'Ingredients\n- 1 1/2 cups all-purpose flour\nSteps\n1. Whisk.',
        title: 'Fluffy Pancakes',
        ogImageUrl: null,
        siteName: 'Example',
        canonicalUrl: url,
      },
      fetched: { html: '', bytes: 512, ms: 20, finalUrl: url },
    }),
};

/** Stands in for stage 2, so nothing in this suite touches the network. */
const extractionStub = {
  extract: () => Promise.resolve({ ok: true as const, recipe: extracted }),
};

describe('/recipes', () => {
  let app: INestApplication;
  let db: DrizzleDB;

  beforeAll(async () => {
    Logger.overrideLogger([]);
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ANTHROPIC)
      .useValue({})
      .overrideProvider(DiscoveryService)
      .useValue(discoveryStub)
      .overrideProvider(ScrapeService)
      .useValue(scrapeStub)
      .overrideProvider(ExtractionService)
      .useValue(extractionStub)
      .compile();

    app = mod.createNestApplication();
    await app.init();
    db = mod.get<DrizzleDB>(DRIZZLE);
    await assertTestDatabase(db);
  });

  afterEach(async () => {
    await db.delete(recipes);
    await db.delete(recipeSettings);
  });

  afterAll(async () => {
    await app.close();
    Logger.overrideLogger(console);
  });

  it('walks find → get → patch → delete', async () => {
    const found = await request(app.getHttpServer())
      .post('/recipes/find')
      .send({ request: 'give me a homemade pancakes recipe' })
      .expect(201);

    expect(found.body).toMatchObject({
      interpretedAs: 'homemade buttermilk pancakes',
      why: candidate.why,
      // One candidate, so no runners-up to offer.
      alternates: [],
      recipe: {
        title: 'Fluffy Buttermilk Pancakes',
        servings: 4,
        totalMinutes: 15,
        hasImage: false,
        requestText: 'give me a homemade pancakes recipe',
      },
    });

    const { id } = found.body.recipe as { id: number };

    const fetched = await request(app.getHttpServer())
      .get(`/recipes/${id}`)
      .expect(200);
    expect(fetched.body.ingredients).toEqual(extracted.ingredients);
    expect(fetched.body.steps).toEqual(extracted.steps);

    const listed = await request(app.getHttpServer())
      .get('/recipes')
      .expect(200);
    expect(listed.body).toEqual([
      {
        id,
        title: 'Fluffy Buttermilk Pancakes',
        description: extracted.description,
        origin: null,
        totalMinutes: 15,
        hasImage: false,
        ingredientText: extracted.ingredients[0].items,
      },
    ]);

    const patched = await request(app.getHttpServer())
      .patch(`/recipes/${id}`)
      .send({ title: 'Sunday Pancakes', notes: [] })
      .expect(200);
    expect(patched.body.title).toBe('Sunday Pancakes');
    expect(patched.body.notes).toEqual([]);
    // Fields not in the PATCH are untouched. Edits overwrite; there is no history.
    expect(patched.body.steps).toEqual(extracted.steps);

    await request(app.getHttpServer()).delete(`/recipes/${id}`).expect(204);
    await request(app.getHttpServer()).get(`/recipes/${id}`).expect(404);
  });

  it('rejects a non-numeric :id before reaching the service', async () => {
    // ParseIntPipe, so this is a 400 rather than a 404 or a bad query.
    await request(app.getHttpServer()).get('/recipes/pancakes').expect(400);
  });

  it('rejects an empty request with the copy from §7.3', async () => {
    const res = await request(app.getHttpServer())
      .post('/recipes/find')
      .send({ request: '   ' })
      .expect(400);
    expect(res.body.message).toBe("Tell me what you'd like to cook.");
  });

  it('saves a hand-entered recipe', async () => {
    const res = await request(app.getHttpServer())
      .post('/recipes')
      .send({ title: 'Grandma’s Soda Bread', steps: ['Mix.', 'Bake.'] })
      .expect(201);

    expect(res.body).toMatchObject({
      title: 'Grandma’s Soda Bread',
      steps: ['Mix.', 'Bake.'],
      ingredients: [],
      requestText: null,
    });
  });

  it('answers with empty settings before anything has been saved', async () => {
    // The migration creates the table, not the row.
    const res = await request(app.getHttpServer())
      .get('/recipes/settings')
      .expect(200);
    expect(res.body).toEqual({ preferences: [], updatedAt: null });
  });

  it('saves the standing preferences and reads them back', async () => {
    const saved = await request(app.getHttpServer())
      .put('/recipes/settings')
      .send({
        preferences: ['No tree nuts', '  ', ' I only have a microwave '],
      })
      .expect(200);

    // Blank entries dropped, surrounding space trimmed.
    expect(saved.body.preferences).toEqual([
      'No tree nuts',
      'I only have a microwave',
    ]);
    expect(saved.body.updatedAt).toEqual(expect.any(String));

    const read = await request(app.getHttpServer())
      .get('/recipes/settings')
      .expect(200);
    expect(read.body.preferences).toEqual(saved.body.preferences);

    // A second PUT replaces the list rather than appending to it.
    const replaced = await request(app.getHttpServer())
      .put('/recipes/settings')
      .send({ preferences: ['Nothing spicy'] })
      .expect(200);
    expect(replaced.body.preferences).toEqual(['Nothing spicy']);
  });

  it('rejects more preferences than the prompt should carry', async () => {
    const res = await request(app.getHttpServer())
      .put('/recipes/settings')
      .send({ preferences: Array.from({ length: 21 }, (_, i) => `rule ${i}`) })
      .expect(400);
    expect(res.body.message).toBe('Keep it to 20 preferences or fewer.');
  });

  it('404s an image that was never downloaded', async () => {
    const created = await request(app.getHttpServer())
      .post('/recipes')
      .send({ title: 'No Picture' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/recipes/${created.body.id}/image`)
      .expect(404);
  });
});
