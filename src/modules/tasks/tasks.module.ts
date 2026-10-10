import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
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
import { StopTaskHandler } from './application/commands/stop-task.command.js';
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
        );
        launcher.listen();
        return launcher;
      },
    },
    {
      provide: TASK_LAUNCHERS,
      inject: [WsRemoteTaskLauncher],
      useFactory: (remote: WsRemoteTaskLauncher): TaskLauncher[] => [
        new WorkerThreadTaskLauncher(),
        remote,
      ],
    },
    { provide: TASK_REGISTRY, useValue: new InMemoryTaskRegistry() },
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
      inject: [TaskSupervisor, TASK_KIND_REGISTRY],
      useFactory: (s: TaskSupervisor, k: TaskKindRegistry) =>
        new StartTaskHandler(s, k),
    },
    {
      provide: ListTaskKindsHandler,
      inject: [TASK_KIND_REGISTRY],
      useFactory: (k: TaskKindRegistry) => new ListTaskKindsHandler(k),
    },
    {
      provide: StopTaskHandler,
      inject: [TaskSupervisor],
      useFactory: (s: TaskSupervisor) => new StopTaskHandler(s),
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
  exports: [TaskSupervisor],
})
export class TasksModule implements OnApplicationShutdown {
  constructor(
    @Inject(WsRemoteTaskLauncher)
    private readonly _remote: WsRemoteTaskLauncher,
  ) {}

  async onApplicationShutdown() {
    await this._remote.close();
  }
}
