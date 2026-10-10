import type {
  AppToTaskMessage,
  TaskToAppMessage,
} from '../../application/task-protocol.js';

/** Phía TASK của kênh: giống nhau cho parentPort và WebSocket. */
export interface TaskEndpoint {
  send(msg: TaskToAppMessage): void;
  onMessage(handler: (msg: AppToTaskMessage) => void): void;
}
