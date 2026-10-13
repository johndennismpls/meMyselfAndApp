import {
  BadGatewayException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ClaudeRepository } from './claude.repository';
import { EXTRACTION_SYSTEM, userTurn } from './extraction.prompt';
import { ExtractedRecipe } from './extraction.schema';
import type { CleanedPage } from './scrape.service';
import { RecipeTrace } from './trace';

/**
 * Stage 2 (§5). Identical for both entry paths. It is handed page text and asked
 * what recipe is in it; it is never told what was wanted, which is the whole
 * anti-fabrication design (§1.1).
 */
@Injectable()
export class ExtractionService {
  constructor(
    private readonly claude: ClaudeRepository,
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

    // An SDK throw is a 502 — the service failed, which is not the same thing
    // as the page not holding a recipe.
    let response;
    try {
      response = await this.claude.parse({
        maxTokens: 16000,
        system: EXTRACTION_SYSTEM,
        user: userTurn(page, url),
        schema: ExtractedRecipe,
        thinking: true,
        // Reading a page you were handed is routine. Raise only if measurement
        // shows a real failure rate.
        effort: 'low',
        // No `tools`. Not an omission — stage 2 has no business touching the
        // network, and an empty tool set is what makes that unambiguous.
      });
    } catch (error) {
      this.trace.error('recipe.failed', error, {
        stage: 'extraction',
        status: 502,
        url,
      });
      throw new BadGatewayException(
        'The extraction service failed. Try again.',
      );
    }

    // Checked before reading content. Recipes are not a refusal-prone domain, so
    // server-side fallbacks are deliberately not wired up (§5.3).
    if (response.stopReason === 'refusal') {
      this.trace.event('recipe.extraction', {
        isRecipe: false,
        rejectionReason: 'refusal',
        title: null,
        usage: response.usage,
        stopReason: response.stopReason,
      });
      throw new UnprocessableEntityException(
        "Couldn't extract a recipe from that page.",
      );
    }

    const parsed = response.parsed;
    if (!parsed) {
      throw new BadGatewayException(
        'The extraction service failed. Try again.',
      );
    }

    this.trace.event('recipe.extraction', {
      isRecipe: parsed.is_recipe,
      rejectionReason: parsed.rejection_reason,
      title: parsed.is_recipe ? parsed.title : null,
      usage: response.usage,
      stopReason: response.stopReason,
    });

    if (!parsed.is_recipe) {
      return {
        ok: false,
        rejectionReason: parsed.rejection_reason ?? "That page isn't a recipe.",
      };
    }

    return { ok: true, recipe: parsed };
  }
}
