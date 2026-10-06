import { BadGatewayException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ClaudeRepository } from './claude.repository';
import type { RecipeSummaryDto } from './dto/recipe.dto';
import { INSPIRE_SYSTEM, inspireTurn } from './inspire.prompt';
import { RecipeTrace } from './trace';

const Inspiration = z.object({
  /** One sentence, ready to drop into the ask box. */
  prompt: z.string(),
});

/**
 * "Inspire me". One call, no tools: it reads the box and suggests a request.
 * Nothing is saved — the suggestion lands in the ask box and the person
 * decides whether to send it.
 */
@Injectable()
export class InspireService {
  constructor(
    private readonly claude: ClaudeRepository,
    private readonly trace: RecipeTrace,
  ) { }

  async suggest(
    recipes: RecipeSummaryDto[],
    preferences: string[],
    previous: string[],
  ): Promise<string> {
    let response;
    try {
      response = await this.claude.parse({
        maxTokens: 1000,
        system: INSPIRE_SYSTEM,
        user: inspireTurn(recipes, preferences, previous),
        schema: Inspiration,
      });
    } catch {
      throw new BadGatewayException("Couldn't think of anything. Try again.");
    }

    const prompt = response.parsed?.prompt.trim();
    this.trace.event('recipe.inspire', {
      recipes: recipes.length,
      previous: previous.length,
      prompt: prompt ?? null,
      usage: response.usage,
      stopReason: response.stopReason,
    });

    if (!prompt) {
      throw new BadGatewayException("Couldn't think of anything. Try again.");
    }
    return prompt;
  }
}
