/**
 * The /wordsearch URL *is* the state — see spec/01_wordsearch.md §4.2.
 *
 * Every param is parsed and clamped here; anything malformed falls back to its
 * default rather than erroring the route, so a hand-edited link still loads.
 */
import type { SearchSchemaInput } from '@tanstack/react-router'
import { MAX_SIZE, MIN_SIZE, parseSeed } from './engine'

export const DEFAULTS = {
  rows: 15,
  cols: 15,
  words: '',
  fontSize: 16,
} as const

export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 36

export interface WordSearchSearch {
  rows: number
  cols: number
  words: string
  fontSize: number
  /** Absent only before the route replaces it with a concrete one. */
  seed?: number
}

function clampedInt(raw: unknown, fallback: number, min: number, max: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * The SearchSchemaInput marker tells the router every param is optional *on the
 * way in* (so `<Link to="/wordsearch">` needs no search props) while the parsed
 * result stays fully populated.
 */
export function validateWordSearchSearch(
  raw: Record<string, unknown> & SearchSchemaInput,
): WordSearchSearch {
  const seed = parseSeed(
    typeof raw.seed === 'number' || typeof raw.seed === 'string' ? raw.seed : null,
  )
  return {
    rows: clampedInt(raw.rows, DEFAULTS.rows, MIN_SIZE, MAX_SIZE),
    cols: clampedInt(raw.cols, DEFAULTS.cols, MIN_SIZE, MAX_SIZE),
    words: typeof raw.words === 'string' ? raw.words : DEFAULTS.words,
    fontSize: clampedInt(raw.fontSize, DEFAULTS.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE),
    ...(seed === null ? {} : { seed }),
  }
}
