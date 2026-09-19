import { describe, expect, it } from 'vitest'
import {
  cleanWords,
  generatePuzzle,
  MAX_WORDS,
  parseSeed,
  validateInput,
  type Puzzle,
} from './engine'

const WORDS = 'cat,dog,bird,horse,rabbit,ferret,gerbil,python,axolotl'

function make(overrides: Partial<Parameters<typeof generatePuzzle>[0]> = {}): Puzzle {
  return generatePuzzle({ rows: 15, cols: 15, rawWords: WORDS, seed: 42, ...overrides })
}

/** Reads the grid back along a placement's own direction. */
function readAt(puzzle: Puzzle, row: number, col: number, dir: readonly [number, number], len: number) {
  let out = ''
  for (let i = 0; i < len; i++) out += puzzle.grid[row + dir[0] * i][col + dir[1] * i]
  return out
}

describe('cleanWords', () => {
  it('strips punctuation and uppercases', () => {
    expect(cleanWords('ice-cream, hot dog')).toEqual(['ICECREAM', 'HOTDOG'])
  })

  it('dedupes while preserving first-seen order', () => {
    expect(cleanWords('cat,dog,CAT,bird,c-a-t')).toEqual(['CAT', 'DOG', 'BIRD'])
  })

  it('drops empties', () => {
    expect(cleanWords('cat,,  ,---,dog')).toEqual(['CAT', 'DOG'])
  })

  it('returns nothing for a blank input', () => {
    expect(cleanWords('')).toEqual([])
  })
})

describe('parseSeed', () => {
  it('returns null when no seed is supplied', () => {
    expect(parseSeed(null)).toBeNull()
    expect(parseSeed('')).toBeNull()
  })

  it('takes the absolute value of a negative seed', () => {
    expect(parseSeed('-7')).toBe(7)
  })

  it('turns 0 into 1', () => {
    expect(parseSeed(0)).toBe(1)
  })

  it('rejects a non-integer seed', () => {
    expect(parseSeed('abc')).toBeNull()
    expect(parseSeed('1.5')).toBeNull()
  })
})

describe('validateInput', () => {
  const base = { rows: 15, cols: 15, rawWords: WORDS }
  const messages = (input: Partial<typeof base>) =>
    validateInput({ ...base, ...input }).map((e) => e.message)

  it('accepts a sane input', () => {
    expect(validateInput(base)).toEqual([])
  })

  it('rejects non-ASCII terms', () => {
    expect(messages({ rawWords: 'café,dog' })).toContain('Non-ASCII characters detected in input.')
  })

  it('rejects non-integer or non-positive dimensions', () => {
    expect(messages({ rows: 0 })).toContain('Rows and columns must be positive integers.')
    expect(messages({ cols: 12.5 })).toContain('Rows and columns must be positive integers.')
  })

  it('rejects dimensions outside 5..50', () => {
    expect(messages({ rows: 4 })).toContain('Rows and columns must be between 5 and 50.')
    expect(messages({ cols: 51 })).toContain('Rows and columns must be between 5 and 50.')
  })

  it('requires at least one word', () => {
    expect(messages({ rawWords: ' , , ' })).toContain('Enter at least one word.')
  })

  it('rejects more than 100 words', () => {
    // Distinct *alpha* words — digits would be stripped and the lot deduped to one.
    const many = Array.from(
      { length: MAX_WORDS + 1 },
      (_, i) => `w${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
    ).join(',')
    expect(messages({ rawWords: many })).toContain('That is more than 100 words.')
  })

  it('rejects a word longer than the grid', () => {
    expect(messages({ rows: 5, cols: 5, rawWords: 'elephant' })).toContain(
      '"ELEPHANT" is too long for a 5x5 grid.',
    )
  })

  it('reports each offending field', () => {
    expect(validateInput({ rows: 2, cols: 99, rawWords: '' }).map((e) => e.field)).toEqual([
      'rows',
      'cols',
      'words',
    ])
  })
})

describe('generatePuzzle', () => {
  it('is deterministic for the same seed and input', () => {
    expect(make().grid).toEqual(make().grid)
  })

  it('produces a different grid for a different seed', () => {
    expect(make({ seed: 42 }).grid).not.toEqual(make({ seed: 43 }).grid)
  })

  it('fills every cell with exactly one A-Z character', () => {
    const puzzle = make()
    expect(puzzle.grid).toHaveLength(15)
    for (const row of puzzle.grid) {
      expect(row).toHaveLength(15)
      for (const cell of row) expect(cell).toMatch(/^[A-Z]$/)
    }
  })

  it('places every word where it says it did', () => {
    const puzzle = make()
    expect(puzzle.placements.length).toBeGreaterThan(0)
    for (const p of puzzle.placements) {
      expect(readAt(puzzle, p.row, p.col, p.dir, p.word.length)).toBe(p.word)
    }
  })

  it('accounts for every cleaned word exactly once', () => {
    const puzzle = make()
    const seen = [...puzzle.placements.map((p) => p.word), ...puzzle.unplaced].sort()
    expect(seen).toEqual([...puzzle.words].sort())
  })

  it('reports unplaceable words instead of throwing or looping', () => {
    // 20 five-letter words of a single repeated letter each: they can never cross
    // one another, and a 5x5 grid has only 11 lines that fit them.
    const rawWords = Array.from({ length: 20 }, (_, i) =>
      String.fromCharCode(65 + i).repeat(5),
    ).join(',')
    const puzzle = generatePuzzle({ rows: 5, cols: 5, rawWords, seed: 7 })
    expect(puzzle.unplaced.length).toBeGreaterThan(0)
    expect(puzzle.placements.length).toBeLessThanOrEqual(11)
  })

  it('returns the seed it was given', () => {
    expect(make({ seed: 99 }).seed).toBe(99)
  })
})
