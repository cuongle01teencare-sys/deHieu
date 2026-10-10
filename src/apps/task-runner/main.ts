import { NestFactory } from '@nestjs/core';
import { TaskRunnerModule } from './task-runner.module.js';

/** Chạy: node dist/apps/task-runner/main.js (mỗi node một TASK_RUNNER_NODE_ID). */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(TaskRunnerModule);
  app.enableShutdownHooks();
}
await bootstrap();
