/**
 * Drizzle schema. Tables declared here are picked up by the `db` instance
 * (for typed relational queries) and by drizzle-kit when generating migrations.
 */
import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { IngredientGroup } from '../apps/recipes/extraction.schema';

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

/**
 * Recipe Box (spec/02_recipebox.md §6.1).
 *
 * No source_url and no source_name: attribution is logged, not stored (§1.3).
 * Ingredients and steps are jsonb rather than child tables — they are ordered
 * lists always read and written whole, so an edit is one UPDATE (§6.2).
 *
 * No indexes beyond the primary key. There is no duplicate check to support
 * (§7.2) and the list query is a single unfiltered ORDER BY created_at DESC.
 */
export const recipes = pgTable('recipes', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  ingredients: jsonb('ingredients')
    .$type<IngredientGroup[]>()
    .notNull()
    .default([]),
  steps: jsonb('steps').$type<string[]>().notNull().default([]),
  notes: jsonb('notes').$type<string[]>().notNull().default([]),
  origin: text('origin'),

  servings: integer('servings'),
  yieldText: text('yield_text'),
  prepMinutes: integer('prep_minutes'),
  cookMinutes: integer('cook_minutes'),
  totalMinutes: integer('total_minutes'),

  /** Relative to RECIPE_MEDIA_DIR. Never a path, never remote-derived (§8). */
  imageFilename: text('image_filename'),
  imageMimeType: text('image_mime_type'),

  /**
   * What you typed. The one provenance-ish field that stays, because it is about
   * your intent rather than the source — and it is the input to the deferred
   * "more like this" (§13).
   */
  requestText: text('request_text'),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Recipe = typeof recipes.$inferSelect;
export type NewRecipe = typeof recipes.$inferInsert;
