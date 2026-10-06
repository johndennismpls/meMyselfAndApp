import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { ANTHROPIC } from './anthropic.provider';
import { usageOf, type Usage } from './trace';

/**
 * The model every recipes call runs on. Spec §5.4: not an env var, not a
 * request parameter, not a user setting. Changing models changes output
 * quality in ways only a prompt-and-eval pass can judge, so it should arrive as
 * a commit.
 */
export const RECIPE_MODEL = 'claude-opus-5';

/**
 * Everything one call needs. The prompt and knobs come from the caller — this
 * repository owns how a call is made, never what it says.
 */
export interface ClaudeCall<S extends z.ZodType> {
  maxTokens: number;
  /** Sent as one cached block, so it must stay free of per-request text (§5.5). */
  system: string;
  user: string;
  /** The structured output the reply is parsed against. */
  schema: S;
  /** Adaptive thinking. Off unless asked for. */
  thinking?: boolean;
  effort?: 'low' | 'medium' | 'high';
  /** Omitted entirely when absent — an empty tool set is a guarantee (§5.3). */
  tools?: Anthropic.Messages.ToolUnion[];
}

export interface ClaudeReply<T> {
  /** Null when the reply didn't parse; the caller decides what that means. */
  parsed: T | null;
  /** The raw blocks, for callers that read tool results (grounding, §3.4). */
  content: Anthropic.ContentBlock[];
  stopReason: Anthropic.StopReason | null;
  usage: Usage;
}

/**
 * The one door to the Anthropic API in the recipes domain. SDK errors are
 * thrown as-is: each caller maps them to its own user-facing message.
 */
@Injectable()
export class ClaudeRepository {
  constructor(@Inject(ANTHROPIC) private readonly client: Anthropic) {}

  async parse<S extends z.ZodType>(
    call: ClaudeCall<S>,
  ): Promise<ClaudeReply<z.infer<S>>> {
    const response = await this.client.messages.parse({
      model: RECIPE_MODEL,
      max_tokens: call.maxTokens,
      system: [
        {
          type: 'text',
          text: call.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      ...(call.thinking ? { thinking: { type: 'adaptive' as const } } : {}),
      ...(call.tools ? { tools: call.tools } : {}),
      output_config: {
        ...(call.effort ? { effort: call.effort } : {}),
        format: zodOutputFormat(call.schema),
      },
      messages: [{ role: 'user', content: call.user }],
    });

    return {
      // Lazy, so a caller that checks stopReason first never touches a refused
      // reply's content (§5.3).
      get parsed() {
        return response.parsed_output ?? null;
      },
      content: response.content,
      stopReason: response.stop_reason,
      usage: usageOf(response.usage, RECIPE_MODEL),
    };
  }
}
