import Anthropic from '@anthropic-ai/sdk';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * One client, injected everywhere. Tests supply a stub in its place — §11.3: no
 * test may call the Anthropic API.
 */
export const ANTHROPIC = Symbol('ANTHROPIC');

export const anthropicProvider: Provider = {
  provide: ANTHROPIC,
  inject: [ConfigService],
  useFactory: (config: ConfigService) =>
    // getOrThrow, so the module refuses to boot without a key (§10) rather than
    // failing on the first find.
    new Anthropic({ apiKey: config.getOrThrow<string>('ANTHROPIC_API_KEY') }),
};
