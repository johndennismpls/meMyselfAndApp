import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { findRecipe, getSettings, recipeKeys, scrapeRecipe } from './api'
import { forgetFind, rememberFind } from './lastFind'
import type { FindResult, Recipe } from './types'

/**
 * One box, two behaviours (§9.2). If the text parses as an http(s) URL it posts
 * to /recipes/scrape, otherwise to /recipes/find. No mode toggle and no second
 * field — pasting a link just works, and the button label changes so the
 * behaviour is visible before you commit.
 */

function asUrl(text: string): string | null {
  const trimmed = text.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  try {
    return new URL(trimmed).toString()
  } catch {
    return null
  }
}

/**
 * A find is two Opus calls plus a search loop plus our own fetch — plan for
 * 30-60 seconds. There is no progress signal from a non-streaming call, so the
 * line advances on a timer through the stages we know it is in. A silent
 * 45-second hang reads as broken; this is the difference between "working" and
 * "hung", not decoration.
 */
const STAGES = [
  { after: 0, text: 'Searching for recipes…' },
  { after: 12_000, text: 'Reading the pages it found…' },
  { after: 30_000, text: 'Writing it up…' },
]

function useStagedStatus(active: boolean, isUrl: boolean): string | null {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    if (!active) return
    // One timer per stage, including a 0ms one that resets the line at the
    // start of each run. Every setState lands in a timer callback rather than
    // in the effect body.
    const timers = STAGES.map((s, index) =>
      setTimeout(() => setStage(index), s.after),
    )
    return () => timers.forEach(clearTimeout)
  }, [active])

  if (!active) return null
  // The URL path skips discovery entirely, so it gets one honest line.
  if (isUrl) return 'Reading that page…'
  return STAGES[stage].text
}

export default function AskBox() {
  const [text, setText] = useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Standing preferences are applied server-side; this line is so you can see
  // that they were, and reach them, from where they act (§9.4). A failed read
  // says nothing rather than erroring the box — the find still works.
  const settings = useQuery({
    queryKey: recipeKeys.settings,
    queryFn: getSettings,
  })
  const preferences = settings.data?.preferences ?? []

  const url = asUrl(text)

  const mutation = useMutation({
    mutationFn: async (input: string): Promise<FindResult | Recipe> => {
      const parsed = asUrl(input)
      return parsed ? scrapeRecipe(parsed) : findRecipe(input.trim())
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: recipeKeys.all })
      setText('')
      // Saves immediately, then you edit — no preview-before-save step.
      if ('recipe' in result) {
        // The recipe page shows "Found X on Y" and offers the runners-up.
        rememberFind(result)
        await navigate({ to: '/recipes/$id', params: { id: String(result.recipe.id) } })
      } else {
        forgetFind()
        await navigate({ to: '/recipes/$id', params: { id: String(result.id) } })
      }
    },
  })

  const status = useStagedStatus(mutation.isPending, url !== null)

  return (
    <form
      className="rb-ask"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim() && !mutation.isPending) mutation.mutate(text)
      }}
    >
      <div className="rb-ask-row">
        <input
          className="rb-ask-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="give me a homemade pancakes recipe"
          aria-label="What would you like to cook?"
          disabled={mutation.isPending}
        />
        <button
          className="rb-button"
          type="submit"
          disabled={mutation.isPending || text.trim() === ''}
        >
          {url ? 'Fetch' : 'Add'}
        </button>
      </div>

      {/* The URL path is read as-is, so the preferences do not apply to it. */}
      {!url && preferences.length > 0 && !mutation.isPending && (
        <p className="rb-note rb-ask-note">
          Searching with your {preferences.length}{' '}
          {preferences.length === 1 ? 'preference' : 'preferences'} —{' '}
          <Link to="/recipes/settings" className="rb-link">
            {preferences.join(', ')}
          </Link>
        </p>
      )}

      {status && (
        <p className="rb-status" role="status">
          {status}
        </p>
      )}
      {mutation.isError && !mutation.isPending && (
        <p className="rb-error" role="alert">
          {mutation.error.message}
        </p>
      )}
    </form>
  )
}
