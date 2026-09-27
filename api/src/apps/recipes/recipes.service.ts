import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';
import type { DrizzleDB } from '../../database/database.types';
import { recipes, type Recipe } from '../../database/schema';
import { DiscoveryService } from './discovery.service';
import type { Candidate } from './discovery.schema';
import type {
  CandidateDto,
  FindResultDto,
  RecipeDto,
  RecipeSummaryDto,
} from './dto/recipe.dto';
import type { CreateRecipeInput, UpdateRecipeInput } from './dto/request.dto';
import { ExtractionService } from './extraction.service';
import type { ExtractedRecipe } from './extraction.schema';
import { normaliseUrl } from './grounding';
import { ImageService } from './image.service';
import { ScrapeService, type CleanedPage } from './scrape.service';
import { SettingsService } from './settings.service';
import { RecipeTrace } from './trace';

@Injectable()
export class RecipesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly discovery: DiscoveryService,
    private readonly scraper: ScrapeService,
    private readonly extraction: ExtractionService,
    private readonly images: ImageService,
    private readonly settings: SettingsService,
    private readonly trace: RecipeTrace,
  ) {}

  /**
   * The find path (§7.1). Discovery, then the lower half of the pipeline on each
   * candidate in rank order, returning the first that yields a recipe. A
   * candidate that 403s or turns out to be a listicle costs one failed attempt,
   * not the whole request.
   */
  async find(request: string): Promise<FindResultDto> {
    this.trace.event('recipe.request', { path: 'find', requestText: request });

    // The standing preferences shape the search only (§9.4). They are not part
    // of what you typed, so `requestText` on the row stays exactly that.
    const preferences = await this.settings.preferences();
    const discovered = await this.discovery.discover(request, preferences);
    const attempts: { url: string; reason: string }[] = [];

    for (const candidate of discovered.candidates) {
      const attempt = await this.attempt(candidate.url);
      if (attempt.ok) {
        const recipe = await this.persist(
          attempt.recipe,
          attempt.page,
          attempt.baseUrl,
          request,
          candidate,
          'fetch',
        );
        return this.findResult(
          recipe,
          discovered.interpretedAs,
          candidate,
          discovered.candidates,
        );
      }
      attempts.push({ url: candidate.url, reason: attempt.reason });
    }

    // Every candidate failed our own fetch or wasn't a recipe. Fall back once to
    // the page text web_fetch already returned (§4.3) — Cloudflare and friends
    // will 403 us on pages Anthropic reached comfortably. Still inside the §1.1
    // guarantee: that text is a real fetch of a real page, not model output.
    for (const candidate of discovered.candidates) {
      const key = normaliseUrl(candidate.url);
      const text = key ? discovered.fetchedText.get(key) : undefined;
      if (!text || text.length < 200) continue;

      const page: CleanedPage = {
        text,
        title: candidate.title,
        ogImageUrl: null,
        siteName: candidate.site_name,
        canonicalUrl: candidate.url,
      };
      this.trace.event('recipe.fetch', {
        url: candidate.url,
        outcome: 'ok',
        via: 'web_fetch',
        bytes: Buffer.byteLength(text),
        ms: 0,
      });

      const extracted = await this.extraction.extract(page, candidate.url);
      if (!extracted.ok) {
        attempts.push({
          url: candidate.url,
          reason: extracted.rejectionReason,
        });
        continue;
      }
      const recipe = await this.persist(
        extracted.recipe,
        page,
        candidate.url,
        request,
        candidate,
        'web_fetch',
      );
      return this.findResult(
        recipe,
        discovered.interpretedAs,
        candidate,
        discovered.candidates,
      );
    }

    this.trace.event('recipe.failed', {
      stage: 'find',
      status: 422,
      message: 'no candidate yielded a recipe',
      attempts,
    });
    throw new UnprocessableEntityException("Couldn't find that one online.");
  }

  /** The pasted-URL path. No §4.3 fallback here — a fetch failure is honest. */
  async scrape(url: string): Promise<RecipeDto> {
    this.trace.event('recipe.request', { path: 'scrape', url });

    const { page, fetched } = await this.scraper.scrape(url);
    this.trace.event('recipe.fetch', {
      url,
      outcome: 'ok',
      via: 'fetch',
      bytes: fetched.bytes,
      ms: fetched.ms,
    });

    const extracted = await this.extraction.extract(page, fetched.finalUrl);
    if (!extracted.ok) {
      throw new UnprocessableEntityException(extracted.rejectionReason);
    }
    return this.persist(
      extracted.recipe,
      page,
      fetched.finalUrl,
      null,
      null,
      'fetch',
    );
  }

  /** One candidate through guard → fetch → clean → extract. */
  private async attempt(
    url: string,
  ): Promise<
    | { ok: true; recipe: ExtractedRecipe; page: CleanedPage; baseUrl: string }
    | { ok: false; reason: string }
  > {
    let page: CleanedPage;
    let baseUrl: string;
    try {
      const scraped = await this.scraper.scrape(url);
      page = scraped.page;
      baseUrl = scraped.fetched.finalUrl;
      this.trace.event('recipe.fetch', {
        url,
        outcome: 'ok',
        via: 'fetch',
        bytes: scraped.fetched.bytes,
        ms: scraped.fetched.ms,
      });
    } catch (error) {
      const reason =
        error instanceof HttpException ? error.message : String(error);
      this.trace.event('recipe.fetch', {
        url,
        outcome: error instanceof HttpException ? error.getStatus() : 'blocked',
        via: 'fetch',
        bytes: 0,
        ms: 0,
      });
      return { ok: false, reason };
    }

    const extracted = await this.extraction.extract(page, baseUrl);
    if (!extracted.ok) return { ok: false, reason: extracted.rejectionReason };
    return { ok: true, recipe: extracted.recipe, page, baseUrl };
  }

  /** Image (non-fatal), insert, trace. */
  private async persist(
    extracted: ExtractedRecipe,
    page: CleanedPage,
    baseUrl: string,
    requestText: string | null,
    candidate: Candidate | null,
    via: 'fetch' | 'web_fetch',
  ): Promise<RecipeDto> {
    const image = await this.images.download(
      extracted.image_url,
      page.ogImageUrl,
      page.canonicalUrl ?? baseUrl,
    );

    const [row] = await this.db
      .insert(recipes)
      .values({
        title: extracted.title,
        description: extracted.description,
        ingredients: extracted.ingredients,
        steps: extracted.steps,
        notes: extracted.notes,
        origin: extracted.origin,
        servings: extracted.servings,
        yieldText: extracted.yield_text,
        prepMinutes: extracted.prep_minutes,
        cookMinutes: extracted.cook_minutes,
        totalMinutes: extracted.total_minutes,
        imageFilename: image?.filename ?? null,
        imageMimeType: image?.mimeType ?? null,
        requestText,
      })
      .returning();

    this.trace.bind(row.id);
    // The only record that this recipe came from this page (§1.3).
    this.trace.event('recipe.saved', {
      recipeId: row.id,
      sourceUrl: baseUrl,
      sourceName: candidate?.site_name ?? page.siteName,
      imageSourceUrl: image?.sourceUrl ?? null,
      via,
    });

    return toDto(row);
  }

  private findResult(
    recipe: RecipeDto,
    interpretedAs: string,
    winner: Candidate,
    all: Candidate[],
  ): FindResultDto {
    return {
      recipe,
      interpretedAs,
      siteName: winner.site_name,
      why: winner.why,
      alternates: all.filter((c) => c.url !== winner.url).map(toCandidateDto),
    };
  }

  // ---- plain CRUD -------------------------------------------------------

  async create(input: CreateRecipeInput): Promise<RecipeDto> {
    const [row] = await this.db
      .insert(recipes)
      .values({
        title: input.title,
        description: input.description ?? null,
        ingredients: input.ingredients ?? [],
        steps: input.steps ?? [],
        notes: input.notes ?? [],
        origin: input.origin ?? null,
        servings: input.servings ?? null,
        yieldText: input.yieldText ?? null,
        prepMinutes: input.prepMinutes ?? null,
        cookMinutes: input.cookMinutes ?? null,
        totalMinutes: input.totalMinutes ?? null,
      })
      .returning();
    return toDto(row);
  }

  async findAll(): Promise<RecipeSummaryDto[]> {
    const rows = await this.db
      .select()
      .from(recipes)
      .orderBy(desc(recipes.createdAt));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      origin: row.origin,
      totalMinutes: row.totalMinutes,
      hasImage: row.imageFilename !== null,
      ingredientText: row.ingredients.flatMap((group) => group.items),
    }));
  }

  async findOne(id: number): Promise<RecipeDto> {
    return toDto(await this.row(id));
  }

  async update(id: number, input: UpdateRecipeInput): Promise<RecipeDto> {
    await this.row(id);
    const [row] = await this.db
      .update(recipes)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(recipes.id, id))
      .returning();
    return toDto(row);
  }

  async remove(id: number): Promise<void> {
    const row = await this.row(id);
    await this.db.delete(recipes).where(eq(recipes.id, id));
    await this.images.remove(row.imageFilename);
  }

  async setImage(
    id: number,
    buffer: Buffer,
    mimeType: string,
  ): Promise<RecipeDto> {
    const existing = await this.row(id);
    const stored = await this.images.store(buffer, mimeType);
    const [row] = await this.db
      .update(recipes)
      .set({
        imageFilename: stored.filename,
        imageMimeType: stored.mimeType,
        updatedAt: new Date(),
      })
      .where(eq(recipes.id, id))
      .returning();
    // The old file goes after the row updates, never before.
    await this.images.remove(existing.imageFilename);
    return toDto(row);
  }

  async clearImage(id: number): Promise<RecipeDto> {
    const existing = await this.row(id);
    const [row] = await this.db
      .update(recipes)
      .set({ imageFilename: null, imageMimeType: null, updatedAt: new Date() })
      .where(eq(recipes.id, id))
      .returning();
    await this.images.remove(existing.imageFilename);
    return toDto(row);
  }

  /** The stored file for GET /recipes/:id/image. */
  async imageFor(id: number): Promise<{ path: string; mimeType: string }> {
    const row = await this.row(id);
    if (!row.imageFilename) throw new NotFoundException();
    return {
      path: this.images.path(row.imageFilename),
      mimeType: row.imageMimeType ?? 'application/octet-stream',
    };
  }

  private async row(id: number): Promise<Recipe> {
    const [row] = await this.db
      .select()
      .from(recipes)
      .where(eq(recipes.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`No recipe ${id}.`);
    return row;
  }
}

function toDto(row: Recipe): RecipeDto {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    ingredients: row.ingredients,
    steps: row.steps,
    notes: row.notes,
    origin: row.origin,
    servings: row.servings,
    yieldText: row.yieldText,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    totalMinutes: row.totalMinutes,
    hasImage: row.imageFilename !== null,
    requestText: row.requestText,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCandidateDto(c: Candidate): CandidateDto {
  return { url: c.url, siteName: c.site_name, title: c.title, why: c.why };
}
