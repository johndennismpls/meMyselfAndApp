import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  BadGatewayException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ANTHROPIC } from './anthropic.provider';
import { EXTRACTION_SYSTEM, userTurn } from './extraction.prompt';
import { ExtractedRecipe } from './extraction.schema';
import { RECIPE_MAX_TOKENS, RECIPE_MODEL } from './models';
import type { CleanedPage } from './scrape.service';
import { RecipeTrace, usageOf } from './trace';

/**
 * Stage 2 (§5). Identical for both entry paths. It is handed page text and asked
 * what recipe is in it; it is never told what was wanted, which is the whole
 * anti-fabrication design (§1.1).
 */
@Injectable()
export class ExtractionService {
  constructor(
    @Inject(ANTHROPIC) private readonly client: Anthropic,
    private readonly trace: RecipeTrace,
  ) {}

  /**
   * Returns the extracted recipe, or null when the page turned out not to hold
   * one — `/recipes/find` walks to the next candidate rather than failing, so
   * the not-a-recipe case is a value here and a 422 at the controller edge.
   */
  async extract(
    page: CleanedPage,
    url: string,
  ): Promise<
    | { ok: true; recipe: ExtractedRecipe }
    | { ok: false; rejectionReason: string }
  > {
    this.trace.event('recipe.pageText', {
      url,
      chars: page.text.length,
      // Structured field, never interpolated into the message string.
      text: page.text,
    });

    const response = await this.call(page, url);

    // Checked before reading content. Recipes are not a refusal-prone domain, so
    // server-side fallbacks are deliberately not wired up (§5.3).
    if (response.stop_reason === 'refusal') {
      this.trace.event('recipe.extraction', {
        isRecipe: false,
        rejectionReason: 'refusal',
        title: null,
        usage: usageOf(response.usage, RECIPE_MODEL),
        stopReason: response.stop_reason,
      });
      throw new UnprocessableEntityException(
        "Couldn't extract a recipe from that page.",
      );
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new BadGatewayException(
        'The extraction service failed. Try again.',
      );
    }

    this.trace.event('recipe.extraction', {
      isRecipe: parsed.is_recipe,
      rejectionReason: parsed.rejection_reason,
      title: parsed.is_recipe ? parsed.title : null,
      usage: usageOf(response.usage, RECIPE_MODEL),
      stopReason: response.stop_reason,
    });

    if (!parsed.is_recipe) {
      return {
        ok: false,
        rejectionReason: parsed.rejection_reason ?? "That page isn't a recipe.",
      };
    }

    return { ok: true, recipe: parsed };
  }

  /**
   * The call itself. An SDK throw is a 502 — the service failed, which is not
   * the same thing as the page not holding a recipe.
   */
  private async call(page: CleanedPage, url: string) {
    try {
      return await this.client.messages.parse({
        model: RECIPE_MODEL,
        max_tokens: RECIPE_MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: EXTRACTION_SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
        ],
        thinking: { type: 'adaptive' },
        // No `tools` array. Not an omission — stage 2 has no business touching
        // the network, and an empty tool set is what makes that unambiguous.
        output_config: {
          // Reading a page you were handed is routine. Raise only if measurement
          // shows a real failure rate.
          effort: 'low',
          format: zodOutputFormat(ExtractedRecipe),
        },
        messages: [{ role: 'user', content: userTurn(page, url) }],
      });
    } catch {
      throw new BadGatewayException(
        'The extraction service failed. Try again.',
      );
    }
  }
}
