import { z } from 'zod';

/**
 * Stage 1 returns *where to look*, never *what was found*. Spec §3.2: if this
 * schema ever grows an `ingredients` array, the anti-fabrication guarantee in
 * §1.1 is gone.
 */
export const Candidate = z.object({
  url: z.string(),
  site_name: z.string(),
  title: z.string(),
  /** One line: why this one fits the request. Surfaced in the UI. */
  why: z.string(),
});

export const Discovery = z.object({
  is_food_request: z.boolean(),
  rejection_reason: z.string().nullable(),
  /** "homemade buttermilk pancakes" — echoed to the UI. */
  interpreted_as: z.string(),
  /** Ranked, best first, up to RECIPE_MAX_CANDIDATES. */
  candidates: z.array(Candidate),
});

export type Candidate = z.infer<typeof Candidate>;
export type Discovery = z.infer<typeof Discovery>;
