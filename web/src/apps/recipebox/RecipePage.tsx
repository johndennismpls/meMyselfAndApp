import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker, useNavigate, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import {
  deleteRecipe,
  getRecipe,
  imageUrl,
  recipeKeys,
  removeImage,
  scrapeRecipe,
  updateRecipe,
  uploadImage,
} from './api'
import { forgetFind, takeFind } from './lastFind'
import { changesIn, draftOf, isDirty, type Draft } from './draft'
import RecipeForm from './RecipeForm'
import './recipebox.css'
import type { Candidate, Recipe } from './types'

/** §9.3. View by default, with an Edit toggle that swaps in one form. */
export default function RecipePage() {
  const { id } = useParams({ from: '/recipes/$id' })
  const recipeId = Number(id)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [dismissedBanner, setDismissedBanner] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const recipe = useQuery({
    queryKey: recipeKeys.detail(recipeId),
    queryFn: () => getRecipe(recipeId),
  })

  const dirty = draft !== null && recipe.data !== undefined && isDirty(draft, recipe.data)

  // Navigating away with unsaved edits asks first.
  useBlocker({
    shouldBlockFn: () =>
      dirty && !window.confirm('Discard your unsaved changes to this recipe?'),
    enableBeforeUnload: () => dirty,
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!draft || !recipe.data) return recipe.data!
      const changes = changesIn(draft, recipe.data)
      if (Object.keys(changes).length === 0) return recipe.data
      return updateRecipe(recipeId, changes)
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(recipeKeys.detail(recipeId), updated)
      await queryClient.invalidateQueries({ queryKey: recipeKeys.all })
      setDraft(null)
    },
  })

  const image = useMutation({
    mutationFn: (file: File | null) =>
      file ? uploadImage(recipeId, file) : removeImage(recipeId),
    onSuccess: async (updated) => {
      queryClient.setQueryData(recipeKeys.detail(recipeId), updated)
      await queryClient.invalidateQueries({ queryKey: recipeKeys.all })
    },
  })

  const destroy = useMutation({
    mutationFn: () => deleteRecipe(recipeId),
    onSuccess: async () => {
      setDraft(null)
      forgetFind()
      await queryClient.invalidateQueries({ queryKey: recipeKeys.all })
      await navigate({ to: '/recipes' })
    },
  })

  // Runs the next candidate from the find that landed here — no second
  // discovery call, because /recipes/find already returned the runners-up.
  const alternate = useMutation({
    mutationFn: (candidate: Candidate) => scrapeRecipe(candidate.url),
    onSuccess: async (created) => {
      forgetFind()
      await queryClient.invalidateQueries({ queryKey: recipeKeys.all })
      await navigate({ to: '/recipes/$id', params: { id: String(created.id) } })
    },
  })

  if (recipe.isPending) return <p className="rb-note">Loading…</p>
  if (recipe.isError)
    return (
      <p className="rb-error" role="alert">
        {recipe.error.message}
      </p>
    )

  const data = recipe.data
  const found = takeFind(recipeId)
  const editing = draft !== null

  return (
    <section className="rb rb-detail">
      <header className="rb-header rb-controls">
        <Link to="/recipes" className="rb-link">
          ← Recipe Box
        </Link>
        {editing ? (
          <span className="rb-actions">
            <button
              className="rb-button"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              className="rb-text-button"
              onClick={() => setDraft(null)}
              disabled={save.isPending}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button className="rb-button" onClick={() => setDraft(draftOf(data))}>
            Edit
          </button>
        )}
      </header>

      {found && !dismissedBanner && !editing && (
        <div className="rb-found">
          <p>
            Found <strong>{data.title}</strong> on {found.siteName}
          </p>
          <span className="rb-actions">
            {found.alternates.length > 0 && (
              <button
                className="rb-text-button"
                onClick={() => alternate.mutate(found.alternates[0])}
                disabled={alternate.isPending}
              >
                {alternate.isPending ? 'Fetching…' : 'Try a different source'}
              </button>
            )}
            <button className="rb-text-button" onClick={() => setDismissedBanner(true)}>
              Dismiss
            </button>
          </span>
        </div>
      )}
      {alternate.isError && (
        <p className="rb-error" role="alert">
          {alternate.error.message}
        </p>
      )}

      {editing ? (
        <>
          <RecipeForm recipe={data} draft={draft} onChange={setDraft} />

          <div className="rb-image-controls rb-controls">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) image.mutate(file)
                event.target.value = ''
              }}
              hidden
            />
            <button
              className="rb-text-button"
              onClick={() => fileInput.current?.click()}
              disabled={image.isPending}
            >
              {data.hasImage ? 'Replace picture' : 'Add a picture'}
            </button>
            {data.hasImage && (
              <button
                className="rb-text-button"
                onClick={() => image.mutate(null)}
                disabled={image.isPending}
              >
                Remove picture
              </button>
            )}
          </div>
          {image.isError && (
            <p className="rb-error" role="alert">
              {image.error.message}
            </p>
          )}
          {save.isError && (
            <p className="rb-error" role="alert">
              {save.error.message}
            </p>
          )}

          {/* Red marks errors in this palette, so delete gets no red button. */}
          <div className="rb-danger rb-controls">
            <button
              className="rb-text-button"
              onClick={() => {
                if (window.confirm(`Delete “${data.title}”? This cannot be undone.`))
                  destroy.mutate()
              }}
              disabled={destroy.isPending}
            >
              Delete this recipe
            </button>
          </div>
        </>
      ) : (
        <RecipeView recipe={data} />
      )}
    </section>
  )
}

/** The read view, and the thing that gets printed. */
function RecipeView({ recipe }: { recipe: Recipe }) {
  return (
    <article className="rb-recipe">
      <h1>{recipe.title}</h1>

      {recipe.hasImage && (
        <img src={imageUrl(recipe)} alt="" className="rb-hero" />
      )}

      {recipe.description && <p className="rb-description">{recipe.description}</p>}

      <p className="rb-meta">
        {recipe.origin && <span className="rb-badge">{recipe.origin}</span>}
        {recipe.servings !== null && <span>Serves {recipe.servings}</span>}
        {recipe.yieldText && <span>{recipe.yieldText}</span>}
        {recipe.prepMinutes !== null && <span>Prep {recipe.prepMinutes} min</span>}
        {recipe.cookMinutes !== null && <span>Cook {recipe.cookMinutes} min</span>}
        {recipe.totalMinutes !== null && <span>Total {recipe.totalMinutes} min</span>}
      </p>

      {recipe.ingredients.length > 0 && (
        <section className="rb-section">
          <h2>Ingredients</h2>
          {recipe.ingredients.map((group, index) => (
            <div key={index} className="rb-ingredient-group">
              {group.heading && <h3>{group.heading}</h3>}
              <ul>
                {group.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {recipe.steps.length > 0 && (
        <section className="rb-section">
          <h2>Steps</h2>
          <ol>
            {recipe.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      {recipe.notes.length > 0 && (
        <section className="rb-section">
          <h2>Notes</h2>
          <ul>
            {recipe.notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Shown in both modes. There is no link back — it isn't stored (§1.3). */}
      {recipe.requestText && (
        <p className="rb-note rb-provenance">Found for: {recipe.requestText}</p>
      )}
    </article>
  )
}
