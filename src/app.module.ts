import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { envSchema } from './shared/infrastructure/config/env.schema.js';
import { DatabaseModule } from './shared/infrastructure/database/database.module.js';
import { RedisModule } from './shared/infrastructure/redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { OddsModule } from './modules/odds/odds.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { TradingModule } from './modules/trading/trading.module.js';
import { OpsEventsModule } from './shared/infrastructure/ops/ops-events.module.js';
import { ZodErrorFilter } from './shared/presentation/zod-error.filter.js';

// Nạp .env sớm cho code đọc process.env lúc import (không ghi đè biến đã có).
try {
  process.loadEnvFile();
} catch {
  // không có file .env: dùng biến môi trường của hệ thống
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => envSchema.parse(raw),
    }),
    DatabaseModule,
    RedisModule,
    OpsEventsModule, // bus sự kiện vận hành dùng chung
    AuthModule, // xác thực + phân quyền theo quyền (permission), mở cho mọi vai trò
    TasksModule, // quản lý publisher (worker thread + microservice)
    OddsModule, // ACL → room → kèo arbitrage → consumer
    AdminModule, // sự cố + cảnh báo, stream dashboard, audit
    TradingModule, // auto trade: tài khoản, profile, cấu hình worker trader, lệnh giấy
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // lỗi validate (zod) → 400 thay vì 500
    { provide: APP_FILTER, useClass: ZodErrorFilter },
  ],
})
export class AppModule {}
