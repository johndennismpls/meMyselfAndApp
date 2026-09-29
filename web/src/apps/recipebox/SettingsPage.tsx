import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker } from '@tanstack/react-router'
import { useState } from 'react'
import { getSettings, recipeKeys, updateSettings } from './api'
import './recipebox.css'

/**
 * §9.4. Standing preferences — the things you would otherwise retype into
 * every request: "no tree nuts", "I only have a microwave", "nothing that
 * takes more than 30 minutes".
 *
 * One per line, in one textarea, matching how steps and notes are edited on the
 * recipe form. They are constraints on *searching*: the find path passes them to
 * discovery, a pasted URL ignores them, and nothing here is written onto a
 * recipe.
 */

export const MAX_PREFERENCES = 20

const PLACEHOLDER = `No tree nuts
I only have a microwave
Nothing that takes more than 30 minutes`

function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: recipeKeys.settings,
    queryFn: getSettings,
  })

  // Null until the first keystroke: the saved list is the source of truth
  // while nothing has been typed, so a background refetch is not fighting an
  // edit in progress.
  const [text, setText] = useState<string | null>(null)
  const saved = settings.data?.preferences ?? []
  const value = text ?? saved.join('\n')
  const lines = linesOf(value)

  const dirty = text !== null && lines.join('\n') !== saved.join('\n')
  const tooMany = lines.length > MAX_PREFERENCES

  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm('Discard your unsaved preferences?'),
    enableBeforeUnload: () => dirty,
  })

  const save = useMutation({
    mutationFn: () => updateSettings(lines),
    onSuccess: (updated) => {
      queryClient.setQueryData(recipeKeys.settings, updated)
      // Back to showing the saved list, which is now what was typed — minus
      // any blank lines the server dropped.
      setText(null)
    },
  })

  return (
    <section className="rb">
      <header className="rb-header">
        <h1>Preferences</h1>
        <Link to="/recipes" className="rb-link">
          ← Recipe Box
        </Link>
      </header>

      <p className="rb-note rb-prose">
        Things that are true every time you ask for a recipe. They are added to
        the search, so you don’t have to repeat them — one per line. A pasted
        link is read as-is and ignores them.
      </p>

      {settings.isPending ? (
        <p className="rb-note">Loading…</p>
      ) : settings.isError ? (
        <p className="rb-error" role="alert">
          {settings.error.message}
        </p>
      ) : (
        <form
          className="rb-form rb-settings"
          onSubmit={(event) => {
            event.preventDefault()
            if (dirty && !tooMany && !save.isPending) save.mutate()
          }}
        >
          <label className="rb-field">
            <span>One preference per line</span>
            <textarea
              rows={Math.max(6, lines.length + 2)}
              value={value}
              onChange={(event) => setText(event.target.value)}
              placeholder={PLACEHOLDER}
              disabled={save.isPending}
            />
          </label>

          <p className={tooMany ? 'rb-error' : 'rb-note'} role="status">
            {tooMany
              ? `Keep it to ${MAX_PREFERENCES} preferences or fewer.`
              : `${lines.length} of ${MAX_PREFERENCES}`}
          </p>

          <div className="rb-actions">
            <button
              className="rb-button"
              type="submit"
              disabled={!dirty || tooMany || save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            {dirty && (
              <button
                className="rb-text-button"
                type="button"
                onClick={() => setText(null)}
                disabled={save.isPending}
              >
                Cancel
              </button>
            )}
            {!dirty && save.isSuccess && <span className="rb-note">Saved.</span>}
          </div>

          {save.isError && (
            <p className="rb-error" role="alert">
              {save.error.message}
            </p>
          )}
        </form>
      )}
    </section>
  )
}
