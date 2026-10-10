import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { envSchema } from './shared/infrastructure/config/env.schema.js';
import { DatabaseModule } from './shared/infrastructure/database/database.module.js';
import { RedisModule } from './shared/infrastructure/redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { OddsModule } from './modules/odds/odds.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

// ConfigModule chưa nạp .env ở thời điểm file này được đánh giá → tự nạp sớm (không ghi đè biến đã có).
try {
  process.loadEnvFile();
} catch {
  // không có file .env: dùng biến môi trường của hệ thống
}

/** Chỉ bật Observe khi có đủ key thật; thiếu key thì bỏ hẳn module (không gửi telemetry, không log 401). */
export const observeEnabled = Boolean(
  process.env.OBSERVE_APP_KEY && process.env.OBSERVE_APP_SECRET,
);

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ...(observeEnabled
      ? [
          ObserveModule.forRoot({
            appKey: process.env.OBSERVE_APP_KEY!,
            appSecret: process.env.OBSERVE_APP_SECRET!,
            serviceId: process.env.OBSERVE_SERVICE_ID ?? 'nest-de-hieu-v2',
          }),
        ]
      : []),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => envSchema.parse(raw),
    }),
    DatabaseModule,
    RedisModule,
    AuthModule, // xác thực + phân quyền theo quyền (permission), mở cho mọi vai trò
    TasksModule, // quản lý publisher (worker thread + microservice)
    OddsModule, // ACL → room → kèo arbitrage → consumer
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
