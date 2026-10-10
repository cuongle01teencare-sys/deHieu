import {
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../../shared/infrastructure/config/env.schema.js';
import { REDIS_CLIENT } from '../../shared/infrastructure/redis/redis.types.js';
import { TransactionContext } from '../../shared/infrastructure/database/transaction-context.js';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../shared/application/event-publisher.js';
import { CompositeEventPublisher } from '../../shared/application/composite-event-publisher.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { TaskSupervisor } from '../tasks/application/task-supervisor.js';
// domain / application
import {
  TEAM_ALIAS_REPOSITORY,
  type TeamAliasRepository,
} from './domain/team-alias.repository.js';
import {
  ODDS_ROOM_STORE,
  type OddsRoomStore,
} from './application/odds-room.store.js';
import {
  SIGNAL_STATE_STORE,
  type SignalStateStore,
} from './application/signal-state.store.js';
import {
  ARBITRAGE_SETTINGS_STORE,
  type ArbitrageSettingsStore,
} from './application/arbitrage-settings.js';
import {
  RAW_ODDS_TRANSLATORS,
  type RawOddsTranslator,
} from './application/raw-odds.translator.js';
import {
  CONSUMER_CONTROL,
  type ConsumerControl,
} from './application/consumer-control.js';
import { TeamNameResolver } from './application/team-name.resolver.js';
import { ArbitrageEvaluator } from './application/arbitrage-evaluator.js';
import { IngestTaskDataHandler } from './application/commands/ingest-task-data.command.js';
import { ReleaseTaskOddsHandler } from './application/commands/release-task-odds.command.js';
import { OddsLineApplier } from './application/odds-line-applier.js';
import { LaneDispatcher } from './application/lane-dispatcher.js';
import { ListLanesHandler } from './application/queries/list-lanes.query.js';
import { SweepSignalsHandler } from './application/commands/sweep-signals.command.js';
import { CreateTeamAliasHandler } from './application/commands/create-team-alias.command.js';
import { DeleteTeamAliasHandler } from './application/commands/delete-team-alias.command.js';
import { UpdateArbitrageSettingsHandler } from './application/commands/update-arbitrage-settings.command.js';
import { ControlConsumerHandler } from './application/commands/control-consumer.command.js';
import { ListTeamAliasesHandler } from './application/queries/list-team-aliases.query.js';
import { GetArbitrageSettingsHandler } from './application/queries/get-arbitrage-settings.query.js';
import { ListActiveSignalsHandler } from './application/queries/list-active-signals.query.js';
import { ListConsumersHandler } from './application/queries/list-consumers.query.js';
import { GetConsumerHubStatsHandler } from './application/queries/get-consumer-hub-stats.query.js';
import { GetRoomHandler } from './application/queries/get-room.query.js';
// infrastructure (adapter thay được: đổi 1 dòng useFactory)
import { DrizzleTeamAliasRepository } from './infrastructure/persistence/drizzle/drizzle-team-alias.repository.js';
import { RedisOddsRoomStore } from './infrastructure/persistence/redis/redis-odds-room.store.js';
import { InMemorySignalStateStore } from './infrastructure/persistence/in-memory/in-memory-signal-state.store.js';
import { InMemoryArbitrageSettingsStore } from './infrastructure/settings/in-memory-arbitrage-settings.store.js';
import { SptPubOddsTranslator } from './infrastructure/acl/sptpub/sptpub-odds.translator.js';
import { PolymarketOddsTranslator } from './infrastructure/acl/polymarket/polymarket-odds.translator.js';
import { ConsumerHub } from './infrastructure/consumer/consumer-hub.js';
import { DrizzleSignalHistoryRepository } from './infrastructure/persistence/drizzle/drizzle-signal-history.repository.js';
import {
  SIGNAL_HISTORY_REPOSITORY,
  type SignalHistoryRepository,
} from './application/signal-history.repository.js';
import { SignalHistoryRecorder } from './application/signal-history.recorder.js';
import { ListSignalHistoryHandler } from './application/queries/list-signal-history.query.js';
import { GetSignalHistoryHandler } from './application/queries/get-signal-history.query.js';
import { AbandonActiveSignalsHandler } from './application/commands/abandon-active-signals.command.js';
// presentation
import { TeamAliasesController } from './presentation/team-aliases.controller.js';
import { ConsumersController } from './presentation/consumers.controller.js';
import { ArbitrageController } from './presentation/arbitrage.controller.js';

const SWEEP_INTERVAL_MS = 5_000;

@Module({
  imports: [TasksModule],
  controllers: [
    ArbitrageController,
    TeamAliasesController,
    ConsumersController,
  ],
  providers: [
    // ---------- adapters
    {
      provide: TEAM_ALIAS_REPOSITORY,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) =>
        new DrizzleTeamAliasRepository(tx),
    },
    {
      provide: ODDS_ROOM_STORE,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => new RedisOddsRoomStore(redis), // dev: new InMemoryOddsRoomStore()
    },
    { provide: SIGNAL_STATE_STORE, useValue: new InMemorySignalStateStore() },
    {
      provide: ARBITRAGE_SETTINGS_STORE,
      useValue: new InMemoryArbitrageSettingsStore(),
    },
    {
      provide: ConsumerHub,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) => {
        const hub = new ConsumerHub({
          port: cfg.get('CONSUMER_WS_PORT'),
          token: cfg.get('CONSUMER_WS_TOKEN'),
        });
        hub.listen();
        return hub;
      },
    },
    {
      provide: SIGNAL_HISTORY_REPOSITORY,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) =>
        new DrizzleSignalHistoryRepository(tx),
    },
    {
      provide: SignalHistoryRecorder,
      inject: [SIGNAL_HISTORY_REPOSITORY],
      useFactory: (repo: SignalHistoryRepository) => {
        const logger = new Logger('SignalHistory');
        return new SignalHistoryRecorder(repo, (e) => logger.error(String(e)));
      },
    },
    {
      // gửi consumer trước, rồi xếp việc ghi lịch sử (chạy nền, không chặn)
      provide: EVENT_PUBLISHER,
      inject: [ConsumerHub, SignalHistoryRecorder],
      useFactory: (hub: ConsumerHub, history: SignalHistoryRecorder) =>
        new CompositeEventPublisher([hub, history]),
    },
    {
      provide: ListSignalHistoryHandler,
      inject: [SIGNAL_HISTORY_REPOSITORY],
      useFactory: (r: SignalHistoryRepository) =>
        new ListSignalHistoryHandler(r),
    },
    {
      provide: GetSignalHistoryHandler,
      inject: [SIGNAL_HISTORY_REPOSITORY],
      useFactory: (r: SignalHistoryRepository) =>
        new GetSignalHistoryHandler(r),
    },
    {
      provide: AbandonActiveSignalsHandler,
      inject: [SIGNAL_HISTORY_REPOSITORY],
      useFactory: (r: SignalHistoryRepository) =>
        new AbandonActiveSignalsHandler(r),
    },
    { provide: CONSUMER_CONTROL, useExisting: ConsumerHub },

    // ---------- application services
    {
      provide: TeamNameResolver,
      inject: [TEAM_ALIAS_REPOSITORY],
      useFactory: (repo: TeamAliasRepository) => new TeamNameResolver(repo),
    },
    {
      provide: RAW_ODDS_TRANSLATORS,
      inject: [TeamNameResolver, TaskSupervisor],
      useFactory: (
        teams: TeamNameResolver,
        supervisor: TaskSupervisor,
      ): RawOddsTranslator[] => [
        new SptPubOddsTranslator(teams),
        new PolymarketOddsTranslator(teams, async (op, assetIds) => {
          // gửi tới mọi task stream đang chạy; lệnh idempotent nên gửi lại toàn bộ cũng an toàn
          const streams = (await supervisor.list()).filter(
            (t) => t.spec.kind === 'polymarket.stream' && t.state === 'RUNNING',
          );
          for (const t of streams)
            await supervisor.command(t.spec.taskId, op, { assetIds });
        }),
      ],
    },
    {
      provide: ArbitrageEvaluator,
      inject: [
        ODDS_ROOM_STORE,
        SIGNAL_STATE_STORE,
        ARBITRAGE_SETTINGS_STORE,
        EVENT_PUBLISHER,
      ],
      useFactory: (
        rooms: OddsRoomStore,
        signals: SignalStateStore,
        settings: ArbitrageSettingsStore,
        publisher: EventPublisher,
      ) => new ArbitrageEvaluator(rooms, signals, settings, publisher),
    },

    // ---------- command / query handlers
    {
      provide: OddsLineApplier,
      inject: [ODDS_ROOM_STORE, ArbitrageEvaluator],
      useFactory: (rooms: OddsRoomStore, ev: ArbitrageEvaluator) =>
        new OddsLineApplier(rooms, ev),
    },
    {
      provide: LaneDispatcher,
      inject: [OddsLineApplier],
      useFactory: (a: OddsLineApplier) => {
        const logger = new Logger('LaneDispatcher');
        return new LaneDispatcher(a, (lane, e) =>
          logger.error(`làn ${lane} lỗi: ${String(e)}`),
        );
      },
    },
    {
      provide: IngestTaskDataHandler,
      inject: [RAW_ODDS_TRANSLATORS, LaneDispatcher],
      useFactory: (t: RawOddsTranslator[], l: LaneDispatcher) =>
        new IngestTaskDataHandler(t, l),
    },
    {
      provide: ReleaseTaskOddsHandler,
      inject: [RAW_ODDS_TRANSLATORS, LaneDispatcher],
      useFactory: (t: RawOddsTranslator[], l: LaneDispatcher) =>
        new ReleaseTaskOddsHandler(t, l),
    },
    {
      provide: ListLanesHandler,
      inject: [LaneDispatcher],
      useFactory: (l: LaneDispatcher) => new ListLanesHandler(l),
    },
    {
      provide: SweepSignalsHandler,
      inject: [SIGNAL_STATE_STORE, ArbitrageEvaluator],
      useFactory: (s: SignalStateStore, ev: ArbitrageEvaluator) =>
        new SweepSignalsHandler(s, ev),
    },
    {
      provide: CreateTeamAliasHandler,
      inject: [TEAM_ALIAS_REPOSITORY, TeamNameResolver],
      useFactory: (r: TeamAliasRepository, n: TeamNameResolver) =>
        new CreateTeamAliasHandler(r, n),
    },
    {
      provide: DeleteTeamAliasHandler,
      inject: [TEAM_ALIAS_REPOSITORY, TeamNameResolver],
      useFactory: (r: TeamAliasRepository, n: TeamNameResolver) =>
        new DeleteTeamAliasHandler(r, n),
    },
    {
      provide: ListTeamAliasesHandler,
      inject: [TEAM_ALIAS_REPOSITORY],
      useFactory: (r: TeamAliasRepository) => new ListTeamAliasesHandler(r),
    },
    {
      provide: UpdateArbitrageSettingsHandler,
      inject: [ARBITRAGE_SETTINGS_STORE, SweepSignalsHandler],
      useFactory: (s: ArbitrageSettingsStore, sweep: SweepSignalsHandler) =>
        new UpdateArbitrageSettingsHandler(s, sweep),
    },
    {
      provide: GetArbitrageSettingsHandler,
      inject: [ARBITRAGE_SETTINGS_STORE],
      useFactory: (s: ArbitrageSettingsStore) =>
        new GetArbitrageSettingsHandler(s),
    },
    {
      provide: ListActiveSignalsHandler,
      inject: [SIGNAL_STATE_STORE],
      useFactory: (s: SignalStateStore) => new ListActiveSignalsHandler(s),
    },
    {
      provide: GetRoomHandler,
      inject: [ODDS_ROOM_STORE],
      useFactory: (r: OddsRoomStore) => new GetRoomHandler(r),
    },
    {
      provide: ListConsumersHandler,
      inject: [CONSUMER_CONTROL],
      useFactory: (c: ConsumerControl) => new ListConsumersHandler(c),
    },
    {
      provide: GetConsumerHubStatsHandler,
      inject: [CONSUMER_CONTROL],
      useFactory: (c: ConsumerControl) => new GetConsumerHubStatsHandler(c),
    },
    {
      provide: ControlConsumerHandler,
      inject: [CONSUMER_CONTROL],
      useFactory: (c: ConsumerControl) => new ControlConsumerHandler(c),
    },
  ],
})
export class OddsModule implements OnModuleInit, OnApplicationShutdown {
  private readonly _logger = new Logger(OddsModule.name);
  private _sweep: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(TaskSupervisor) private readonly _supervisor: TaskSupervisor,
    @Inject(IngestTaskDataHandler)
    private readonly _ingest: IngestTaskDataHandler,
    @Inject(ReleaseTaskOddsHandler)
    private readonly _release: ReleaseTaskOddsHandler,
    @Inject(SweepSignalsHandler)
    private readonly _sweepHandler: SweepSignalsHandler,
    @Inject(TeamNameResolver) private readonly _teams: TeamNameResolver,
    @Inject(ConsumerHub) private readonly _hub: ConsumerHub,
    @Inject(SignalHistoryRecorder)
    private readonly _history: SignalHistoryRecorder,
    @Inject(AbandonActiveSignalsHandler)
    private readonly _abandon: AbandonActiveSignalsHandler,
  ) {}

  async onModuleInit() {
    await this._teams.reload();

    // kèo còn 'active' từ lần chạy trước không còn ai theo dõi
    try {
      const n = await this._abandon.execute({ reason: 'app_restart' });
      if (n) this._logger.warn(`đã đóng ${n} kèo còn treo từ lần chạy trước`);
    } catch (e: unknown) {
      this._logger.error(`không đóng được kèo cũ: ${String(e)}`);
    }

    // adapter đầu vào: mọi publisher (worker/microservice) → use case ingest
    this._supervisor.onData(async (msg) => {
      try {
        await this._ingest.execute(msg);
      } catch (e: unknown) {
        this._logger.error(`ingest ${msg.taskId}#${msg.seq} lỗi: ${String(e)}`);
      }
    });

    // publisher chết hẳn / bị dừng qua API → gỡ odds nó từng cung cấp, hủy kèo liên quan
    this._supervisor.onTaskGone(async (record) => {
      try {
        await this._release.execute({
          taskId: record.spec.taskId,
          kind: record.spec.kind,
        });
      } catch (e: unknown) {
        this._logger.error(`release ${record.spec.taskId} lỗi: ${String(e)}`);
      }
    });

    this._sweep = setInterval(() => {
      this._sweepHandler
        .execute()
        .catch((e: unknown) => this._logger.error(String(e)));
    }, SWEEP_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    if (this._sweep) clearInterval(this._sweep);
    await this._hub.close();
    await this._history.flush();
  }
}
