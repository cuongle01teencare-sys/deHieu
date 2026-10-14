import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
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
import { AdminModule } from './modules/admin/admin.module.js';
import { TradingModule } from './modules/trading/trading.module.js';
import { OpsEventsModule } from './shared/infrastructure/ops/ops-events.module.js';
import { ZodErrorFilter } from './shared/presentation/zod-error.filter.js';

/**
 * Lớp chạy nền theo sự kiện (message từ publisher, làn xử lý, stream WS): callback của chúng kế thừa
 * ngữ cảnh trace của request đã khởi động task (vd POST /tasks). Request kết thúc → trace đóng → Observe
 * báo "No snapshot found for traceId ... TaskSupervisor#_onMessage" với MỖI message. Bỏ đo các lớp này
 * (đằng nào cũng là hàng nghìn span/giây, không hữu ích mà tốn hạn mức).
 */
const BACKGROUND_CLASSES = new Set([
  'TaskSupervisor',
  'WsRemoteTaskLauncher',
  'IngestTaskDataHandler',
  'ReleaseTaskOddsHandler',
  'LaneDispatcher',
  'OddsLineApplier',
  'ArbitrageEvaluator',
  'ConsumerHub',
  'AdminWsHub',
  'OddsTransitionRecorder',
  'SignalHistoryRecorder',
  'TraderConfigSync',
  'TraderDataHandler',
]);

export const { ObserveModule, ObserveInstrument } = createObserveModule({
  skipInstrumentation: (instance) =>
    BACKGROUND_CLASSES.has(
      (instance as { constructor?: { name?: string } } | null)?.constructor
        ?.name ?? '',
    ),
});

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
