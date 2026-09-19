import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Lets DatabaseModule drain the pg pool on SIGINT/SIGTERM.
  app.enableShutdownHooks();

  // Swagger UI at /docs, raw OpenAPI JSON at /docs-json.
  const config = new DocumentBuilder()
    .setTitle('meMyselfAndApp API')
    .setDescription('Backend for the meMyselfAndApp web client.')
    .setVersion('0.0.1')
    .build();
  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, config),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
