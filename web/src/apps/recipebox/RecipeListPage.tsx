import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import AskBox from './AskBox'
import { imageUrl, listRecipes, recipeKeys } from './api'
import './recipebox.css'
import type { RecipeSummary } from './types'

/**
 * §9.2. The ask box on top, a card grid below, and a client-side filter over
 * title, origin, and ingredient text — a personal recipe box is dozens of rows,
 * not thousands, so there is no server search in v1.
 */

function matches(recipe: RecipeSummary, needle: string): boolean {
  const haystack = [recipe.title, recipe.origin ?? '', ...recipe.ingredientText]
    .join('\n')
    .toLowerCase()
  return haystack.includes(needle)
}

export default function RecipeListPage() {
  const [filter, setFilter] = useState('')
  const recipes = useQuery({ queryKey: recipeKeys.all, queryFn: listRecipes })

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return recipes.data ?? []
    return (recipes.data ?? []).filter((recipe) => matches(recipe, needle))
  }, [recipes.data, filter])

  return (
    <section className="rb">
      <header className="rb-header">
        <h1>Recipe Box</h1>
        <Link to="/" className="rb-link">
          ← Home
        </Link>
      </header>

      <AskBox />

      {recipes.isPending ? (
        <p className="rb-note">Loading…</p>
      ) : recipes.isError ? (
        <p className="rb-error" role="alert">
          {recipes.error.message}
        </p>
      ) : recipes.data.length === 0 ? (
        // The empty state explains the ask box rather than showing a blank grid.
        <div className="rb-empty">
          <h2>Nothing in the box yet</h2>
          <p>
            Type what you feel like cooking — <em>give me a homemade pancakes
            recipe</em> — and it will go and find one. Paste a link instead and
            it will read that page directly.
          </p>
        </div>
      ) : (
        <>
          <input
            className="rb-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by title, origin, or ingredient"
            aria-label="Filter recipes"
          />

          {shown.length === 0 ? (
            <p className="rb-note">Nothing matches “{filter.trim()}”.</p>
          ) : (
            <ul className="rb-grid">
              {shown.map((recipe) => (
                <li key={recipe.id}>
                  <Link
                    to="/recipes/$id"
                    params={{ id: String(recipe.id) }}
                    className="rb-card"
                  >
                    {recipe.hasImage ? (
                      <img src={imageUrl(recipe)} alt="" className="rb-card-image" />
                    ) : (
                      <span className="rb-card-image rb-card-placeholder" aria-hidden />
                    )}
                    <span className="rb-card-body">
                      <span className="rb-card-title">{recipe.title}</span>
                      <span className="rb-card-meta">
                        {recipe.origin && (
                          <span className="rb-badge">{recipe.origin}</span>
                        )}
                        {recipe.totalMinutes !== null && (
                          <span>{recipe.totalMinutes} min</span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
