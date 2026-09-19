/**
 * Word search generation — a port of spec/wordsearch.py.
 *
 * Pure functions over plain values: no React, no DOM, no fetch, no module-level
 * mutable state. Every source of randomness is the injected PRNG; nothing here
 * may call Math.random().
 */
import { mulberry32, randomInt, shuffle } from './prng'

export type Direction = readonly [dr: number, dc: number]

/** Matches wordsearch.py DIRECTIONS: horizontal, vertical, diagonal TL->BR. */
export const DIRECTIONS: readonly Direction[] = [
  [0, 1],
  [1, 0],
  [1, 1],
]

export interface Placement {
  word: string
  row: number
  col: number
  dir: Direction
}

export interface Puzzle {
  /** rows x cols, every cell a single A-Z character. */
  grid: string[][]
  /** Cleaned words, in cleaned order. */
  words: string[]
  /** Words that made it into the grid. Unused in v1; an answer key would need it. */
  placements: Placement[]
  /** Words that did not fit; surfaced in the UI. */
  unplaced: string[]
  /** The seed actually used. Always concrete. */
  seed: number
}

export const MIN_SIZE = 5
export const MAX_SIZE = 50
export const MAX_WORDS = 100

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Splits on commas, strips non-alpha, uppercases, drops empties, dedupes. */
export function cleanWords(raw: string): string[] {
  const words: string[] = []
  const seen = new Set<string>()
  for (const rawWord of raw.split(',')) {
    const cleaned = rawWord.replace(/[^A-Za-z]/g, '').toUpperCase()
    if (!cleaned) continue
    if (seen.has(cleaned)) continue
    seen.add(cleaned)
    words.push(cleaned)
  }
  return words
}

function isAscii(text: string): boolean {
  for (const ch of text) {
    if (ch.codePointAt(0)! >= 128) return false
  }
  return true
}

export type ErrorField = 'rows' | 'cols' | 'words' | 'seed'

export interface ValidationError {
  field: ErrorField
  message: string
}

export interface WordSearchInput {
  rows: number
  cols: number
  /** The raw, uncleaned terms string, as typed. */
  rawWords: string
}

/**
 * Returns every validation failure, so the page can render each one next to the
 * control that caused it. An empty array means the input is generatable.
 *
 * The 5..50 and 100 bounds are new relative to the script: they keep candidate
 * enumeration fast enough to run on every debounced regeneration.
 */
export function validateInput({ rows, cols, rawWords }: WordSearchInput): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isAscii(rawWords)) {
    errors.push({ field: 'words', message: 'Non-ASCII characters detected in input.' })
  }

  for (const [field, value] of [
    ['rows', rows],
    ['cols', cols],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      errors.push({ field, message: 'Rows and columns must be positive integers.' })
    } else if (value < MIN_SIZE || value > MAX_SIZE) {
      errors.push({
        field,
        message: `Rows and columns must be between ${MIN_SIZE} and ${MAX_SIZE}.`,
      })
    }
  }

  const words = cleanWords(rawWords)
  if (words.length === 0) {
    errors.push({ field: 'words', message: 'Enter at least one word.' })
  } else if (words.length > MAX_WORDS) {
    errors.push({ field: 'words', message: `That is more than ${MAX_WORDS} words.` })
  }

  // Only meaningful once the dimensions themselves are sane.
  if (Number.isInteger(rows) && Number.isInteger(cols)) {
    const longest = Math.max(rows, cols)
    for (const word of words) {
      if (word.length > longest) {
        errors.push({
          field: 'words',
          message: `"${word}" is too long for a ${rows}x${cols} grid.`,
        })
      }
    }
  }

  return errors
}

/**
 * Ports parse_seed: a non-integer seed is an error, a negative seed is absolute'd,
 * and 0 becomes 1. Returns null when no seed was supplied.
 */
export function parseSeed(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const value = typeof raw === 'number' ? raw : Number(raw.trim())
  if (!Number.isInteger(value)) return null
  const seed = Math.abs(value)
  return seed === 0 ? 1 : seed
}

/** A fresh seed for "Regenerate" and for first landing on the page. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) + 1
}

interface Candidate {
  row: number
  col: number
  dirIndex: number
}

/**
 * Every in-bounds start for a word of this length, in fixed order (direction,
 * then row, then col) so the pre-shuffle sequence is deterministic.
 */
function findCandidates(rows: number, cols: number, wordLen: number): Candidate[] {
  const candidates: Candidate[] = []
  for (let dirIndex = 0; dirIndex < DIRECTIONS.length; dirIndex++) {
    const [dr, dc] = DIRECTIONS[dirIndex]
    const endRowOffset = dr * (wordLen - 1)
    const endColOffset = dc * (wordLen - 1)
    for (let r = 0; r < rows; r++) {
      if (r + endRowOffset < 0 || r + endRowOffset >= rows) continue
      for (let c = 0; c < cols; c++) {
        if (c + endColOffset < 0 || c + endColOffset >= cols) continue
        candidates.push({ row: r, col: c, dirIndex })
      }
    }
  }
  return candidates
}

/** What a cell already holds: which word put a letter there, running which way. */
type Occupant = { wordIndex: number; dirIndex: number }

function tryPlaceWord(
  letters: (string | null)[][],
  occupants: Occupant[][][],
  word: string,
  wordIndex: number,
  rows: number,
  cols: number,
  rand: () => number,
): Placement | null {
  const candidates = findCandidates(rows, cols, word.length)
  shuffle(candidates, rand)

  for (const { row, col, dirIndex } of candidates) {
    const [dr, dc] = DIRECTIONS[dirIndex]
    let valid = true
    // How many cells this candidate would share with each already-placed word.
    const sharedWith = new Map<number, number>()

    for (let i = 0; i < word.length; i++) {
      const r = row + dr * i
      const c = col + dc * i
      const existing = letters[r][c]
      if (existing === null) continue
      if (existing !== word[i]) {
        valid = false
        break
      }
      for (const other of occupants[r][c]) {
        // Two words running the same way through one cell would overlap, not cross.
        if (other.dirIndex === dirIndex) {
          valid = false
          break
        }
        const shared = (sharedWith.get(other.wordIndex) ?? 0) + 1
        sharedWith.set(other.wordIndex, shared)
        // Crossing any one other word more than once is invalid.
        if (shared > 1) {
          valid = false
          break
        }
      }
      if (!valid) break
    }
    if (!valid) continue

    for (let i = 0; i < word.length; i++) {
      const r = row + dr * i
      const c = col + dc * i
      letters[r][c] = word[i]
      occupants[r][c].push({ wordIndex, dirIndex })
    }
    return { word, row, col, dir: DIRECTIONS[dirIndex] }
  }

  return null
}

export interface GenerateOptions extends WordSearchInput {
  seed: number
}

/**
 * Builds the puzzle. Deterministic: the same seed and the same inputs always
 * give the same grid.
 *
 * A word with no valid candidate is skipped, not retried, and lands in `unplaced`.
 */
export function generatePuzzle({ rows, cols, rawWords, seed }: GenerateOptions): Puzzle {
  const rand = mulberry32(seed)
  const words = cleanWords(rawWords)

  const letters: (string | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  )
  const occupants: Occupant[][][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => [] as Occupant[]),
  )

  const placementOrder = words.map((word, index) => ({ word, index }))
  shuffle(placementOrder, rand)

  // Keyed by word index so both outputs can be reported in cleaned order.
  const placed = new Map<number, Placement>()
  const unplaced: number[] = []

  for (const { word, index } of placementOrder) {
    const placement = tryPlaceWord(letters, occupants, word, index, rows, cols, rand)
    if (placement) placed.set(index, placement)
    else unplaced.push(index)
  }

  // Row-major so the fill is deterministic.
  const grid: string[][] = letters.map((row) =>
    row.map((cell) => cell ?? ALPHABET[randomInt(rand, ALPHABET.length)]),
  )

  return {
    grid,
    words,
    placements: words.map((_, i) => placed.get(i)).filter((p): p is Placement => p !== undefined),
    unplaced: unplaced.sort((a, b) => a - b).map((i) => words[i]),
    seed,
  }
}
