import {
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/infrastructure/config/env.schema.js';
import { TaskSupervisor } from './application/task-supervisor.js';
import {
  TASK_LAUNCHERS,
  type TaskLauncher,
} from './application/task-launcher.js';
import {
  TASK_REGISTRY,
  type TaskRegistry,
} from './application/task-registry.js';
import {
  TASK_ALERT_NOTIFIER,
  type TaskAlertNotifier,
} from './application/task-alert.notifier.js';
import { StartTaskHandler } from './application/commands/start-task.command.js';
import { RestartTaskHandler } from './application/commands/restart-task.command.js';
import {
  TASK_SPEC_STORE,
  type TaskSpecStore,
} from './application/task-spec.store.js';
import { RestorePersistedTasks } from './application/restore-persisted-tasks.js';
import { DrizzleTaskSpecStore } from './infrastructure/persistence/drizzle/drizzle-task-spec.store.js';
import { TransactionContext } from '../../shared/infrastructure/database/transaction-context.js';
import { StopTaskHandler } from './application/commands/stop-task.command.js';
import { DeleteTaskHandler } from './application/commands/delete-task.command.js';
import { SendTaskCommandHandler } from './application/commands/send-task-command.command.js';
import { ListTasksHandler } from './application/queries/list-tasks.query.js';
import { GetTaskHandler } from './application/queries/get-task.query.js';
import { ListTaskKindsHandler } from './application/queries/list-task-kinds.query.js';
import {
  TASK_KIND_REGISTRY,
  type TaskKindRegistry,
} from './application/task-kind.registry.js';
import { CatalogTaskKindRegistry } from './infrastructure/runtime/catalog-task-kind.registry.js';
import { TASK_CATALOG } from './infrastructure/runtime/task-catalog.js';
import { WorkerThreadTaskLauncher } from './infrastructure/worker-thread/worker-thread.task-launcher.js';
import { WsRemoteTaskLauncher } from './infrastructure/remote/ws-remote.task-launcher.js';
import { InMemoryTaskRegistry } from './infrastructure/persistence/in-memory-task.registry.js';
import { NoopTaskAlertNotifier } from './infrastructure/notifier/noop-task-alert.notifier.js';
import { TasksController } from './presentation/tasks.controller.js';
import {
  NODE_DIRECTORY,
  type NodeDirectory,
} from './application/node-directory.js';
import {
  OPS_EVENT_BUS,
  type OpsEventBus,
} from '../../shared/application/ops-event-bus.js';

@Module({
  controllers: [TasksController],
  providers: [
    {
      provide: WsRemoteTaskLauncher,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) => {
        const launcher = new WsRemoteTaskLauncher(
          cfg.get('TASK_WS_PORT'),
          cfg.get('TASK_WS_TOKEN'),
          {
            host: cfg.get('WS_BIND_HOST'),
            maxPayloadBytes: cfg.get('TASK_WS_MAX_PAYLOAD_MB') * 1024 * 1024,
          },
        );
        launcher.listen();
        return launcher;
      },
    },
    { provide: NODE_DIRECTORY, useExisting: WsRemoteTaskLauncher },
    {
      provide: TASK_LAUNCHERS,
      inject: [WsRemoteTaskLauncher],
      useFactory: (remote: WsRemoteTaskLauncher): TaskLauncher[] => [
        new WorkerThreadTaskLauncher(),
        remote,
      ],
    },
    // factory: mỗi lần khởi tạo module một registry mới (không dùng chung giữa các app trong cùng process)
    { provide: TASK_REGISTRY, useFactory: () => new InMemoryTaskRegistry() },
    {
      provide: TASK_SPEC_STORE,
      inject: [TransactionContext],
      useFactory: (tx: TransactionContext) => new DrizzleTaskSpecStore(tx),
    },
    { provide: TASK_ALERT_NOTIFIER, useValue: new NoopTaskAlertNotifier() },
    {
      provide: TaskSupervisor,
      inject: [TASK_LAUNCHERS, TASK_REGISTRY, TASK_ALERT_NOTIFIER],
      useFactory: (
        launchers: TaskLauncher[],
        registry: TaskRegistry,
        notifier: TaskAlertNotifier,
      ) => new TaskSupervisor(launchers, registry, notifier),
    },
    {
      provide: TASK_KIND_REGISTRY,
      useValue: new CatalogTaskKindRegistry(TASK_CATALOG),
    },
    {
      provide: StartTaskHandler,
      inject: [TaskSupervisor, TASK_KIND_REGISTRY, TASK_SPEC_STORE],
      useFactory: (s: TaskSupervisor, k: TaskKindRegistry, st: TaskSpecStore) =>
        new StartTaskHandler(s, k, st),
    },
    {
      provide: RestartTaskHandler,
      inject: [TaskSupervisor, StartTaskHandler],
      useFactory: (s: TaskSupervisor, start: StartTaskHandler) =>
        new RestartTaskHandler(s, start),
    },
    {
      provide: RestorePersistedTasks,
      inject: [
        TASK_SPEC_STORE,
        TaskSupervisor,
        StartTaskHandler,
        NODE_DIRECTORY,
      ],
      useFactory: (
        st: TaskSpecStore,
        s: TaskSupervisor,
        start: StartTaskHandler,
        nodes: NodeDirectory,
      ) => new RestorePersistedTasks(st, s, start, nodes, new Logger('Tasks')),
    },
    {
      provide: ListTaskKindsHandler,
      inject: [TASK_KIND_REGISTRY],
      useFactory: (k: TaskKindRegistry) => new ListTaskKindsHandler(k),
    },
    {
      provide: StopTaskHandler,
      inject: [TaskSupervisor, TASK_SPEC_STORE],
      useFactory: (s: TaskSupervisor, st: TaskSpecStore) =>
        new StopTaskHandler(s, st),
    },
    {
      provide: DeleteTaskHandler,
      inject: [TaskSupervisor, TASK_SPEC_STORE],
      useFactory: (s: TaskSupervisor, st: TaskSpecStore) =>
        new DeleteTaskHandler(s, st),
    },
    {
      provide: SendTaskCommandHandler,
      inject: [TaskSupervisor],
      useFactory: (s: TaskSupervisor) => new SendTaskCommandHandler(s),
    },
    {
      provide: ListTasksHandler,
      inject: [TASK_REGISTRY],
      useFactory: (r: TaskRegistry) => new ListTasksHandler(r),
    },
    {
      provide: GetTaskHandler,
      inject: [TASK_REGISTRY],
      useFactory: (r: TaskRegistry) => new GetTaskHandler(r),
    },
  ],
  // Context khác (odds) chỉ thấy application: nghe dữ liệu + gửi lệnh cho task.
  exports: [TaskSupervisor, NODE_DIRECTORY],
})
export class TasksModule
  implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly _logger = new Logger('Tasks');

  constructor(
    @Inject(WsRemoteTaskLauncher)
    private readonly _remote: WsRemoteTaskLauncher,
    @Inject(TaskSupervisor) private readonly _supervisor: TaskSupervisor,
    @Inject(OPS_EVENT_BUS) private readonly _ops: OpsEventBus,
    @Inject(RestorePersistedTasks)
    private readonly _restore: RestorePersistedTasks,
  ) {}

  /**
   * Chạy SAU mọi onModuleInit: module odds đã đăng ký nghe dữ liệu task,
   * nên task lưu bền chạy lại lúc này không bị mất dữ liệu vòng đầu.
   */
  async onApplicationBootstrap() {
    try {
      await this._restore.run();
    } catch (e: unknown) {
      const c = e instanceof Error ? e.cause : undefined;
      this._logger.error(
        `không nạp được task lưu bền: ${String(e)}${c instanceof Error ? ` — ${c.message}` : ''}`,
      );
    }
  }

  /**
   * Log vòng đời publisher (RUNNING/STOPPED = log, RESTARTING = warn, FAILED = error)
   * và phát sự kiện vận hành cho admin (task + node).
   */
  onModuleInit() {
    this._remote.onChange((c) => {
      const at = Date.now();
      if (c.type === 'connected') {
        this._logger.log(`node ${c.nodeId} đã kết nối`);
        this._ops.publish({
          type: 'node.connected',
          topic: 'nodes',
          at,
          data: { nodeId: c.nodeId },
        });
      } else {
        this._logger.warn(
          `node ${c.nodeId} mất kết nối (task bị ảnh hưởng: ${c.affectedTasks.join(', ') || 'không có'})`,
        );
        this._ops.publish({
          type: 'node.disconnected',
          topic: 'nodes',
          at,
          data: { nodeId: c.nodeId, affectedTasks: [...c.affectedTasks] },
        });
      }
    });

    this._supervisor.onLifecycle((e) => {
      const { taskId, kind, tenant } = e.record.spec;
      const who = `${taskId} (${kind})`;
      const at = Date.now();
      if (e.type === 'removed') {
        this._logger.log(`${who}: đã xóa hồ sơ`);
        this._ops.publish({
          type: 'task.removed',
          topic: 'tasks',
          at,
          data: { taskId, kind },
        });
        return;
      }
      if (e.type === 'task_error') {
        this._ops.publish({
          type: 'task.error',
          topic: 'tasks',
          at,
          data: { taskId, kind, message: e.message, fatal: e.fatal },
        });
        const text = `${who} báo lỗi${e.fatal ? ' nghiêm trọng' : ''}: ${e.message}`;
        if (e.fatal) this._logger.error(text);
        else this._logger.warn(text);
        return;
      }
      const to = e.record.state;
      this._ops.publish({
        type: 'task.state',
        topic: 'tasks',
        at,
        data: {
          taskId,
          kind,
          tenant,
          from: e.from,
          to,
          ...(e.reason ? { reason: e.reason } : {}),
        },
      });
      const text = `${who}: ${e.from} → ${to}${e.reason ? ` — ${e.reason}` : ''}`;
      if (to === 'FAILED') this._logger.error(text);
      else if (to === 'RESTARTING') this._logger.warn(text);
      else if (to === 'RUNNING' || to === 'STOPPING' || to === 'STOPPED')
        this._logger.log(text);
      else this._logger.debug(text);
    });
  }

  async onApplicationShutdown() {
    await this._remote.close();
  }
}
