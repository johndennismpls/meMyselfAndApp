import type { FindResult } from './types'

/**
 * The banner on §9.2 — *"Found **Fluffy Buttermilk Pancakes** on Serious Eats"*
 * plus **Try a different source** — is shown by the recipe page, but the data
 * comes from the find the list page just ran. This hands it across the
 * navigation.
 *
 * Deliberately in memory and deliberately single-slot: it is a transient piece
 * of "what just happened", not state. A reload clears it, which is correct —
 * the alternates lose their meaning once you have moved on, and nothing on the
 * record points back at a source (§1.3).
 */

let lastFind: FindResult | null = null

export function rememberFind(result: FindResult): void {
  lastFind = result
}

/** Returns the find for this recipe, if it is the one that just happened. */
export function takeFind(recipeId: number): FindResult | null {
  return lastFind?.recipe.id === recipeId ? lastFind : null
}

export function forgetFind(): void {
  lastFind = null
}
