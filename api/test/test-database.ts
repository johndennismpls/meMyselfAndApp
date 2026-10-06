import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../src/database/database.types';

/**
 * Asks Postgres which database this connection actually reached, and refuses
 * to go on unless it is a `_test` one. Call it in beforeAll of any suite that
 * deletes rows — setup-env.ts should already have made this true, and this is
 * the check that it did.
 */
export async function assertTestDatabase(db: DrizzleDB): Promise<void> {
  const result = await db.execute<{ name: string }>(
    sql`select current_database() as name`,
  );
  const name = result.rows[0]?.name ?? '';
  if (!name.endsWith('_test')) {
    throw new Error(
      `Connected to "${name}", not a _test database. Not deleting anything.`,
    );
  }
}
