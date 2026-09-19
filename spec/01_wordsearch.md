# 02 — Word Search

Port of `spec/wordsearch.py` into a web app in this repo, reachable at `/wordsearch`.

## 1. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Where generation runs | Client-side TypeScript | The algorithm is pure and cheap. No round trip, instant regeneration, works offline, trivially unit-testable. The API stays a tile registry. |
| Printing | Browser print dialog + `@media print` stylesheet | No PDF dependency. "Save as PDF" in the print dialog covers the file case. |
| Routing | TanStack Router, code-based routes | Matches the TanStack Query already in use. `validateSearch` gives typed, validated search params, which is exactly what the seed URL needs. |
| Reproducibility | Shareable seed URL | The whole puzzle is a link. Refresh reproduces it exactly. |
| Out of scope (v1) | Answer key, reverse/extra directions, DB persistence | Deliberately deferred. See §8. |

### 1.1 Seed parity with the Python script — explicitly not a goal

`wordsearch.py` seeds CPython's Mersenne Twister and uses `random.shuffle`. Reproducing a
given seed's exact grid in TypeScript would require porting MT19937 *and* CPython's
Fisher–Yates variant. We do not do this.

Seeds are **reproducible within the web app** — the same seed plus the same inputs always
gives the same grid — but a seed will **not** reproduce output from the Python script.
This is accepted, not a bug.

## 2. Engine (pure, no React)

Lives at `web/src/apps/wordsearch/engine.ts`. Plain functions over plain values: no React,
no DOM, no `fetch`, no module-level mutable state. Every source of randomness is the
injected PRNG — the engine must never call `Math.random()`.

### 2.1 Types

```ts
type Direction = readonly [dr: number, dc: number]

/** Matches wordsearch.py DIRECTIONS: horizontal, vertical, diagonal TL->BR. */
const DIRECTIONS: readonly Direction[] = [[0, 1], [1, 0], [1, 1]]

interface Placement {
  word: string
  row: number
  col: number
  dir: Direction
}

interface Puzzle {
  grid: string[][]        // rows x cols, every cell a single A-Z character
  words: string[]         // cleaned words, in cleaned order
  placements: Placement[] // words that made it into the grid
  unplaced: string[]      // words that did not fit; surfaced in the UI
  seed: number            // the seed actually used, always concrete
}
```

`placements` is not rendered in v1. It is returned because the engine knows it for free,
and it is what an answer key (§8) would need.

### 2.2 PRNG

A seeded generator in `web/src/apps/wordsearch/prng.ts`:

- `mulberry32(seed: number): () => number` — returns floats in `[0, 1)`.
- `shuffle<T>(items: T[], rand: () => number): void` — in-place Fisher–Yates, descending
  index, `j = floor(rand() * (i + 1))`.
- `randomInt(rand, maxExclusive): number`.

Deterministic given a seed. The engine takes `rand` as a parameter so tests can inject a
stub.

### 2.3 Input cleaning — `cleanWords(raw: string): string[]`

Port of `clean_words`, same order of operations:

1. Split the raw string on `,`.
2. Strip every character that is not `[A-Za-z]` (so `"ice-cream"` → `ICECREAM`).
3. Uppercase.
4. Drop empties.
5. Dedupe, keeping first-seen order.

### 2.4 Validation — `validateInput(...)`

| Rule | Message |
| --- | --- |
| Non-ASCII in the raw terms | `Non-ASCII characters detected in input.` |
| `rows` or `cols` not a positive integer | `Rows and columns must be positive integers.` |
| `rows` or `cols` outside `5..50` | `Rows and columns must be between 5 and 50.` |
| No words survive cleaning | `Enter at least one word.` |
| More than 100 words | `That is more than 100 words.` |
| A cleaned word longer than `max(rows, cols)` | `"<WORD>" is too long for a <rows>x<cols> grid.` |

The `5..50` and `100` bounds are new; the script had none. They keep candidate enumeration
(§2.5) fast enough to run on every keystroke-debounced regeneration.

Seed handling ports `parse_seed`: a non-integer seed is an error, a negative seed is
`Math.abs`'d, and `0` becomes `1`. When no seed is supplied the app picks one (§4.2) —
`Puzzle.seed` is always a concrete number.

### 2.5 Placement — port of `find_candidates` / `try_place_word`

Word order is shuffled first (`placement_order`), then each word is placed independently:

1. Enumerate every in-bounds start for the word across all three directions, in fixed order
   (direction, then row, then col) so the pre-shuffle sequence is deterministic.
2. Shuffle the candidates with the seeded PRNG.
3. Take the first candidate that is valid.

A candidate is valid when, walking the word's cells:

- An empty cell is always fine.
- A cell holding a **different** letter is invalid.
- A cell holding the **same** letter is a crossing, and then:
  - if any word already occupying that cell runs in the **same direction**, invalid;
  - otherwise the crossing counts against that word, and **crossing any one other word more
    than once is invalid** (`shared_with[other] > 1` in the script).

On success the letters are written and each cell records `(wordIndex, dir)`.

A word with no valid candidate is **skipped**, not retried, and lands in `unplaced`. The
script printed a warning to stderr; the UI shows it instead (§4.4).

### 2.6 Fill

Remaining empty cells get a uniformly random `A`–`Z` from the seeded PRNG, scanned row-major
so the fill is deterministic.

### 2.7 Tests — `engine.test.ts`

Requires adding **Vitest** to `web/` (see §6). Cases:

- `cleanWords` strips punctuation, uppercases, dedupes, preserves order, drops empties.
- Same seed + same input → deeply equal grids. Different seed → different grid.
- Every placed word is actually readable in the grid along its recorded direction.
- Every grid cell is exactly one character in `A`–`Z`.
- A word longer than the grid is rejected by `validateInput`.
- An unplaceable-but-legal set (e.g. many long words in a tight grid) reports `unplaced`
  rather than throwing or looping.
- Each validation rule in §2.4.

## 3. Routing

TanStack Router, **code-based** (`createRootRoute` / `createRoute` / `createRouter`) — no
file-based routing plugin and no generated route tree, so there is no codegen step to keep
in sync.

```
/            -> HomePage      (today's App.tsx tile grid, extracted)
/wordsearch  -> WordSearchPage
```

- `web/src/main.tsx` renders `<RouterProvider>` inside the existing `QueryClientProvider`.
- `App.tsx` splits: the tile grid becomes `web/src/HomePage.tsx`; each tile becomes a
  TanStack `<Link>` to `/{app.name}`. Apps without a route yet render as a disabled tile
  rather than a dead link.
- Deep links need an SPA fallback in production (`vite preview` and the dev server already
  do this; whatever serves `web/dist` must rewrite unknown paths to `index.html`).

## 4. The `/wordsearch` page

`web/src/apps/wordsearch/WordSearchPage.tsx`.

### 4.1 Controls

| Control | Input | Default |
| --- | --- | --- |
| Rows | number, 5–50 | 15 |
| Cols | number, 5–50 | 15 |
| Words | textarea, comma-separated | empty |
| Seed | number, optional | blank (app picks one) |
| Font size | number, 8–36 | 16 |
| Regenerate | button | — |
| Print | button → `window.print()` | — |

Font size ports `--fontSize`. It sets a CSS custom property, and the script's ratios carry
over: grid `0.92×`, word bank `0.83×`, seed footer `0.75×`.

**Regenerate** picks a fresh random seed and writes it to the URL. Editing rows/cols/words
re-renders with the *current* seed, so tweaking a word list does not throw away the layout
you liked.

### 4.2 URL is the state

```
/wordsearch?rows=15&cols=15&seed=42&words=CAT,DOG,BIRD&fontSize=16
```

- `validateSearch` parses and clamps every param; anything malformed falls back to its
  default rather than erroring the route.
- Landing on `/wordsearch` with **no** `seed` generates one and immediately does a
  `replace` navigation so the URL always names a concrete seed. Refresh is therefore
  always stable, and copying the URL shares the exact puzzle.
- The puzzle is derived from search params via `useMemo` — no `useState` mirror of the URL,
  and no fetching, so React Query is not involved on this page.

### 4.3 Rendering

- The grid is a `<table>` with a `<caption>`, not a `<div>` soup — it is tabular data, it
  prints predictably, and it gives screen readers row/column structure.
- Monospace font, square cells, letters centered, sized from the font-size CSS variable.
- Word bank below the grid, **sorted alphabetically** (the script sorts), laid out with CSS
  `columns` so it auto-flows into as many columns as fit — the responsive equivalent of the
  script's `num_cols` arithmetic.
- Seed shown in a footer line.

### 4.4 Errors and warnings

- Validation failures render inline next to the offending control; the grid area shows the
  last valid puzzle rather than blanking out.
- `unplaced` words render as a dismissible warning above the grid — *"Could not place: X, Y"*
  — and are **excluded from the printed word bank**, since they are not in the grid.

## 5. Print stylesheet

`web/src/apps/wordsearch/wordsearch.css`, in an `@media print` block:

```css
@page { size: letter; margin: 1in 1.5in; }   /* matches the script's 72pt margins */
```

- Hide controls, nav, warnings, and the React Query devtools.
- Grid and word bank both `break-inside: avoid`; the grid is centered on the page.
- Force black-on-white ink regardless of the app's theme variables.
- Seed footer prints only when a seed was explicitly supplied — matching the script's
  `seed_provided` behaviour.
- Target: a default 15×15 puzzle plus word bank fits on **one** Letter page.

## 6. Dependencies to add (`web/`)

| Package | Why |
| --- | --- |
| `@tanstack/react-router` | §3 |
| `vitest` (dev) | §2.7 — `web/` currently has no test runner at all |

No API changes. No new API dependencies. No migrations.

## 7. Files

```
web/src/
  main.tsx                          (modified: RouterProvider)
  router.tsx                        (new: route tree)
  HomePage.tsx                      (new: extracted from App.tsx, tiles become Links)
  App.tsx                           (removed, or reduced to a layout shell)
  apps/wordsearch/
    prng.ts                         (new)
    engine.ts                       (new)
    engine.test.ts                  (new)
    WordSearchPage.tsx              (new)
    wordsearch.css                  (new)
web/package.json                    (modified: deps + test script)
web/vite.config.ts                  (modified: vitest config)
```

## 8. Deferred

- **Answer key** — a toggle highlighting placements, printing as a second page. The engine
  already returns `placements`, so this is UI-only.
- **More directions** — reverse words and BL→TR diagonal as opt-in checkboxes. Changes
  difficulty, so it needs its own thought.
- **Saved puzzles** — a Drizzle table + migration. The seed URL covers most of this need;
  revisit only if links prove insufficient.
