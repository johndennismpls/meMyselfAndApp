import { Module, type OnModuleInit } from '@nestjs/common';
import { anthropicProvider } from './anthropic.provider';
import { DiscoveryService } from './discovery.service';
import { ExtractionService } from './extraction.service';
import { ImageService } from './image.service';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';
import { ScrapeService } from './scrape.service';
import { RecipeTrace } from './trace';

@Module({
  controllers: [RecipesController],
  providers: [
    anthropicProvider,
    RecipesService,
    DiscoveryService,
    ScrapeService,
    ExtractionService,
    ImageService,
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
