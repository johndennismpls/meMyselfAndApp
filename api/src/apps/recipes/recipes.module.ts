import { Module, type OnModuleInit } from '@nestjs/common';
import { anthropicProvider } from './anthropic.provider';
import { ClaudeRepository } from './claude.repository';
import { DiscoveryService } from './discovery.service';
import { ExtractionService } from './extraction.service';
import { ImageService } from './image.service';
import { InspireService } from './inspire.service';
import { RecipesController } from './recipes.controller';
import { RecipesRepository } from './recipes.repository';
import { RecipesService } from './recipes.service';
import { ScrapeService } from './scrape.service';
import { SettingsService } from './settings.service';
import { RecipeTrace } from './trace';

@Module({
  controllers: [RecipesController],
  providers: [
    anthropicProvider,
    ClaudeRepository,
    RecipesService,
    RecipesRepository,
    DiscoveryService,
    ScrapeService,
    ExtractionService,
    ImageService,
    InspireService,
    SettingsService,
    RecipeTrace,
  ],
})
export class RecipesModule implements OnModuleInit {
  constructor(private readonly images: ImageService) {}

  /** RECIPE_MEDIA_DIR is created at boot if missing (§10). */
  async onModuleInit(): Promise<void> {
    await this.images.ensureDir();
  }
}
