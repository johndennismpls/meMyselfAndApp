import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  generatePuzzle,
  MAX_SIZE,
  MIN_SIZE,
  randomSeed,
  validateInput,
  type ErrorField,
  type Puzzle,
  type ValidationError,
} from './engine'
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from './search'
import './wordsearch.css'

const WORDS_DEBOUNCE_MS = 250

function errorFor(errors: ValidationError[], field: ErrorField): string | undefined {
  return errors.find((e) => e.field === field)?.message
}

export default function WordSearchPage() {
  const search = useSearch({ from: '/wordsearch' })
  const navigate = useNavigate({ from: '/wordsearch' })
  const { rows, cols, words, fontSize, seed } = search

  // Landing without a seed: pick one and put it in the URL straight away, so a
  // refresh is stable and copying the URL shares the exact puzzle.
  useEffect(() => {
    if (seed === undefined) {
      void navigate({ search: (prev) => ({ ...prev, seed: randomSeed() }), replace: true })
    }
  }, [seed, navigate])

  /**
   * The script printed the seed only when one was passed on the command line.
   * The web equivalent: a seed we auto-picked for this visit is not "supplied",
   * but once it is in the URL — shared, reloaded, or typed — it is. Read once,
   * on first render, before the effect above fills a missing seed in.
   */
  const [seedWasSupplied] = useState(() => seed !== undefined)

  // The one piece of local state: a typing buffer, so each keystroke does not
  // rewrite the URL. Everything else reads straight from the search params.
  const [wordsDraft, setWordsDraft] = useState(words)
  const [syncedWords, setSyncedWords] = useState(words)

  // Adopt changes that came from the URL rather than the textarea — the back
  // button, or a pasted link.
  if (words !== syncedWords) {
    setSyncedWords(words)
    setWordsDraft(words)
  }

  useEffect(() => {
    if (wordsDraft === words) return
    const id = setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, words: wordsDraft }), replace: true })
    }, WORDS_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [wordsDraft, words, navigate])

  const setParam = (patch: Partial<typeof search>) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  }

  const errors = useMemo(
    () => validateInput({ rows, cols, rawWords: words }),
    [rows, cols, words],
  )

  const puzzle = useMemo<Puzzle | null>(() => {
    if (seed === undefined || errors.length > 0) return null
    return generatePuzzle({ rows, cols, rawWords: words, seed })
  }, [rows, cols, words, seed, errors])

  // Keep the last good puzzle on screen while the input is mid-edit or invalid,
  // rather than blanking the grid out.
  const [lastValid, setLastValid] = useState<Puzzle | null>(null)
  if (puzzle && puzzle !== lastValid) setLastValid(puzzle)
  const shown = puzzle ?? lastValid

  const [dismissedUnplaced, setDismissedUnplaced] = useState<string | null>(null)
  const unplacedKey = shown ? shown.unplaced.join(',') : ''
  const showUnplaced = unplacedKey !== '' && unplacedKey !== dismissedUnplaced

  // The word bank lists what is actually findable, sorted as the script sorts.
  const wordBank = useMemo(
    () => (shown ? shown.placements.map((p) => p.word).sort() : []),
    [shown],
  )

  const wordsError = errorFor(errors, 'words')

  return (
    <main className="ws" style={{ '--ws-font-size': `${fontSize}px` } as React.CSSProperties}>
      <header className="ws-header">
        <Link to="/" className="ws-back">
          ← Apps
        </Link>
        <h1>Word Search</h1>
      </header>

      <form className="ws-controls" onSubmit={(e) => e.preventDefault()}>
        <label>
          <span>Rows</span>
          <input
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={rows}
            onChange={(e) => setParam({ rows: Number(e.target.value) })}
          />
          {errorFor(errors, 'rows') && <em className="ws-error">{errorFor(errors, 'rows')}</em>}
        </label>

        <label>
          <span>Columns</span>
          <input
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            value={cols}
            onChange={(e) => setParam({ cols: Number(e.target.value) })}
          />
          {errorFor(errors, 'cols') && <em className="ws-error">{errorFor(errors, 'cols')}</em>}
        </label>

        <label>
          <span>Seed</span>
          <input
            type="number"
            value={seed ?? ''}
            onChange={(e) => setParam({ seed: Number(e.target.value) })}
          />
        </label>

        <label>
          <span>Font size</span>
          <input
            type="number"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            value={fontSize}
            onChange={(e) => setParam({ fontSize: Number(e.target.value) })}
          />
        </label>

        <label className="ws-words">
          <span>Words (comma separated)</span>
          <textarea
            rows={3}
            value={wordsDraft}
            placeholder="cat, dog, bird"
            onChange={(e) => setWordsDraft(e.target.value)}
            aria-invalid={wordsError !== undefined}
          />
          {wordsError && <em className="ws-error">{wordsError}</em>}
        </label>

        <div className="ws-actions">
          {/* A fresh seed — editing rows/cols/words keeps the layout you liked. */}
          <button type="button" onClick={() => setParam({ seed: randomSeed() })}>
            Regenerate
          </button>
          <button type="button" onClick={() => window.print()} disabled={!shown}>
            Print
          </button>
        </div>
      </form>

      {showUnplaced && shown && (
        <p className="ws-warning" role="status">
          Could not place: {shown.unplaced.join(', ')}
          <button type="button" onClick={() => setDismissedUnplaced(unplacedKey)}>
            Dismiss
          </button>
        </p>
      )}

      {shown ? (
        <>
          <table className="ws-grid">
            <caption>
              {shown.grid.length}×{shown.grid[0].length} word search grid
            </caption>
            <tbody>
              {shown.grid.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {wordBank.length > 0 && (
            <ul className="ws-wordbank">
              {wordBank.map((word) => (
                <li key={word}>{word}</li>
              ))}
            </ul>
          )}

          <p className={`ws-seed${seedWasSupplied ? '' : ' ws-seed-unsupplied'}`}>
            Seed: {shown.seed}
          </p>
        </>
      ) : (
        <p className="ws-empty">Enter some words to build a puzzle.</p>
      )}
    </main>
  )
}
