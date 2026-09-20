import type Anthropic from '@anthropic-ai/sdk';
import type { Candidate } from './discovery.schema';
import { assertGrounded, fetchedPageText, normaliseUrl } from './grounding';

/**
 * §11.3 calls this the important one: it is the difference between a stated
 * policy ("never write a URL from memory") and an enforced one.
 */

function candidate(url: string): Candidate {
  return { url, site_name: 'Example', title: 'Pancakes', why: 'a recipe' };
}

function searchResult(...urls: string[]): Anthropic.ContentBlock {
  return {
    type: 'web_search_tool_result',
    tool_use_id: 'srvtoolu_1',
    caller: { type: 'direct' },
    content: urls.map((url) => ({
      type: 'web_search_result',
      url,
      title: 'Pancakes',
      page_age: null,
      encrypted_content: 'opaque',
    })),
  } as unknown as Anthropic.ContentBlock;
}

function searchError(): Anthropic.ContentBlock {
  // Tool errors arrive as HTTP 200 with an error OBJECT where the list would be.
  return {
    type: 'web_search_tool_result',
    tool_use_id: 'srvtoolu_2',
    caller: { type: 'direct' },
    content: {
      type: 'web_search_tool_result_error',
      error_code: 'max_uses_exceeded',
    },
  } as unknown as Anthropic.ContentBlock;
}

function fetchResult(url: string, text: string): Anthropic.ContentBlock {
  return {
    type: 'web_fetch_tool_result',
    tool_use_id: 'srvtoolu_3',
    caller: { type: 'direct' },
    content: {
      type: 'web_fetch_result',
      url,
      retrieved_at: '2026-09-20T00:00:00Z',
      content: {
        type: 'document',
        title: 'Pancakes',
        citations: null,
        source: { type: 'text', media_type: 'text/plain', data: text },
      },
    },
  } as unknown as Anthropic.ContentBlock;
}

describe('normaliseUrl', () => {
  it('matches across www, trailing slash, scheme, and tracking params', () => {
    const forms = [
      'https://www.seriouseats.com/pancakes/',
      'http://seriouseats.com/pancakes',
      'https://seriouseats.com/pancakes?utm_source=pinterest&utm_medium=social',
      'https://www.seriouseats.com/pancakes/?fbclid=abc',
    ];
    const keys = new Set(forms.map(normaliseUrl));
    expect(keys).toEqual(new Set(['seriouseats.com/pancakes']));
  });

  it('keeps different paths on the same host apart', () => {
    expect(normaliseUrl('https://a.test/pancakes')).not.toBe(
      normaliseUrl('https://a.test/waffles'),
    );
  });

  it('returns null for an unparseable URL', () => {
    expect(normaliseUrl('not a url')).toBeNull();
  });
});

describe('assertGrounded', () => {
  it('drops a candidate that never appeared in a tool result', () => {
    const content = [searchResult('https://a.test/pancakes')];
    const result = assertGrounded(content, [
      candidate('https://a.test/pancakes'),
      // Plausible, real-looking, and never searched for. This is the failure
      // the whole check exists to catch.
      candidate('https://www.seriouseats.com/the-best-pancakes-recipe'),
    ]);

    expect(result.searched).toBe(true);
    expect(result.kept.map((c) => c.url)).toEqual(['https://a.test/pancakes']);
    expect(result.dropped.map((c) => c.url)).toEqual([
      'https://www.seriouseats.com/the-best-pancakes-recipe',
    ]);
  });

  it('fails closed when no tool result block is present at all', () => {
    // No search ran, so every candidate was written from memory — regardless of
    // how good they look.
    const content = [
      {
        type: 'text',
        text: 'Here are three great pancake recipes.',
        citations: null,
      },
    ] as unknown as Anthropic.ContentBlock[];

    const result = assertGrounded(content, [
      candidate('https://a.test/pancakes'),
    ]);

    expect(result.searched).toBe(false);
    expect(result.kept).toEqual([]);
  });

  it('treats a search error as an empty observed set rather than throwing', () => {
    const result = assertGrounded(
      [searchError()],
      [candidate('https://a.test/pancakes')],
    );
    expect(result.searched).toBe(false);
    expect(result.kept).toEqual([]);
  });

  it('accepts a candidate grounded only by web_fetch', () => {
    const result = assertGrounded(
      [fetchResult('https://a.test/pancakes', 'ingredients...')],
      [candidate('https://www.a.test/pancakes/')],
    );
    expect(result.kept).toHaveLength(1);
  });

  it('normalises both sides before comparing', () => {
    const result = assertGrounded(
      [searchResult('http://www.a.test/pancakes/?utm_source=x')],
      [candidate('https://a.test/pancakes')],
    );
    expect(result.kept).toHaveLength(1);
  });
});

describe('fetchedPageText', () => {
  it('keys the web_fetch text by normalised URL, for the §4.3 fallback', () => {
    const texts = fetchedPageText([
      fetchResult('https://www.a.test/pancakes/', 'flour, eggs, milk'),
      searchResult('https://b.test/waffles'),
    ]);
    expect(texts.get('a.test/pancakes')).toBe('flour, eggs, milk');
    expect(texts.size).toBe(1);
  });

  it('ignores a fetch that errored', () => {
    const errored = {
      type: 'web_fetch_tool_result',
      tool_use_id: 'srvtoolu_4',
      caller: { type: 'direct' },
      content: {
        type: 'web_fetch_tool_result_error',
        error_code: 'url_not_accessible',
      },
    } as unknown as Anthropic.ContentBlock;
    expect(fetchedPageText([errored]).size).toBe(0);
  });
});
