/**
 * Drizzle schema. Tables declared here are picked up by the `db` instance
 * (for typed relational queries) and by drizzle-kit when generating migrations.
 */
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const apps = pgTable('apps', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type App = typeof apps.$inferSelect;
export type NewApp = typeof apps.$inferInsert;
