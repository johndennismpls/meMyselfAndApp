import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { IngredientGroup } from '../extraction.schema';

/**
 * The write shapes. Create and Update reuse the extraction Zod shapes minus
 * `is_recipe` and `rejection_reason` (§7), so a hand-edit cannot put a record
 * into a state the extractor could not have produced.
 *
 * Validation is the Zod schema; the classes exist for Swagger.
 */

const RecipeFields = {
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  ingredients: z.array(IngredientGroup),
  steps: z.array(z.string()),
  notes: z.array(z.string()),
  origin: z.string().nullable(),
  servings: z.number().int().positive().nullable(),
  yieldText: z.string().nullable(),
  prepMinutes: z.number().int().positive().nullable(),
  cookMinutes: z.number().int().positive().nullable(),
  totalMinutes: z.number().int().positive().nullable(),
};

export const CreateRecipeSchema = z.object(RecipeFields).partial({
  description: true,
  ingredients: true,
  steps: true,
  notes: true,
  origin: true,
  servings: true,
  yieldText: true,
  prepMinutes: true,
  cookMinutes: true,
  totalMinutes: true,
});

/** All fields optional — a PATCH carries only what changed. */
export const UpdateRecipeSchema = z.object(RecipeFields).partial();

export const FindRequestSchema = z.object({
  request: z.string().trim().min(1).max(500),
});

export const ScrapeRequestSchema = z.object({
  url: z.string().trim().min(1).max(2000),
});

/**
 * The standing preferences (§9.4). A PUT of the whole list, not a PATCH: the
 * settings page edits a textarea and saves what is in it, and a removed line
 * has to actually go.
 */
export const MAX_PREFERENCES = 20;

export const UpdateSettingsSchema = z.object({
  preferences: z
    .array(z.string().max(200))
    // A textarea ships blank lines and trailing spaces; neither belongs in a
    // prompt. Tidying before the count means a trailing newline is not an error.
    .transform((lines) => lines.map((line) => line.trim()).filter(Boolean))
    .refine((lines) => lines.length <= MAX_PREFERENCES, {
      message: `Keep it to ${MAX_PREFERENCES} preferences or fewer.`,
    }),
});

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>;

/** What was already suggested this session, so "Inspire me" again moves on. */
export const InspireRequestSchema = z.object({
  previous: z.array(z.string().max(500)).max(20).default([]),
});

export type InspireRequestInput = z.infer<typeof InspireRequestSchema>;

export type CreateRecipeInput = z.infer<typeof CreateRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof UpdateRecipeSchema>;

export class FindRequestDto {
  @ApiProperty({
    example: 'give me a homemade pancakes recipe',
    maxLength: 500,
  })
  request: string;
}

export class ScrapeRequestDto {
  @ApiProperty({ example: 'https://www.seriouseats.com/light-fluffy-pancakes' })
  url: string;
}

export class CreateRecipeDto {
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true, type: String }) description?:
    string | null;
  @ApiPropertyOptional({ type: [Object] }) ingredients?: IngredientGroup[];
  @ApiPropertyOptional({ type: [String] }) steps?: string[];
  @ApiPropertyOptional({ type: [String] }) notes?: string[];
  @ApiPropertyOptional({ nullable: true, type: String }) origin?: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) servings?:
    number | null;
  @ApiPropertyOptional({ nullable: true, type: String }) yieldText?:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) prepMinutes?:
    number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) cookMinutes?:
    number | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) totalMinutes?:
    number | null;
}

export class UpdateRecipeDto extends CreateRecipeDto {
  @ApiPropertyOptional() declare title: string;
}

export class InspireRequestDto {
  @ApiPropertyOptional({
    description: 'Suggestions already shown this session, to avoid repeats.',
    example: ['give me a smoky black bean chili with chipotle'],
    type: [String],
  })
  previous?: string[];
}

export class UpdateSettingsDto {
  @ApiProperty({
    description: 'The full list. Blank entries are dropped on save.',
    example: ['No tree nuts', 'I only have a microwave'],
    type: [String],
  })
  preferences: string[];
}
