import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a body against a Zod schema. The extraction schema is the source of
 * truth for the record's shape (§5.1), so the write paths validate against the
 * same shapes rather than a second set of class-validator decorators.
 */
export class ZodBody<T extends z.ZodType> implements PipeTransform {
  constructor(
    private readonly schema: T,
    private readonly message?: string,
  ) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        this.message ?? result.error.issues[0]?.message ?? 'Invalid request.',
      );
    }
    return result.data;
  }
}
