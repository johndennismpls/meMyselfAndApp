/**
 * Mirrors the API's extraction schema by hand (spec §5.1). A shared types
 * package would remove the drift; deferred in §13 until a second app needs one.
 */

export interface IngredientGroup {
  /** null for the ungrouped default list. */
  heading: string | null
  items: string[]
}

export interface Recipe {
  id: number
  title: string
  description: string | null
  ingredients: IngredientGroup[]
  steps: string[]
  notes: string[]
  origin: string | null
  servings: number | null
  yieldText: string | null
  prepMinutes: number | null
  cookMinutes: number | null
  totalMinutes: number | null
  hasImage: boolean
  /** What you typed, on the find path. There is no link back to the source. */
  requestText: string | null
  createdAt: string
  updatedAt: string
}

export interface RecipeSummary {
  id: number
  title: string
  description: string | null
  origin: string | null
  totalMinutes: number | null
  hasImage: boolean
  /** Flattened ingredient lines, for the client-side filter. */
  ingredientText: string[]
}

export interface Candidate {
  url: string
  siteName: string
  title: string
  why: string
}

export interface FindResult {
  recipe: Recipe
  interpretedAs: string
  /** The winning candidate's site — the only place it appears (§1.3). */
  siteName: string
  why: string
  /** The runners-up, so "try a different source" costs no second find. */
  alternates: Candidate[]
}

/** The writable fields. Mirrors UpdateRecipeDto. */
export type RecipeEdit = Partial<
  Pick<
    Recipe,
    | 'title'
    | 'description'
    | 'ingredients'
    | 'steps'
    | 'notes'
    | 'origin'
    | 'servings'
    | 'yieldText'
    | 'prepMinutes'
    | 'cookMinutes'
    | 'totalMinutes'
  >
>
