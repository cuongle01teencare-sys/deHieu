import type { RawData } from 'ws';
import type {
  AppToTaskMessage,
  TaskEnvelope,
  TaskToAppMessage,
} from '../../application/task-protocol.js';

/**
 * Khung WebSocket giữa app và một node microservice. Một node chạy nhiều task,
 * mỗi task vẫn nói đúng giao thức TaskEnvelope như worker thread.
 */
export type NodeToAppFrame =
  | { readonly type: 'hello'; readonly nodeId: string; readonly token: string }
  | { readonly type: 'task'; readonly envelope: TaskEnvelope<TaskToAppMessage> }
  | {
      readonly type: 'task_closed';
      readonly taskId: string;
      readonly reason: string;
    };

export type AppToNodeFrame =
  | { readonly type: 'welcome' }
  | { readonly type: 'rejected'; readonly reason: string }
  | { readonly type: 'task'; readonly envelope: TaskEnvelope<AppToTaskMessage> }
  | { readonly type: 'kill'; readonly taskId: string };

export const rawToString = (raw: RawData): string =>
  Array.isArray(raw)
    ? Buffer.concat(raw).toString('utf8')
    : Buffer.from(raw as ArrayBuffer).toString('utf8');

export const parseFrame = <T>(raw: RawData): T | null => {
  try {
    return JSON.parse(rawToString(raw)) as T;
  } catch {
    return null;
  }
};
