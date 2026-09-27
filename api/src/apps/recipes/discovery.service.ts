import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  BadGatewayException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ANTHROPIC } from './anthropic.provider';
import { DISCOVERY_SYSTEM, discoveryTurn } from './discovery.prompt';
import { Discovery, type Candidate } from './discovery.schema';
import { assertGrounded, fetchedPageText } from './grounding';
import { RECIPE_MAX_TOKENS, RECIPE_MODEL } from './models';
import { RecipeTrace, usageOf } from './trace';

export interface DiscoveryResult {
  interpretedAs: string;
  candidates: Candidate[];
  /** Page text web_fetch already pulled, keyed by normalised URL (§4.3). */
  fetchedText: Map<string, string>;
}

/**
 * Stage 1 (§3). Input: what you typed. Output: ranked candidate URLs, and
 * nothing else. The only thing that crosses into stage 2 is a URL.
 */
@Injectable()
export class DiscoveryService {
  private readonly maxCandidates: number;

  constructor(
    @Inject(ANTHROPIC) private readonly client: Anthropic,
    private readonly trace: RecipeTrace,
    config: ConfigService,
  ) {
    this.maxCandidates = config.get<number>('RECIPE_MAX_CANDIDATES', 3);
  }

  /**
   * `preferences` are the standing lines from the settings page (§9.4) — the
   * same constraints on every find, so they never reach the request text we
   * store. An empty list leaves the turn exactly as it was before settings
   * existed.
   */
  async discover(
    userRequest: string,
    preferences: string[] = [],
  ): Promise<DiscoveryResult> {
    const response = await this.client.messages.parse({
      model: RECIPE_MODEL,
      max_tokens: RECIPE_MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: DISCOVERY_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      thinking: { type: 'adaptive' },
      tools: [
        // The _20260209 variants carry dynamic filtering, which is exactly right
        // when a recipe search returns ten near-identical SEO pages. They run
        // code execution internally, so code_execution is NOT declared here.
        { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
      ],
      output_config: {
        // Search-and-judge is genuinely harder than extraction; `low` tends to
        // grab the first result without opening it.
        effort: 'medium',
        format: zodOutputFormat(Discovery),
      },
      messages: [
        { role: 'user', content: discoveryTurn(userRequest, preferences) },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new UnprocessableEntityException(
        "Couldn't search for that. Try again.",
      );
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      throw new BadGatewayException(
        'The extraction service failed. Try again.',
      );
    }

    const usage = usageOf(response.usage, RECIPE_MODEL);

    if (!parsed.is_food_request) {
      this.trace.event('recipe.discovery', {
        interpretedAs: parsed.interpreted_as,
        candidates: [],
        groundingDropped: [],
        usage,
      });
      throw new UnprocessableEntityException(
        parsed.rejection_reason ?? "That doesn't sound like something to cook.",
      );
    }

    const grounded = assertGrounded(response.content, parsed.candidates);

    this.trace.event('recipe.discovery', {
      interpretedAs: parsed.interpreted_as,
      preferences,
      candidates: grounded.kept.map(summarise),
      groundingDropped: grounded.dropped.map(summarise),
      usage,
    });

    // Rule 2: no search ran, so whatever came back was written from memory.
    if (!grounded.searched) {
      throw new UnprocessableEntityException(
        "Couldn't search for that. Try again.",
      );
    }
    if (grounded.kept.length === 0) {
      throw new UnprocessableEntityException("Couldn't find that one online.");
    }

    return {
      interpretedAs: parsed.interpreted_as,
      candidates: grounded.kept.slice(0, this.maxCandidates),
      fetchedText: fetchedPageText(response.content),
    };
  }
}

function summarise(c: Candidate) {
  return { url: c.url, siteName: c.site_name, title: c.title, why: c.why };
}
