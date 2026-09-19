import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

/** Inject with `@Inject(DRIZZLE) private readonly db: DrizzleDB`. */
export type DrizzleDB = NodePgDatabase<typeof schema>;
