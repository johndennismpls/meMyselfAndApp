/**
 * The model both stages run on. Spec §5.4: not an env var, not a request
 * parameter, not a user setting. Changing models changes output quality in ways
 * only a prompt-and-eval pass can judge, so it should arrive as a commit.
 *
 * If measurement ever argues for a cheaper extraction stage, split this into two
 * constants and commit that — the call sites already read from one module.
 */
export const RECIPE_MODEL = 'claude-opus-5';

/** Non-streaming, one recipe out. See §5.3. */
export const RECIPE_MAX_TOKENS = 16000;

/**
 * "Inspire me" writes one sentence and is clicked repeatedly, so it favours
 * speed over depth. A separate constant for the same reason as above.
 */
export const INSPIRE_MODEL = 'claude-sonnet-5';
export const INSPIRE_MAX_TOKENS = 1000;
