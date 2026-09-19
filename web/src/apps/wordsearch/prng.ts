/**
 * Seeded pseudo-randomness for the word search engine.
 *
 * Seeds reproduce within this app only — see spec/01_wordsearch.md §1.1. Parity
 * with the Python script's Mersenne Twister is explicitly not a goal.
 */

/** Deterministic PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** In-place Fisher–Yates, descending index. */
export function shuffle<T>(items: T[], rand: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = items[i]
    items[i] = items[j]
    items[j] = tmp
  }
}

export function randomInt(rand: () => number, maxExclusive: number): number {
  return Math.floor(rand() * maxExclusive)
}
