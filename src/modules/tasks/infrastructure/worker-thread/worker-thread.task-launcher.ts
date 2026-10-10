import { Worker } from 'node:worker_threads';
import type {
  TaskConnection,
  TaskLauncher,
} from '../../application/task-launcher.js';
import {
  TASK_PROTOCOL_VERSION,
  type AppToTaskMessage,
  type TaskEnvelope,
  type TaskToAppMessage,
} from '../../application/task-protocol.js';
import type { TaskRuntimeTarget, TaskSpec } from '../../domain/task-spec.js';

const DEFAULT_WORKER_ENTRY = new URL('./task.worker.js', import.meta.url);

export class WorkerThreadTaskLauncher implements TaskLauncher {
  constructor(private readonly _entry: URL = DEFAULT_WORKER_ENTRY) {}

  supports(target: TaskRuntimeTarget): boolean {
    return target.type === 'worker';
  }

  launch(spec: TaskSpec): Promise<TaskConnection> {
    const worker = new Worker(this._entry, { name: `task:${spec.taskId}` });
    let exited = false;

    const conn: TaskConnection = {
      send: (msg: AppToTaskMessage) => {
        const env: TaskEnvelope<AppToTaskMessage> = {
          v: TASK_PROTOCOL_VERSION,
          taskId: spec.taskId,
          msg,
        };
        worker.postMessage(env);
      },
      onMessage: (handler) =>
        worker.on('message', (env: TaskEnvelope<TaskToAppMessage>) =>
          handler(env.msg),
        ),
      onExit: (handler) => {
        worker.on('error', (e: Error) => handler(`worker error: ${e.message}`));
        worker.on('exit', (code) => {
          if (!exited) handler(`worker exit code ${code}`);
        });
      },
      terminate: async () => {
        exited = true;
        await worker.terminate();
      },
    };
    return Promise.resolve(conn);
  }
}
