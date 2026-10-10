import type { TaskRuntimeTarget, TaskSpec } from '../domain/task-spec.js';
import type { AppToTaskMessage, TaskToAppMessage } from './task-protocol.js';

/** Một kết nối tới đúng một task đang chạy, bất kể transport. */
export interface TaskConnection {
  send(msg: AppToTaskMessage): void;
  onMessage(handler: (msg: TaskToAppMessage) => void): void;
  /** Kết nối mất (worker exit, WS đứt...). */
  onExit(handler: (reason: string) => void): void;
  terminate(): Promise<void>;
}

/** Port: mở một task ở runtime tương ứng. Adapter: worker thread, remote WS... */
export interface TaskLauncher {
  supports(target: TaskRuntimeTarget): boolean;
  launch(spec: TaskSpec): Promise<TaskConnection>;
}

export const TASK_LAUNCHERS = Symbol('TASK_LAUNCHERS');
