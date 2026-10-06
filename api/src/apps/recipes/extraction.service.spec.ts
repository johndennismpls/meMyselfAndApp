import { Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeRepository } from './claude.repository';
import { ExtractionService } from './extraction.service';
import { EXTRACTION_SYSTEM } from './extraction.prompt';
import type { CleanedPage } from './scrape.service';
import { RecipeTrace } from './trace';

/**
 * §11.3, stubbed client. No test may call the Anthropic API — a real call in CI
 * is a bill and a flake.
 */

const page: CleanedPage = {
  text: 'Ingredients\n- 1 cup flour\nSteps\n1. Mix.',
  title: 'Fluffy Pancakes',
  ogImageUrl: 'https://a.test/hero.jpg',
  siteName: 'Example',
  canonicalUrl: 'https://a.test/pancakes',
};

const goodRecipe = {
  is_recipe: true,
  rejection_reason: null,
  title: 'Fluffy Pancakes',
  description: 'Tall and tender.',
  ingredients: [{ heading: null, items: ['1 cup all-purpose flour'] }],
  steps: ['Mix the dry ingredients.'],
  notes: [],
  origin: null,
  servings: 4,
  yield_text: null,
  prep_minutes: 10,
  cook_minutes: 10,
  total_minutes: 20,
  image_url: 'https://a.test/hero.jpg',
};

const usage = {
  input_tokens: 4000,
  output_tokens: 900,
  cache_read_input_tokens: 0,
};

/**
 * Hand-rolled rather than jest.fn(): this suite runs as ESM, where the `jest`
 * global is not injected.
 */
function serviceWith(response: unknown): {
  service: ExtractionService;
  calls: Record<string, unknown>[];
} {
  const calls: Record<string, unknown>[] = [];
  const parse = (params: Record<string, unknown>) => {
    calls.push(params);
    if (typeof response === 'function') return (response as () => never)();
    return Promise.resolve(response);
  };
  const client = { messages: { parse } } as unknown as Anthropic;
  return {
    service: new ExtractionService(
      new ClaudeRepository(client),
      new RecipeTrace(),
    ),
    calls,
  };
}

// Extraction emits its §6.4 events; trace.spec.ts is where their shape is tested.
beforeAll(() => Logger.overrideLogger([]));
afterAll(() => Logger.overrideLogger(console));

describe('ExtractionService', () => {
  it('returns the recipe on a good response', async () => {
    const { service } = serviceWith({
      stop_reason: 'end_turn',
      usage,
      parsed_output: goodRecipe,
      content: [],
    });

    const result = await service.extract(page, 'https://a.test/pancakes');

    expect(result).toEqual({ ok: true, recipe: goodRecipe });
  });

  it('reports is_recipe: false as a value, not an error', async () => {
    // /recipes/find moves to the next candidate rather than failing outright,
    // so this is a return value here and a 422 only at the controller edge.
    const { service } = serviceWith({
      stop_reason: 'end_turn',
      usage,
      parsed_output: {
        ...goodRecipe,
        is_recipe: false,
        rejection_reason: 'This page is a roundup of 23 pancake recipes.',
      },
      content: [],
    });

    const result = await service.extract(page, 'https://a.test/roundup');

    expect(result).toEqual({
      ok: false,
      rejectionReason: 'This page is a roundup of 23 pancake recipes.',
    });
  });

  it('maps a refusal to 422 without reading content', async () => {
    const { service } = serviceWith({
      stop_reason: 'refusal',
      usage,
      // Deliberately absent: the refusal must be checked first.
      get parsed_output(): never {
        throw new Error('content read before the refusal check');
      },
      content: [],
    });

    await expect(
      service.extract(page, 'https://a.test/x'),
    ).rejects.toMatchObject({
      status: 422,
      message: "Couldn't extract a recipe from that page.",
    });
  });

  it('maps a null parsed_output to 502 rather than crashing', async () => {
    const { service } = serviceWith({
      stop_reason: 'end_turn',
      usage,
      parsed_output: null,
      content: [],
    });

    await expect(
      service.extract(page, 'https://a.test/x'),
    ).rejects.toMatchObject({
      status: 502,
      message: 'The extraction service failed. Try again.',
    });
  });

  it('maps an SDK throw to 502', async () => {
    const { service } = serviceWith(() => {
      throw new Error('socket hang up');
    });

    await expect(
      service.extract(page, 'https://a.test/x'),
    ).rejects.toMatchObject({
      status: 502,
    });
  });

  it('sends no tools, and never the user request', async () => {
    const { service, calls } = serviceWith({
      stop_reason: 'end_turn',
      usage,
      parsed_output: goodRecipe,
      content: [],
    });

    await service.extract(page, 'https://a.test/pancakes');
    const params = calls[0];

    // Stage 2 has no business touching the network (§5.3).
    expect(params.tools).toBeUndefined();
    // The §1.1 guarantee: there is nothing in this call to fabricate toward.
    expect(JSON.stringify(params)).not.toContain('pancakes recipe');
    expect(params.output_config).toMatchObject({ effort: 'low' });
    expect(params.thinking).toEqual({ type: 'adaptive' });
  });

  it('keeps the system prompt a stable cache prefix', () => {
    // No interpolation: page content lives in the user turn, where it is data.
    expect(EXTRACTION_SYSTEM).not.toContain('${');
    expect(EXTRACTION_SYSTEM).toContain('Never invent a value');
  });
});
