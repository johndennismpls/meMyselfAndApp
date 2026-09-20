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
