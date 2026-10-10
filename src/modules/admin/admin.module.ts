import {
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../../shared/infrastructure/config/env.schema.js';
import {
  OPS_EVENT_BUS,
  type OpsEventBus,
} from '../../shared/application/ops-event-bus.js';
import { TransactionContext } from '../../shared/infrastructure/database/transaction-context.js';
import {
  DRIZZLE,
  type DbExecutor,
} from '../../shared/infrastructure/database/database.types.js';
import { REDIS_CLIENT } from '../../shared/infrastructure/redis/redis.types.js';
import {
  AUTHENTICATOR,
  type Authenticator,
} from '../auth/application/authenticator.js';
import { AuthorizationService } from '../auth/application/authorization.service.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { TaskSupervisor } from '../tasks/application/task-supervisor.js';
import {
  NODE_DIRECTORY,
  type NodeDirectory,
} from '../tasks/application/node-directory.js';
import { OddsModule } from '../odds/odds.module.js';
import {
  CONSUMER_CONTROL,
  type ConsumerControl,
} from '../odds/application/consumer-control.js';
import { GetArbitrageStatsHandler } from '../odds/application/queries/get-arbitrage-stats.query.js';
import { ListLanesHandler } from '../odds/application/queries/list-lanes.query.js';
import { GetArbitrageSettingsHandler } from '../odds/application/queries/get-arbitrage-settings.query.js';
import { GetRoomHandler } from '../odds/application/queries/get-room.query.js';
import {
  ADMIN_SOURCES,
  type AdminSources,
} from './application/admin-sources.js';
import {
  ALERT_NOTIFIER,
  type AlertNotifier,
} from './application/alert-notifier.js';
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from './application/audit.repository.js';
import { AuditRecorder } from './application/audit-recorder.js';
import { BackgroundQueue } from './application/background-queue.js';
import {
  HEALTH_PROBES,
  HealthMonitor,
  type HealthProbe,
} from './application/health.js';
import {
  INCIDENT_REPOSITORY,
  type IncidentRepository,
} from './application/incident.repository.js';
import { IncidentTracker } from './application/incident-tracker.js';
import { MetricsSampler } from './application/metrics-sampler.js';
import {
  ODDS_TRANSITION_REPOSITORY,
  type OddsTransitionRepository,
} from './application/odds-transition.repository.js';
import {
  DEFAULT_TRANSITION_RECORDER_OPTIONS,
  OddsTransitionRecorder,
} from './application/odds-transition.recorder.js';
import { OpsWatchdog } from './application/ops-watchdog.js';
import { GetAdminSnapshotHandler } from './application/queries/get-admin-snapshot.query.js';
import { ListIncidentsHandler } from './application/queries/list-incidents.query.js';
import { ListAuditHandler } from './application/queries/list-audit.query.js';
import { ListOddsTransitionsHandler } from './application/queries/list-odds-transitions.query.js';
import { AcknowledgeIncidentHandler } from './application/commands/acknowledge-incident.command.js';
import { DrizzleIncidentRepository } from './infrastructure/persistence/drizzle/drizzle-incident.repository.js';
import { DrizzleAuditRepository } from './infrastructure/persistence/drizzle/drizzle-audit.repository.js';
import { DrizzleOddsTransitionRepository } from './infrastructure/persistence/drizzle/drizzle-odds-transition.repository.js';
import { LogAlertNotifier } from './infrastructure/notifier/log.alert-notifier.js';
import { DiscordWebhookAlertNotifier } from './infrastructure/notifier/discord-webhook.alert-notifier.js';
import { CompositeAlertNotifier } from './infrastructure/notifier/composite.alert-notifier.js';
import { RedisHealthProbe } from './infrastructure/health/redis.health-probe.js';
import { PostgresHealthProbe } from './infrastructure/health/postgres.health-probe.js';
import { AdminWsHub } from './infrastructure/stream/admin-ws-hub.js';
import { AdminController } from './presentation/admin.controller.js';
import { HealthController } from './presentation/health.controller.js';
import { AuditInterceptor } from './presentation/audit.interceptor.js';

const WATCHDOG_INTERVAL_MS = 5_000;
const HEALTH_INTERVAL_MS = 10_000;
const ADMIN_QUEUE = Symbol('ADMIN_QUEUE');

/**
 * Vận hành: phát hiện sự cố (mức 1), stream trạng thái cho dashboard (mức 2),
 * audit + lịch sử (mức 3). Chỉ ĐỌC từ tasks/odds qua lớp application + bus vận hành.
 */
@Module({
  imports: [TasksModule, OddsModule],
  controllers: [AdminController, HealthController],
  providers: [
    // ---------- adapters
    {
      provide: INCIDENT_REPOSITORY,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) => new DrizzleIncidentRepository(tx),
    },
    {
      provide: AUDIT_REPOSITORY,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) => new DrizzleAuditRepository(tx),
    },
    {
      provide: ODDS_TRANSITION_REPOSITORY,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) =>
        new DrizzleOddsTransitionRepository(tx),
    },
    {
      provide: ALERT_NOTIFIER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>): AlertNotifier => {
        const url = cfg.get('DISCORD_ALERT_WEBHOOK_URL', { infer: true });
        const logger = new Logger('Alerts');
        const channels: AlertNotifier[] = [new LogAlertNotifier()];
        if (url)
          channels.push(
            new DiscordWebhookAlertNotifier(url, (m) => logger.error(m)),
          );
        return new CompositeAlertNotifier(channels);
      },
    },
    {
      provide: HEALTH_PROBES,
      inject: [REDIS_CLIENT, DRIZZLE],
      useFactory: (redis: Redis, db: DbExecutor): HealthProbe[] => [
        new RedisHealthProbe(redis),
        new PostgresHealthProbe(db),
      ],
    },
    {
      provide: ADMIN_SOURCES,
      inject: [
        TaskSupervisor,
        NODE_DIRECTORY,
        CONSUMER_CONTROL,
        GetArbitrageStatsHandler,
        ListLanesHandler,
        GetArbitrageSettingsHandler,
      ],
      useFactory: (
        supervisor: TaskSupervisor,
        nodes: NodeDirectory,
        consumers: ConsumerControl,
        stats: GetArbitrageStatsHandler,
        lanes: ListLanesHandler,
        settings: GetArbitrageSettingsHandler,
      ): AdminSources => ({
        tasks: () => supervisor.list(),
        nodes: () => nodes.list(),
        consumers: () => consumers.list(),
        arbitrage: () => stats.execute(),
        lanes: () => lanes.execute(),
        settings: () => settings.execute(),
      }),
    },

    // ---------- application services
    {
      provide: ADMIN_QUEUE,
      useFactory: () => {
        const logger = new Logger('AdminWriter');
        return new BackgroundQueue((e) => logger.error(errorText(e)));
      },
    },
    {
      provide: IncidentTracker,
      inject: [INCIDENT_REPOSITORY, ALERT_NOTIFIER, OPS_EVENT_BUS, ADMIN_QUEUE],
      useFactory: (
        repo: IncidentRepository,
        notifier: AlertNotifier,
        ops: OpsEventBus,
        queue: BackgroundQueue,
      ) => new IncidentTracker(repo, notifier, ops, queue),
    },
    {
      provide: HealthMonitor,
      inject: [HEALTH_PROBES],
      useFactory: (probes: HealthProbe[]) => new HealthMonitor(probes),
    },
    {
      provide: OpsWatchdog,
      inject: [ADMIN_SOURCES, IncidentTracker, HealthMonitor],
      useFactory: (
        src: AdminSources,
        incidents: IncidentTracker,
        health: HealthMonitor,
      ) => {
        // lanes() trả Promise còn watchdog cần đồng bộ → giữ bản gần nhất
        let lanes: Awaited<ReturnType<AdminSources['lanes']>> = [];
        return new OpsWatchdog(
          {
            tasks: async () => {
              lanes = await src.lanes();
              return (await src.tasks()).map((t) => ({
                taskId: t.spec.taskId,
                kind: t.spec.kind,
                state: t.state,
                consecutiveFailures: t.consecutiveFailures,
                lastDataAt: t.lastDataAt,
                lastError: t.lastError,
                params: t.spec.params,
              }));
            },
            nodes: () => src.nodes(),
            consumers: () => src.consumers(),
            lanes: () => lanes,
            health: () => health.latest(),
          },
          incidents,
        );
      },
    },
    {
      provide: MetricsSampler,
      inject: [ADMIN_SOURCES],
      useFactory: (src: AdminSources) => new MetricsSampler(src),
    },
    {
      provide: AuditRecorder,
      inject: [AUDIT_REPOSITORY, ADMIN_QUEUE, OPS_EVENT_BUS],
      useFactory: (
        repo: AuditRepository,
        queue: BackgroundQueue,
        ops: OpsEventBus,
      ) => new AuditRecorder(repo, queue, ops),
    },
    {
      provide: OddsTransitionRecorder,
      inject: [ODDS_TRANSITION_REPOSITORY, OPS_EVENT_BUS, ConfigService],
      useFactory: (
        repo: OddsTransitionRepository,
        ops: OpsEventBus,
        cfg: ConfigService<Env, true>,
      ) => {
        const logger = new Logger('OddsTransitions');
        return new OddsTransitionRecorder(
          repo,
          ops,
          (e) => logger.error(errorText(e)),
          {
            ...DEFAULT_TRANSITION_RECORDER_OPTIONS,
            retentionMs:
              cfg.get('ODDS_TRANSITION_RETENTION_DAYS', { infer: true }) *
              24 *
              3_600_000,
          },
        );
      },
    },

    // ---------- queries / commands
    {
      provide: GetAdminSnapshotHandler,
      inject: [ADMIN_SOURCES, IncidentTracker, HealthMonitor],
      useFactory: (
        src: AdminSources,
        incidents: IncidentTracker,
        health: HealthMonitor,
      ) => new GetAdminSnapshotHandler(src, incidents, health),
    },
    {
      provide: ListIncidentsHandler,
      inject: [INCIDENT_REPOSITORY, IncidentTracker],
      useFactory: (repo: IncidentRepository, t: IncidentTracker) =>
        new ListIncidentsHandler(repo, t),
    },
    {
      provide: AcknowledgeIncidentHandler,
      inject: [IncidentTracker],
      useFactory: (t: IncidentTracker) => new AcknowledgeIncidentHandler(t),
    },
    {
      provide: ListAuditHandler,
      inject: [AUDIT_REPOSITORY],
      useFactory: (repo: AuditRepository) => new ListAuditHandler(repo),
    },
    {
      provide: ListOddsTransitionsHandler,
      inject: [ODDS_TRANSITION_REPOSITORY],
      useFactory: (repo: OddsTransitionRepository) =>
        new ListOddsTransitionsHandler(repo),
    },

    // ---------- presentation (stream + audit)
    {
      provide: AdminWsHub,
      inject: [
        ConfigService,
        OPS_EVENT_BUS,
        AUTHENTICATOR,
        AuthorizationService,
        GetAdminSnapshotHandler,
        MetricsSampler,
        GetRoomHandler,
      ],
      useFactory: (
        cfg: ConfigService<Env, true>,
        ops: OpsEventBus,
        auth: Authenticator,
        authz: AuthorizationService,
        snapshot: GetAdminSnapshotHandler,
        metrics: MetricsSampler,
        room: GetRoomHandler,
      ) => {
        const logger = new Logger('AdminStream');
        return new AdminWsHub(
          { port: cfg.get('ADMIN_WS_PORT', { infer: true }) },
          ops,
          auth,
          authz,
          snapshot,
          metrics,
          (r) => room.execute({ room: r }),
          (m) => logger.error(m),
        );
      },
    },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AdminModule implements OnModuleInit, OnApplicationShutdown {
  private readonly _logger = new Logger('Admin');
  private _timers: ReturnType<typeof setInterval>[] = [];
  private _ticking = false;

  constructor(
    @Inject(IncidentTracker) private readonly _incidents: IncidentTracker,
    @Inject(OpsWatchdog) private readonly _watchdog: OpsWatchdog,
    @Inject(HealthMonitor) private readonly _health: HealthMonitor,
    @Inject(OddsTransitionRecorder)
    private readonly _transitions: OddsTransitionRecorder,
    @Inject(AdminWsHub) private readonly _hub: AdminWsHub,
    @Inject(ADMIN_QUEUE) private readonly _queue: BackgroundQueue,
  ) {}

  async onModuleInit() {
    try {
      const n = await this._incidents.init();
      if (n) this._logger.warn(`đã đóng ${n} sự cố còn mở từ lần chạy trước`);
    } catch (e: unknown) {
      this._logger.error(`không đóng được sự cố cũ: ${errorText(e)}`);
    }
    this._transitions.start();
    this._hub.listen();

    await this._health.check();
    this._timers.push(
      setInterval(() => {
        this._health
          .check()
          .catch((e: unknown) => this._logger.error(errorText(e)));
      }, HEALTH_INTERVAL_MS),
      setInterval(() => void this._tick(), WATCHDOG_INTERVAL_MS),
    );
  }

  async onApplicationShutdown() {
    this._timers.forEach(clearInterval);
    this._timers = [];
    await this._hub.close();
    await this._transitions.stop();
    await this._queue.flush();
  }

  private async _tick() {
    if (this._ticking) return;
    this._ticking = true;
    try {
      await this._watchdog.tick();
    } catch (e: unknown) {
      this._logger.error(`watchdog lỗi: ${errorText(e)}`);
    } finally {
      this._ticking = false;
    }
  }
}

/** DrizzleQueryError giấu lỗi Postgres trong `cause`. */
function errorText(e: unknown): string {
  const c = e instanceof Error ? e.cause : undefined;
  return `${String(e)}${c instanceof Error ? ` — ${c.message}` : ''}`;
}
