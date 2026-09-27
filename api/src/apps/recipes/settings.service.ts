import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';
import type { DrizzleDB } from '../../database/database.types';
import { SETTINGS_ROW_ID, recipeSettings } from '../../database/schema';
import type { RecipeSettingsDto } from './dto/recipe.dto';
import type { UpdateSettingsInput } from './dto/request.dto';

/**
 * The standing preferences behind the find path. A single row that may not
 * exist yet — the migration creates the table, not the row — so a read before
 * the first save answers with the empty default rather than a 404.
 */
@Injectable()
export class SettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async get(): Promise<RecipeSettingsDto> {
    const [row] = await this.db
      .select()
      .from(recipeSettings)
      .where(eq(recipeSettings.id, SETTINGS_ROW_ID));

    if (!row) return { preferences: [], updatedAt: null };
    return {
      preferences: row.preferences,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The list the find path actually uses. Nothing else reads the row. */
  async preferences(): Promise<string[]> {
    return (await this.get()).preferences;
  }

  async update(input: UpdateSettingsInput): Promise<RecipeSettingsDto> {
    // Already trimmed, de-blanked and length-checked by UpdateSettingsSchema.
    const { preferences } = input;

    const [row] = await this.db
      .insert(recipeSettings)
      .values({ id: SETTINGS_ROW_ID, preferences, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: recipeSettings.id,
        set: { preferences, updatedAt: new Date() },
      })
      .returning();

    return {
      preferences: row.preferences,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
