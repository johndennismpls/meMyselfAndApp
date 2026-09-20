import type Anthropic from '@anthropic-ai/sdk';
import type { Candidate } from './discovery.schema';

/**
 * Grounding enforcement (§3.4). A dozen lines of code, and the difference
 * between a stated policy and an enforced one: the prompt tells the model never
 * to write a URL from memory, and this checks that it didn't.
 */

export interface GroundingResult {
  /** Candidates whose URL actually appeared in a tool result block. */
  kept: Candidate[];
  /** Candidates dropped as ungrounded, for the trace log. */
  dropped: Candidate[];
  /** False when no search or fetch result came back at all — fail closed. */
  searched: boolean;
}

/**
 * Normalised for comparison: scheme, `www.`, trailing slash, and tracking params
 * ignored. Host and path are what identify a page; everything else is noise the
 * model or the search index may have rewritten.
 */
export function normaliseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  return `${host}${path}`;
}

/**
 * Collects every URL that appeared in a web_search_tool_result or
 * web_fetch_tool_result block. Search errors arrive as HTTP 200 with an error
 * object where the list would be, so branch on shape before indexing.
 */
export function observedUrls(content: Anthropic.ContentBlock[]): Set<string> {
  const observed = new Set<string>();

  for (const block of content) {
    if (block.type === 'web_search_tool_result') {
      // Success content is an array of results; an error is a single object.
      if (!Array.isArray(block.content)) continue;
      for (const result of block.content) {
        const key = normaliseUrl(result.url);
        if (key) observed.add(key);
      }
    } else if (block.type === 'web_fetch_tool_result') {
      if (block.content.type !== 'web_fetch_result') continue;
      const key = normaliseUrl(block.content.url);
      if (key) observed.add(key);
    }
  }

  return observed;
}

export function assertGrounded(
  content: Anthropic.ContentBlock[],
  candidates: Candidate[],
): GroundingResult {
  const observed = observedUrls(content);

  // Rule 2: an empty observed set means no search ran, so whatever came back was
  // written from memory. Fail regardless of how good the candidates look.
  if (observed.size === 0) {
    return { kept: [], dropped: candidates, searched: false };
  }

  const kept: Candidate[] = [];
  const dropped: Candidate[] = [];
  for (const candidate of candidates) {
    const key = normaliseUrl(candidate.url);
    if (key !== null && observed.has(key)) kept.push(candidate);
    else dropped.push(candidate);
  }

  return { kept, dropped, searched: true };
}

/**
 * The page text web_fetch already pulled, keyed by normalised URL. Feeds the
 * §4.3 fallback for pages that 403 our own fetch but not Anthropic's.
 */
export function fetchedPageText(
  content: Anthropic.ContentBlock[],
): Map<string, string> {
  const texts = new Map<string, string>();

  for (const block of content) {
    if (block.type !== 'web_fetch_tool_result') continue;
    if (block.content.type !== 'web_fetch_result') continue;
    const key = normaliseUrl(block.content.url);
    if (!key) continue;
    const source = block.content.content.source;
    if (source.type === 'text') texts.set(key, source.data);
  }

  return texts;
}
