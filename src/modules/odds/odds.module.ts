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
import { IngestStats } from './application/ingest-stats.js';
import { GetIngestStatsHandler } from './application/queries/get-ingest-stats.query.js';
import { ReleaseTaskOddsHandler } from './application/commands/release-task-odds.command.js';
import { ResetOddsRoomsHandler } from './application/commands/reset-odds-rooms.command.js';
import { ExpireFinishedMatchesHandler } from './application/commands/expire-finished-matches.command.js';
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
import { OpsSignalRelay } from './application/ops-signal.relay.js';
import {
  OPS_EVENT_BUS,
  type OpsEventBus,
} from '../../shared/application/ops-event-bus.js';
import { ListRoomsHandler } from './application/queries/list-rooms.query.js';
import { ListMatchesHandler } from './application/queries/list-matches.query.js';
import { GetMatchHandler } from './application/queries/get-match.query.js';
import { GetArbitrageStatsHandler } from './application/queries/get-arbitrage-stats.query.js';
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
import { PurgeSignalHistoryHandler } from './application/commands/purge-signal-history.command.js';
// presentation
import { TeamAliasesController } from './presentation/team-aliases.controller.js';
import { ConsumersController } from './presentation/consumers.controller.js';
import { ArbitrageController } from './presentation/arbitrage.controller.js';

const SWEEP_INTERVAL_MS = 5_000;
const EXPIRE_INTERVAL_MS = 60_000;

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
      inject: [ConfigService, OPS_EVENT_BUS],
      useFactory: (cfg: ConfigService<Env, true>, ops: OpsEventBus) => {
        const hub = new ConsumerHub({
          port: cfg.get('CONSUMER_WS_PORT'),
          host: cfg.get('WS_BIND_HOST'),
          token: cfg.get('CONSUMER_WS_TOKEN'),
          onPresence: (change, c) =>
            ops.publish({
              type:
                change === 'connected'
                  ? 'consumer.connected'
                  : 'consumer.disconnected',
              topic: 'consumers',
              at: Date.now(),
              data: c,
            }),
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
      inject: [ConsumerHub, SignalHistoryRecorder, OPS_EVENT_BUS],
      useFactory: (
        hub: ConsumerHub,
        history: SignalHistoryRecorder,
        ops: OpsEventBus,
      ) => new CompositeEventPublisher([hub, history, new OpsSignalRelay(ops)]),
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
    {
      provide: PurgeSignalHistoryHandler,
      inject: [SIGNAL_HISTORY_REPOSITORY],
      useFactory: (r: SignalHistoryRepository) =>
        new PurgeSignalHistoryHandler(r),
    },
    { provide: CONSUMER_CONTROL, useExisting: ConsumerHub },

    // ---------- application services
    {
      provide: TeamNameResolver,
      inject: [TEAM_ALIAS_REPOSITORY],
      useFactory: (repo: TeamAliasRepository) => new TeamNameResolver(repo),
    },
    { provide: IngestStats, useValue: new IngestStats() },
    {
      provide: GetIngestStatsHandler,
      inject: [IngestStats],
      useFactory: (s: IngestStats) => new GetIngestStatsHandler(s),
    },
    {
      provide: RAW_ODDS_TRANSLATORS,
      inject: [TeamNameResolver, TaskSupervisor, IngestStats, OPS_EVENT_BUS],
      useFactory: (
        teams: TeamNameResolver,
        supervisor: TaskSupervisor,
        stats: IngestStats,
        ops: OpsEventBus,
      ): RawOddsTranslator[] => [
        new SptPubOddsTranslator(teams, stats.reporter('sptpub')),
        new PolymarketOddsTranslator(
          teams,
          async (op, assetIds) => {
            // gửi tới mọi task stream đang chạy; lệnh idempotent nên gửi lại toàn bộ cũng an toàn
            const streams = (await supervisor.list()).filter(
              (t) =>
                t.spec.kind === 'polymarket.stream' && t.state === 'RUNNING',
            );
            for (const t of streams)
              await supervisor.command(t.spec.taskId, op, { assetIds });
          },
          stats.reporter('polymarket'),
          // mỗi vòng đối chiếu danh sách → admin (sự cố khi gỡ hàng loạt bất thường)
          (r) =>
            ops.publish({
              type: 'odds.reconciled',
              topic: 'odds',
              at: Date.now(),
              data: { tenant: 'polymarket', ...r },
            }),
        ),
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
      inject: [ODDS_ROOM_STORE, ArbitrageEvaluator, OPS_EVENT_BUS],
      useFactory: (
        rooms: OddsRoomStore,
        ev: ArbitrageEvaluator,
        ops: OpsEventBus,
      ) => new OddsLineApplier(rooms, ev, ops),
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
      inject: [RAW_ODDS_TRANSLATORS, LaneDispatcher, IngestStats],
      useFactory: (t: RawOddsTranslator[], l: LaneDispatcher, s: IngestStats) =>
        new IngestTaskDataHandler(t, l, s),
    },
    {
      provide: ReleaseTaskOddsHandler,
      inject: [RAW_ODDS_TRANSLATORS, LaneDispatcher],
      useFactory: (t: RawOddsTranslator[], l: LaneDispatcher) =>
        new ReleaseTaskOddsHandler(t, l),
    },
    {
      provide: ResetOddsRoomsHandler,
      inject: [ODDS_ROOM_STORE, OPS_EVENT_BUS],
      useFactory: (r: OddsRoomStore, ops: OpsEventBus) =>
        new ResetOddsRoomsHandler(r, ops),
    },
    {
      provide: ExpireFinishedMatchesHandler,
      inject: [ODDS_ROOM_STORE, LaneDispatcher],
      useFactory: (r: OddsRoomStore, l: LaneDispatcher) =>
        new ExpireFinishedMatchesHandler(r, l),
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
      inject: [ODDS_ROOM_STORE, ARBITRAGE_SETTINGS_STORE, SIGNAL_STATE_STORE],
      useFactory: (
        r: OddsRoomStore,
        s: ArbitrageSettingsStore,
        sig: SignalStateStore,
      ) => new GetRoomHandler(r, s, sig),
    },
    {
      provide: ListRoomsHandler,
      inject: [ODDS_ROOM_STORE, ARBITRAGE_SETTINGS_STORE],
      useFactory: (r: OddsRoomStore, s: ArbitrageSettingsStore) =>
        new ListRoomsHandler(r, s),
    },
    {
      provide: ListMatchesHandler,
      inject: [ODDS_ROOM_STORE, ARBITRAGE_SETTINGS_STORE],
      useFactory: (r: OddsRoomStore, s: ArbitrageSettingsStore) =>
        new ListMatchesHandler(r, s),
    },
    {
      provide: GetMatchHandler,
      inject: [ODDS_ROOM_STORE, ARBITRAGE_SETTINGS_STORE],
      useFactory: (r: OddsRoomStore, s: ArbitrageSettingsStore) =>
        new GetMatchHandler(r, s),
    },
    {
      provide: GetArbitrageStatsHandler,
      inject: [ListRoomsHandler, ArbitrageEvaluator, SIGNAL_STATE_STORE],
      useFactory: (
        r: ListRoomsHandler,
        e: ArbitrageEvaluator,
        s: SignalStateStore,
      ) => new GetArbitrageStatsHandler(r, e, s),
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
  // Cho module admin đọc số liệu (chỉ lớp application).
  exports: [
    ListRoomsHandler,
    GetArbitrageStatsHandler,
    ListLanesHandler,
    GetArbitrageSettingsHandler,
    GetRoomHandler,
    GetIngestStatsHandler,
    GetMatchHandler,
    PurgeSignalHistoryHandler,
    CONSUMER_CONTROL,
    SignalHistoryRecorder,
  ],
})
export class OddsModule implements OnModuleInit, OnApplicationShutdown {
  private readonly _logger = new Logger(OddsModule.name);
  private _sweep: ReturnType<typeof setInterval> | null = null;
  private _expire: ReturnType<typeof setInterval> | null = null;

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
    @Inject(ResetOddsRoomsHandler)
    private readonly _reset: ResetOddsRoomsHandler,
    @Inject(ExpireFinishedMatchesHandler)
    private readonly _expireHandler: ExpireFinishedMatchesHandler,
    @Inject(ConfigService) private readonly _cfg: ConfigService<Env, true>,
  ) {}

  async onModuleInit() {
    await this._teams.reload();

    // kèo còn 'active' từ lần chạy trước không còn ai theo dõi
    try {
      const n = await this._abandon.execute({ reason: 'app_restart' });
      if (n) this._logger.warn(`đã đóng ${n} kèo còn treo từ lần chạy trước`);
    } catch (e: unknown) {
      // DrizzleQueryError chỉ ghi câu SQL; lỗi thật của Postgres nằm ở `cause`.
      const c = e instanceof Error ? e.cause : undefined;
      const cause = c instanceof Error ? ` — ${c.message}` : '';
      this._logger.error(`không đóng được kèo cũ: ${String(e)}${cause}`);
    }

    // dòng kèo từ lần chạy trước không còn bảng định tuyến (RAM) → mồ côi: xóa trước khi nhận dữ liệu
    if (this._cfg.get('RESET_ROOMS_ON_START', { infer: true })) {
      try {
        const r = await this._reset.execute({ reason: 'reset_on_start' });
        if (r.rooms)
          this._logger.warn(
            `đã xóa ${r.rooms} room (${r.lines} dòng kèo) từ lần chạy trước`,
          );
      } catch (e: unknown) {
        this._logger.error(`không xóa được room cũ: ${String(e)}`);
      }
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

    // lưới an toàn: gỡ dòng kèo của trận chắc chắn đã kết thúc
    const maxMatchDurationMs =
      this._cfg.get('MATCH_MAX_DURATION_HOURS', { infer: true }) * 3_600_000;
    this._expire = setInterval(() => {
      this._expireHandler
        .execute({ maxMatchDurationMs })
        .then((n) => {
          if (n) this._logger.log(`gỡ ${n} dòng kèo của trận đã kết thúc`);
        })
        .catch((e: unknown) => this._logger.error(String(e)));
    }, EXPIRE_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    if (this._sweep) clearInterval(this._sweep);
    if (this._expire) clearInterval(this._expire);
    await this._hub.close();
    await this._history.flush();
  }
}
