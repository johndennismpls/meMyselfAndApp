import type { IngredientGroup, Recipe, RecipeEdit } from './types'

/**
 * The draft shape behind the edit form (§9.3), and the pure conversions between
 * it and a Recipe. Separate from the component so fast refresh keeps working.
 *
 * Ingredients, steps, and notes are edited as text with one item per line — the
 * fastest thing to hand-edit, and a clean round trip to string[] with a split.
 */

/** The form's own state: the record, with the list fields as raw text. */
export interface Draft {
  title: string
  description: string
  origin: string
  servings: string
  yieldText: string
  prepMinutes: string
  cookMinutes: string
  totalMinutes: string
  groups: { heading: string; items: string }[]
  steps: string
  notes: string
}

const toLines = (items: string[]) => items.join('\n')

/** Blank lines are dropped; order is the array's job. */
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const numberOrNull = (text: string): number | null => {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value > 0 ? value : null
}

const textOrNull = (text: string): string | null =>
  text.trim() === '' ? null : text.trim()

export function draftOf(recipe: Recipe): Draft {
  return {
    title: recipe.title,
    description: recipe.description ?? '',
    origin: recipe.origin ?? '',
    servings: recipe.servings?.toString() ?? '',
    yieldText: recipe.yieldText ?? '',
    prepMinutes: recipe.prepMinutes?.toString() ?? '',
    cookMinutes: recipe.cookMinutes?.toString() ?? '',
    totalMinutes: recipe.totalMinutes?.toString() ?? '',
    groups: recipe.ingredients.map((group) => ({
      heading: group.heading ?? '',
      items: toLines(group.items),
    })),
    steps: toLines(recipe.steps),
    notes: toLines(recipe.notes),
  }
}

function ingredientsOf(draft: Draft): IngredientGroup[] {
  return draft.groups
    .map((group) => ({
      heading: textOrNull(group.heading),
      items: fromLines(group.items),
    }))
    .filter((group) => group.items.length > 0)
}

/** Only what actually changed goes in the PATCH. */
export function changesIn(draft: Draft, recipe: Recipe): RecipeEdit {
  const next = {
    title: draft.title.trim(),
    description: textOrNull(draft.description),
    origin: textOrNull(draft.origin),
    servings: numberOrNull(draft.servings),
    yieldText: textOrNull(draft.yieldText),
    prepMinutes: numberOrNull(draft.prepMinutes),
    cookMinutes: numberOrNull(draft.cookMinutes),
    totalMinutes: numberOrNull(draft.totalMinutes),
    ingredients: ingredientsOf(draft),
    steps: fromLines(draft.steps),
    notes: fromLines(draft.notes),
  }

  const changed: RecipeEdit = {}
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(recipe[key])) {
      Object.assign(changed, { [key]: next[key] })
    }
  }
  return changed
}

export const isDirty = (draft: Draft, recipe: Recipe): boolean =>
  Object.keys(changesIn(draft, recipe)).length > 0
