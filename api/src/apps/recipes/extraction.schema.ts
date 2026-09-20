import { z } from 'zod';

/**
 * The source of truth for the whole app (§5.1). The Drizzle columns, the Nest
 * DTOs, and the web client's types all mirror this shape.
 */
export const IngredientGroup = z.object({
  /** null for the ungrouped default list. */
  heading: z.string().nullable(),
  items: z.array(z.string()),
});

export const ExtractedRecipe = z.object({
  /**
   * First field on purpose (§5.2.1). Without it the model will dutifully
   * extract a "recipe" from a roundup page, because that is what it was asked
   * to do.
   */
  is_recipe: z.boolean(),
  rejection_reason: z.string().nullable(),

  title: z.string(),
  description: z.string().nullable(),
  ingredients: z.array(IngredientGroup),
  steps: z.array(z.string()),
  notes: z.array(z.string()),
  origin: z.string().nullable(),

  servings: z.number().int().positive().nullable(),
  /** "24 cookies", for when a servings count doesn't fit. */
  yield_text: z.string().nullable(),
  prep_minutes: z.number().int().positive().nullable(),
  cook_minutes: z.number().int().positive().nullable(),
  total_minutes: z.number().int().positive().nullable(),

  /** The model's pick from the page. Resolved and downloaded in §8. */
  image_url: z.string().nullable(),
});

export type IngredientGroup = z.infer<typeof IngredientGroup>;
export type ExtractedRecipe = z.infer<typeof ExtractedRecipe>;
