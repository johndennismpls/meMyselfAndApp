import { Injectable, Logger, Scope } from '@nestjs/common';
import { nanoid } from 'nanoid';

/**
 * The trace log (§6.4). Nothing on the record says where a recipe came from
 * (§1.3), so these lines are the only provenance there is. A log rotation policy
 * that discards them is discarding the provenance too.
 *
 * Every payload is passed as a structured object, never interpolated into the
 * message string, so a recipe page containing log-shaped text cannot forge a
 * line.
 */

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  model: string;
}

@Injectable({ scope: Scope.REQUEST })
export class RecipeTrace {
  private readonly logger = new Logger('RecipeTrace');
  readonly traceId = nanoid(12);
  private recipeId: number | null = null;

  /** Once the row exists, every later line can be walked back to it. */
  bind(recipeId: number): void {
    this.recipeId = recipeId;
  }

  event(name: string, fields: Record<string, unknown>): void {
    this.logger.log({
      event: name,
      traceId: this.traceId,
      ...(this.recipeId !== null ? { recipeId: this.recipeId } : {}),
      ...fields,
    });
  }
}

/** Pulls the four numbers worth keeping off an SDK usage object (§5.4). */
export function usageOf(
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
  },
  model: string,
): Usage {
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    model,
  };
}
