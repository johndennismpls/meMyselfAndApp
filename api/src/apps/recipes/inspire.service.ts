import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ANTHROPIC } from './anthropic.provider';
import type { RecipeSummaryDto } from './dto/recipe.dto';
import { INSPIRE_SYSTEM, inspireTurn } from './inspire.prompt';
import { INSPIRE_MAX_TOKENS, INSPIRE_MODEL } from './models';
import { RecipeTrace, usageOf } from './trace';

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
    @Inject(ANTHROPIC) private readonly client: Anthropic,
    private readonly trace: RecipeTrace,
  ) {}

  async suggest(
    recipes: RecipeSummaryDto[],
    preferences: string[],
    previous: string[],
  ): Promise<string> {
    let response;
    try {
      response = await this.client.messages.parse({
        model: INSPIRE_MODEL,
        max_tokens: INSPIRE_MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: INSPIRE_SYSTEM,
            cache_control: { type: 'ephemeral' },
          },
        ],
        output_config: { format: zodOutputFormat(Inspiration) },
        messages: [
          {
            role: 'user',
            content: inspireTurn(recipes, preferences, previous),
          },
        ],
      });
    } catch {
      throw new BadGatewayException("Couldn't think of anything. Try again.");
    }

    const prompt = response.parsed_output?.prompt.trim();
    this.trace.event('recipe.inspire', {
      recipes: recipes.length,
      previous: previous.length,
      prompt: prompt ?? null,
      usage: usageOf(response.usage, INSPIRE_MODEL),
      stopReason: response.stop_reason,
    });

    if (!prompt) {
      throw new BadGatewayException("Couldn't think of anything. Try again.");
    }
    return prompt;
  }
}
