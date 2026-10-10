import type { MessagePort } from 'node:worker_threads';
import {
  TASK_PROTOCOL_VERSION,
  type AppToTaskMessage,
  type TaskEnvelope,
  type TaskToAppMessage,
} from '../../application/task-protocol.js';
import type { TaskEndpoint } from '../runtime/task-endpoint.js';

export class ParentPortTaskEndpoint implements TaskEndpoint {
  private _taskId = '';

  constructor(private readonly _port: MessagePort) {}

  send(msg: TaskToAppMessage): void {
    const env: TaskEnvelope<TaskToAppMessage> = {
      v: TASK_PROTOCOL_VERSION,
      taskId: this._taskId,
      msg,
    };
    this._port.postMessage(env);
  }

  onMessage(handler: (msg: AppToTaskMessage) => void): void {
    this._port.on('message', (env: TaskEnvelope<AppToTaskMessage>) => {
      this._taskId = env.taskId;
      handler(env.msg);
    });
  }
}
