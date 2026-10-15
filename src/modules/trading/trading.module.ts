import {
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/infrastructure/config/env.schema.js';
import { TransactionContext } from '../../shared/infrastructure/database/transaction-context.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { TaskSupervisor } from '../tasks/application/task-supervisor.js';
import { OddsModule } from '../odds/odds.module.js';
import { NotifyAdmin } from '../odds/application/notify/notify-admin.js';
// application
import {
  SECRET_CIPHER,
  STAKE_TIER_SOURCE,
  TRADE_ATTEMPT_REPOSITORY,
  TRADER_PROFILE_REPOSITORY,
  TRADER_TASK_GATEWAY,
  TRADING_ACCOUNT_REPOSITORY,
  TRADING_SETTINGS_STORE,
  type SecretCipher,
  type StakeTierSource,
  type TradeAttemptRepository,
  type TraderProfileRepository,
  type TraderTaskGateway,
  type TradingAccountRepository,
  type TradingSettingsStore,
} from './application/trading.ports.js';
import { TraderConfigSync } from './application/trader-config.sync.js';
import { TradingAdmin } from './application/trading-admin.js';
import { TraderDataHandler } from './application/trader-data.handler.js';
// infrastructure
import {
  DrizzleTradeAttemptRepository,
  DrizzleTraderProfileRepository,
  DrizzleTradingAccountRepository,
  DrizzleTradingSettingsStore,
} from './infrastructure/persistence/drizzle/drizzle-trading.repositories.js';
import { AesGcmSecretCipher } from './infrastructure/security/aes-gcm.secret-cipher.js';
import { SupervisorTraderTaskGateway } from './infrastructure/runtime/supervisor-trader-task.gateway.js';
// presentation
import { TradingController } from './presentation/trading.controller.js';
import { ExposureAdmin } from './application/exposure-admin.js';
import { OneClickBoard } from './application/one-click-board.js';
import { OneClickAdmin } from './application/one-click-admin.js';
import {
  EXPOSURE_LEDGER_READER,
  type ExposureLedgerReader,
} from './application/exposure.ports.js';
import { RedisExposureLedgerReader } from './infrastructure/exposure/redis-exposure-ledger.reader.js';
import { REDIS_CLIENT } from '../../shared/infrastructure/redis/redis.types.js';
import type { Redis } from 'ioredis';

/** Đối chiếu định kỳ cấu hình các task trader (bắt cả thay đổi hạng kèo ở module odds). */
const CONFIG_RECONCILE_MS = 30_000;

/**
 * Auto trade. Worker trader (task `trader.arbitrage`) là một consumer của ConsumerHub;
 * module này chỉ quản trị cấu hình, gửi cấu hình đã tính sẵn cho worker và ghi kết quả worker gửi về.
 */
@Module({
  imports: [TasksModule, OddsModule],
  controllers: [TradingController],
  providers: [
    {
      provide: TRADING_ACCOUNT_REPOSITORY,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) =>
        new DrizzleTradingAccountRepository(tx),
    },
    {
      provide: TRADER_PROFILE_REPOSITORY,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) =>
        new DrizzleTraderProfileRepository(tx),
    },
    {
      provide: TRADE_ATTEMPT_REPOSITORY,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) =>
        new DrizzleTradeAttemptRepository(tx),
    },
    {
      provide: TRADING_SETTINGS_STORE,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) =>
        new DrizzleTradingSettingsStore(tx),
    },
    {
      provide: SECRET_CIPHER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) =>
        new AesGcmSecretCipher(cfg.get('TRADING_SECRET_KEY', { infer: true })),
    },
    {
      // hạng kèo dùng chung với kênh thông báo (module odds, lớp application)
      provide: STAKE_TIER_SOURCE,
      inject: [NotifyAdmin],
      useFactory: (n: NotifyAdmin): StakeTierSource => ({
        listTiers: () => n.listTiers(),
      }),
    },
    {
      provide: TRADER_TASK_GATEWAY,
      inject: [TaskSupervisor],
      useFactory: (s: TaskSupervisor) => new SupervisorTraderTaskGateway(s),
    },
    {
      provide: TraderConfigSync,
      inject: [
        TRADING_ACCOUNT_REPOSITORY,
        TRADER_PROFILE_REPOSITORY,
        TRADING_SETTINGS_STORE,
        STAKE_TIER_SOURCE,
        TRADER_TASK_GATEWAY,
      ],
      useFactory: (
        a: TradingAccountRepository,
        p: TraderProfileRepository,
        s: TradingSettingsStore,
        t: StakeTierSource,
        g: TraderTaskGateway,
      ) => {
        const logger = new Logger('TraderConfig');
        return new TraderConfigSync(a, p, s, t, g, (e) =>
          logger.warn(`không gửi được cấu hình: ${String(e)}`),
        );
      },
    },
    {
      provide: TradingAdmin,
      inject: [
        TRADING_ACCOUNT_REPOSITORY,
        TRADER_PROFILE_REPOSITORY,
        TRADE_ATTEMPT_REPOSITORY,
        TRADING_SETTINGS_STORE,
        STAKE_TIER_SOURCE,
        SECRET_CIPHER,
        TraderConfigSync,
      ],
      useFactory: (
        a: TradingAccountRepository,
        p: TraderProfileRepository,
        tr: TradeAttemptRepository,
        s: TradingSettingsStore,
        t: StakeTierSource,
        c: SecretCipher,
        sync: TraderConfigSync,
      ) => new TradingAdmin(a, p, tr, s, t, c, sync),
    },
    {
      provide: EXPOSURE_LEDGER_READER,
      inject: [REDIS_CLIENT],
      useFactory: (r: Redis) => new RedisExposureLedgerReader(r),
    },
    {
      provide: ExposureAdmin,
      inject: [
        EXPOSURE_LEDGER_READER,
        TRADER_PROFILE_REPOSITORY,
        STAKE_TIER_SOURCE,
        TRADING_SETTINGS_STORE,
        TraderConfigSync,
      ],
      useFactory: (
        r: ExposureLedgerReader,
        p: TraderProfileRepository,
        t: StakeTierSource,
        s: TradingSettingsStore,
        sync: TraderConfigSync,
      ) => new ExposureAdmin(r, p, t, s, sync),
    },
    { provide: OneClickBoard, useValue: new OneClickBoard() },
    {
      provide: OneClickAdmin,
      inject: [OneClickBoard, TraderConfigSync],
      useFactory: (b: OneClickBoard, s: TraderConfigSync) =>
        new OneClickAdmin(b, s),
    },
    {
      provide: TraderDataHandler,
      inject: [TRADE_ATTEMPT_REPOSITORY, TraderConfigSync, OneClickBoard],
      useFactory: (
        r: TradeAttemptRepository,
        s: TraderConfigSync,
        b: OneClickBoard,
      ) => new TraderDataHandler(r, s, undefined, b),
    },
  ],
})
export class TradingModule implements OnModuleInit, OnApplicationShutdown {
  private readonly _logger = new Logger('Trading');
  private _reconcile: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(TaskSupervisor) private readonly _supervisor: TaskSupervisor,
    @Inject(TraderDataHandler) private readonly _data: TraderDataHandler,
    @Inject(TraderConfigSync) private readonly _sync: TraderConfigSync,
  ) {}

  onModuleInit() {
    // adapter đầu vào: dữ liệu task trader (hỏi cấu hình, kết quả lệnh)
    this._supervisor.onData(async (msg) => {
      try {
        await this._data.execute(msg);
      } catch (e: unknown) {
        const c = e instanceof Error ? e.cause : undefined;
        this._logger.error(
          `trader ${msg.taskId} (${msg.channel ?? '-'}) lỗi: ${String(e)}${c instanceof Error ? ` — ${c.message}` : ''}`,
        );
      }
    });
    this._reconcile = setInterval(() => {
      this._sync.pushAll().catch((e: unknown) => this._logger.warn(String(e)));
    }, CONFIG_RECONCILE_MS);
  }

  onApplicationShutdown() {
    if (this._reconcile) clearInterval(this._reconcile);
  }
}
