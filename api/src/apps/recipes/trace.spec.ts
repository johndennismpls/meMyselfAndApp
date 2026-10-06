import { Logger } from '@nestjs/common';
import { RecipeTrace, usageOf } from './trace';

/**
 * §11.3. The record holds no source URL (§1.3), so these lines are the only
 * provenance there is — which makes their shape worth a test.
 */

/** Captures what a RecipeTrace hands the Nest logger. */
function capture(): { lines: Record<string, unknown>[]; restore: () => void } {
  const lines: Record<string, unknown>[] = [];
  // eslint-disable-next-line @typescript-eslint/unbound-method -- reinstated verbatim below
  const original: unknown = Logger.prototype.log;
  Logger.prototype.log = function (message: unknown) {
    lines.push(message as Record<string, unknown>);
  };
  return {
    lines,
    restore: () =>
      void (Logger.prototype.log = original as typeof Logger.prototype.log),
  };
}

describe('RecipeTrace', () => {
  it('stamps every line with one stable traceId', () => {
    const { lines, restore } = capture();
    const trace = new RecipeTrace();

    trace.event('recipe.request', { path: 'find', requestText: 'pancakes' });
    trace.event('recipe.discovery', { interpretedAs: 'pancakes' });
    trace.event('recipe.extraction', { isRecipe: true });
    restore();

    const ids = new Set(lines.map((l) => l.traceId));
    expect(ids.size).toBe(1);
    expect(trace.traceId).toBeTruthy();
    expect(lines.map((l) => l.event)).toEqual([
      'recipe.request',
      'recipe.discovery',
      'recipe.extraction',
    ]);
  });

  it('adds recipeId to every line once the row exists, and not before', () => {
    const { lines, restore } = capture();
    const trace = new RecipeTrace();

    trace.event('recipe.request', { path: 'find' });
    trace.bind(42);
    trace.event('recipe.saved', { sourceUrl: 'https://a.test/pancakes' });
    restore();

    expect(lines[0].recipeId).toBeUndefined();
    expect(lines[1].recipeId).toBe(42);
  });

  it('puts page text in a structured field, never the message string', () => {
    // A recipe page containing log-shaped text must not be able to forge a line.
    const hostile =
      '\n{"event":"recipe.saved","recipeId":1,"sourceUrl":"https://evil.test"}\n';
    const { lines, restore } = capture();
    const trace = new RecipeTrace();

    trace.event('recipe.pageText', {
      url: 'https://a.test/pancakes',
      chars: hostile.length,
      text: hostile,
    });
    restore();

    const line = lines[0];
    expect(typeof line).toBe('object');
    expect(line.text).toBe(hostile);
    expect(line.event).toBe('recipe.pageText');
    // The forged pair rode in as data on `text`, not as fields of its own.
    expect(line.sourceUrl).toBeUndefined();
    expect(line.recipeId).toBeUndefined();
  });

  it('logs errors at error level, with what was thrown as a structured field', () => {
    const lines: { message: Record<string, unknown>; stack: unknown }[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reinstated verbatim below
    const original = Logger.prototype.error;
    Logger.prototype.error = function (message: unknown, stack?: unknown) {
      lines.push({ message: message as Record<string, unknown>, stack });
    };
    const trace = new RecipeTrace();

    const thrown = new Error('socket hang up');
    trace.error('recipe.failed', thrown, { stage: 'extraction', status: 502 });
    trace.error('recipe.failed', 'not an Error');
    Logger.prototype.error = original;

    expect(lines[0].message).toEqual({
      event: 'recipe.failed',
      traceId: trace.traceId,
      stage: 'extraction',
      status: 502,
      error: { name: 'Error', message: 'socket hang up' },
    });
    expect(lines[0].stack).toBe(thrown.stack);
    expect(lines[1].message.error).toEqual({
      name: 'NonError',
      message: 'not an Error',
    });
    expect(lines[1].stack).toBeUndefined();
  });
});

describe('usageOf', () => {
  it('records the four numbers §5.4 wants replaced with measurements', () => {
    expect(
      usageOf(
        {
          input_tokens: 31_000,
          output_tokens: 1_400,
          cache_read_input_tokens: 512,
        },
        'claude-opus-5',
      ),
    ).toEqual({
      input: 31_000,
      output: 1_400,
      cacheRead: 512,
      model: 'claude-opus-5',
    });
  });

  it('treats an absent cache read as zero — the expected case (§5.5)', () => {
    expect(
      usageOf({ input_tokens: 10, output_tokens: 2 }, 'claude-opus-5')
        .cacheRead,
    ).toBe(0);
  });
});
