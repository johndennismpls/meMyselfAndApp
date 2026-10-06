import { config } from 'dotenv';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs before every e2e suite. The suites wipe whole tables between tests, so
 * they must never see the dev database: point DATABASE_URL at its `_test`
 * sibling (or TEST_DATABASE_URL, when set) before AppModule loads. Nest's
 * ConfigModule never overwrites a variable already in process.env, so this
 * wins over .env.
 *
 * One-time setup: `createdb memyselfandapp_test`, then
 * `DATABASE_URL=postgresql://localhost:5432/memyselfandapp_test pnpm db:migrate`.
 */

config({ quiet: true });

const testUrl = process.env.TEST_DATABASE_URL ?? deriveTestUrl();
if (!databaseName(testUrl).endsWith('_test')) {
  throw new Error(
    `Refusing to run e2e tests against "${databaseName(testUrl)}": the ` +
      "suites delete every row they touch, so the database's name must end " +
      'in _test.',
  );
}
process.env.DATABASE_URL = testUrl;

// Uploaded and downloaded images go somewhere throwaway, not var/media.
process.env.RECIPE_MEDIA_DIR = mkdtempSync(join(tmpdir(), 'recipes-e2e-'));

function deriveTestUrl(): string {
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) {
    throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) for e2e tests.');
  }
  const url = new URL(devUrl);
  const name = databaseName(devUrl);
  url.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
  return url.toString();
}

function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}
