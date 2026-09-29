import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { IngredientGroup } from '../extraction.schema';

export class IngredientGroupDto implements IngredientGroup {
  @ApiProperty({
    description: 'Group heading, or null for the ungrouped default list.',
    example: 'For the buttermilk substitute',
    nullable: true,
    type: String,
  })
  heading: string | null;

  @ApiProperty({
    description: 'One line per ingredient, "<quantity> <unit> <item>, <prep>".',
    example: ['1 1/2 cups all-purpose flour', '2 tablespoons butter, melted'],
    type: [String],
  })
  items: string[];
}

/** The full record. Everything the detail page and the edit form need. */
export class RecipeDto {
  @ApiProperty({ example: 42 })
  id: number;

  @ApiProperty({ example: 'Fluffy Buttermilk Pancakes' })
  title: string;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;

  @ApiProperty({ type: [IngredientGroupDto] })
  ingredients: IngredientGroupDto[];

  @ApiProperty({ type: [String] })
  steps: string[];

  @ApiProperty({ type: [String] })
  notes: string[];

  @ApiProperty({ nullable: true, type: String })
  origin: string | null;

  @ApiProperty({ nullable: true, type: Number })
  servings: number | null;

  @ApiProperty({
    description: 'Used when a servings count doesn\'t fit, e.g. "24 cookies".',
    nullable: true,
    type: String,
  })
  yieldText: string | null;

  @ApiProperty({ nullable: true, type: Number })
  prepMinutes: number | null;

  @ApiProperty({ nullable: true, type: Number })
  cookMinutes: number | null;

  @ApiProperty({ nullable: true, type: Number })
  totalMinutes: number | null;

  @ApiProperty({
    description: 'Whether GET /recipes/:id/image will return bytes.',
  })
  hasImage: boolean;

  @ApiProperty({
    description: 'What you typed, on the find path. Null for a pasted URL.',
    nullable: true,
    type: String,
  })
  requestText: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

/** Enough for a card without shipping every step to the index page (§7). */
export class RecipeSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty() title: string;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ nullable: true, type: String }) origin: string | null;
  @ApiProperty({ nullable: true, type: Number }) totalMinutes: number | null;
  @ApiProperty() hasImage: boolean;
  @ApiPropertyOptional({
    description: 'Ingredient lines, flattened — feeds the client-side filter.',
    type: [String],
  })
  ingredientText: string[];
}

export class CandidateDto {
  @ApiProperty() url: string;
  @ApiProperty() siteName: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'One line on why this page fits the request.' })
  why: string;
}

/** The saved recipe plus the runners-up, so "try a different source" is free. */
export class FindResultDto {
  @ApiProperty({ type: RecipeDto }) recipe: RecipeDto;
  @ApiProperty({ example: 'homemade buttermilk pancakes' })
  interpretedAs: string;
  /**
   * The winning candidate's site, so the UI can say "Found X on Serious Eats"
   * (§3.6). Returned, never stored — the record holds no attribution (§1.3).
   */
  @ApiProperty({ example: 'Serious Eats' })
  siteName: string;
  @ApiProperty() why: string;
  @ApiProperty({ type: [CandidateDto] }) alternates: CandidateDto[];
}

/** The standing preferences applied to every find. */
export class RecipeSettingsDto {
  @ApiProperty({
    description:
      'One standing instruction per entry, applied to every find request.',
    example: ['No tree nuts', 'I only have a microwave'],
    type: [String],
  })
  preferences: string[];

  @ApiProperty({
    description: 'Null until they have been saved once.',
    nullable: true,
    type: String,
  })
  updatedAt: string | null;
}
