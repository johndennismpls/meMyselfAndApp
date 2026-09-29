import type {
  FindResult,
  Recipe,
  RecipeEdit,
  RecipeSettings,
  RecipeSummary,
} from './types'

/**
 * Every call to the API lives here; components never call fetch directly.
 *
 * The error messages in §7.3 are written as user-facing copy and render
 * verbatim, so this unwraps Nest's error body rather than throwing a status.
 */

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>

  let message = `Something went wrong (${res.status}).`
  try {
    const body: unknown = await res.json()
    const raw = (body as { message?: unknown }).message
    if (typeof raw === 'string') message = raw
    else if (Array.isArray(raw) && typeof raw[0] === 'string') message = raw[0]
  } catch {
    // A non-JSON error body leaves the generic message in place.
  }
  throw new Error(message)
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const recipeKeys = {
  all: ['recipes'] as const,
  detail: (id: number) => ['recipes', id] as const,
  /**
   * Deliberately not under `all`: a find invalidates every recipe key, and the
   * standing preferences did not change just because a recipe was saved.
   */
  settings: ['recipe-settings'] as const,
}

export async function listRecipes(): Promise<RecipeSummary[]> {
  return unwrap(await fetch('/api/recipes'))
}

export async function getRecipe(id: number): Promise<Recipe> {
  return unwrap(await fetch(`/api/recipes/${id}`))
}

/** The ask box, plain-English path. Two Opus calls: expect 30-60 seconds. */
export async function findRecipe(request: string): Promise<FindResult> {
  return unwrap(await fetch('/api/recipes/find', json('POST', { request })))
}

/** The ask box, pasted-URL path. Extraction only, so notably faster. */
export async function scrapeRecipe(url: string): Promise<Recipe> {
  return unwrap(await fetch('/api/recipes/scrape', json('POST', { url })))
}

export async function getSettings(): Promise<RecipeSettings> {
  return unwrap(await fetch('/api/recipes/settings'))
}

/** A PUT of the whole list: what you leave out is what you removed. */
export async function updateSettings(
  preferences: string[],
): Promise<RecipeSettings> {
  return unwrap(
    await fetch('/api/recipes/settings', json('PUT', { preferences })),
  )
}

export async function updateRecipe(id: number, edit: RecipeEdit): Promise<Recipe> {
  return unwrap(await fetch(`/api/recipes/${id}`, json('PATCH', edit)))
}

export async function deleteRecipe(id: number): Promise<void> {
  const res = await fetch(`/api/recipes/${id}`, { method: 'DELETE' })
  if (!res.ok) await unwrap(res)
}

export async function uploadImage(id: number, file: File): Promise<Recipe> {
  const form = new FormData()
  form.append('image', file)
  return unwrap(await fetch(`/api/recipes/${id}/image`, { method: 'PUT', body: form }))
}

export async function removeImage(id: number): Promise<Recipe> {
  return unwrap(await fetch(`/api/recipes/${id}/image`, { method: 'DELETE' }))
}

/**
 * The image URL. The response is `immutable`, so a replace needs a new URL:
 * `updatedAt` supplies one. The list has no `updatedAt`, and doesn't need it —
 * nothing replaces an image from there.
 */
export function imageUrl(recipe: { id: number; updatedAt?: string }): string {
  const base = `/api/recipes/${recipe.id}/image`
  return recipe.updatedAt
    ? `${base}?v=${encodeURIComponent(recipe.updatedAt)}`
    : base
}
