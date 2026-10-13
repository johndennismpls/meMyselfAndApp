import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';
import type { DrizzleDB } from '../../database/database.types';
import { recipes, type NewRecipe, type Recipe } from '../../database/schema';

/**
 * The recipes table, and nothing else. Rows in, rows out — DTOs and 404s are
 * RecipesService's business.
 */
@Injectable()
export class RecipesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async insert(values: NewRecipe): Promise<Recipe> {
    const [row] = await this.db.insert(recipes).values(values).returning();
    return row;
  }

  /** Newest first. */
  findAll(): Promise<Recipe[]> {
    return this.db.select().from(recipes).orderBy(desc(recipes.createdAt));
  }

  async findById(id: number): Promise<Recipe | undefined> {
    const [row] = await this.db
      .select()
      .from(recipes)
      .where(eq(recipes.id, id))
      .limit(1);
    return row;
  }

  /** Stamps `updatedAt`. Undefined when there was no row to update. */
  async update(
    id: number,
    values: Partial<NewRecipe>,
  ): Promise<Recipe | undefined> {
    const [row] = await this.db
      .update(recipes)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(recipes.id, id))
      .returning();
    return row;
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(recipes).where(eq(recipes.id, id));
  }
}
