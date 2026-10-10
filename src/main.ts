import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument, observeEnabled } from './app.module.js';
import { setupOpenApi } from './shared/presentation/openapi-document.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    ...(observeEnabled ? { instrument: ObserveInstrument } : {}),
  });
  // Tài liệu API (Swagger UI) tại /docs. Tắt bằng API_DOCS_ENABLED=false.
  if (process.env.API_DOCS_ENABLED !== 'false') setupOpenApi(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
