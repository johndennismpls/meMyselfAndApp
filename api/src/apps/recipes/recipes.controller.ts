import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
// Pulls in @types/multer's `declare global` so `Express.Multer.File` resolves.
// A type-only import, erased at compile time, and local to the one file that
// needs it — unlike a tsconfig `types` entry, it survives a tool resolving its
// own config.
import type {} from 'multer';
import {
  CandidateDto,
  FindResultDto,
  InspireResultDto,
  RecipeDto,
  RecipeSettingsDto,
  RecipeSummaryDto,
} from './dto/recipe.dto';
import {
  CreateRecipeDto,
  CreateRecipeSchema,
  FindRequestDto,
  FindRequestSchema,
  InspireRequestDto,
  InspireRequestSchema,
  ScrapeRequestDto,
  ScrapeRequestSchema,
  UpdateRecipeDto,
  UpdateRecipeSchema,
  UpdateSettingsDto,
  UpdateSettingsSchema,
  type CreateRecipeInput,
  type InspireRequestInput,
  type UpdateRecipeInput,
  type UpdateSettingsInput,
} from './dto/request.dto';
import { InspireService } from './inspire.service';
import { RecipesService } from './recipes.service';
import { SettingsService } from './settings.service';
import { ZodBody } from './zod.pipe';

@ApiTags('recipes')
@Controller('recipes')
export class RecipesController {
  constructor(
    private readonly recipes: RecipesService,
    private readonly settings: SettingsService,
    private readonly inspiration: InspireService,
  ) {}

  @Post('find')
  @ApiOperation({
    summary:
      'Find a recipe on the web from a plain-English request and save it.',
    description:
      'Two Claude calls plus a search loop plus our own fetch — plan for 30-60 seconds.',
  })
  @ApiCreatedResponse({ type: FindResultDto })
  find(
    @Body(new ZodBody(FindRequestSchema, "Tell me what you'd like to cook."))
    body: {
      request: string;
    },
  ): Promise<FindResultDto> {
    return this.recipes.find(body.request);
  }

  @Post('scrape')
  @ApiOperation({ summary: 'Extract and save the recipe at a pasted URL.' })
  @ApiCreatedResponse({ type: RecipeDto })
  scrape(
    @Body(
      new ZodBody(ScrapeRequestSchema, "That doesn't look like a web address."),
    )
    body: {
      url: string;
    },
  ): Promise<RecipeDto> {
    return this.recipes.scrape(body.url);
  }

  @Post('inspire')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Suggest something to cook, based on the recipes already saved.',
    description: 'Nothing is saved; the suggestion is meant for the ask box.',
  })
  @ApiBody({ type: InspireRequestDto })
  @ApiOkResponse({ type: InspireResultDto })
  async inspire(
    @Body(new ZodBody(InspireRequestSchema)) body: InspireRequestInput,
  ): Promise<InspireResultDto> {
    const [recipes, preferences] = await Promise.all([
      this.recipes.findAll(),
      this.settings.preferences(),
    ]);
    const prompt = await this.inspiration.suggest(
      recipes,
      preferences,
      body.previous,
    );
    return { prompt };
  }

  /**
   * Declared above `GET /recipes/:id` on purpose: Nest matches in declaration
   * order, and the :id route would otherwise swallow this and 400 on the
   * ParseIntPipe.
   */
  @Get('settings')
  @ApiOperation({
    summary: 'The standing preferences applied to every find request.',
  })
  @ApiOkResponse({ type: RecipeSettingsDto })
  getSettings(): Promise<RecipeSettingsDto> {
    return this.settings.get();
  }

  @Put('settings')
  @ApiOperation({
    summary: 'Replace the standing preferences with the list supplied.',
    description: 'Blank entries are dropped; the list saved is the list used.',
  })
  @ApiOkResponse({ type: RecipeSettingsDto })
  putSettings(
    @Body(new ZodBody(UpdateSettingsSchema))
    body: UpdateSettingsInput,
  ): Promise<RecipeSettingsDto> {
    return this.settings.update(body);
  }

  @Post()
  @ApiOperation({ summary: 'Save a hand-entered recipe.' })
  @ApiCreatedResponse({ type: RecipeDto })
  create(
    @Body(new ZodBody(CreateRecipeSchema)) body: CreateRecipeInput,
  ): Promise<RecipeDto> {
    return this.recipes.create(body);
  }

  @Get()
  @ApiOperation({ summary: 'List every recipe, newest first.' })
  @ApiOkResponse({ type: [RecipeSummaryDto] })
  findAll(): Promise<RecipeSummaryDto[]> {
    return this.recipes.findAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: RecipeDto })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<RecipeDto> {
    return this.recipes.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update the fields supplied. Edits overwrite.' })
  @ApiOkResponse({ type: RecipeDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodBody(UpdateRecipeSchema)) body: UpdateRecipeInput,
  ): Promise<RecipeDto> {
    return this.recipes.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.recipes.remove(id);
  }

  @Put(':id/image')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: RecipeDto })
  @UseInterceptors(FileInterceptor('image'))
  setImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<RecipeDto> {
    if (!file) throw new BadRequestException('No image was uploaded.');
    return this.recipes.setImage(id, file.buffer, file.mimetype);
  }

  @Delete(':id/image')
  @ApiOkResponse({ type: RecipeDto })
  clearImage(@Param('id', ParseIntPipe) id: number): Promise<RecipeDto> {
    return this.recipes.clearImage(id);
  }

  @Get(':id/image')
  @ApiOperation({ summary: "The recipe's stored picture." })
  async image(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { path, mimeType } = await this.recipes.imageFor(id);
    // The bytes at a given id never change in place — a replacement writes a new
    // file and updates the row — so this is safely immutable.
    res.type(mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // No `root` option: `path` is already absolute (ImageService resolves
    // `RECIPE_MEDIA_DIR` at construction), and `send` joins `root` onto `path`
    // unconditionally, which would double up on an already-absolute `path`.
    res.sendFile(path);
  }
}

// Referenced only through FindResultDto; named here so Swagger emits the schema.
void CandidateDto;
void CreateRecipeDto;
void ScrapeRequestDto;
void FindRequestDto;
void UpdateRecipeDto;
void UpdateSettingsDto;
