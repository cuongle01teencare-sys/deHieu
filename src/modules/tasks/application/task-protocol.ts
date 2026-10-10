import type { TaskSpec } from '../domain/task-spec.js';

export const TASK_PROTOCOL_VERSION = 1 as const;

/**
 * Vòng đời:
 *   app → init      task → ready
 *   app → start     task → started
 *                   task → data ...      (không ack, có seq để phát hiện mất/đến muộn)
 *   app → command   task → command_ack
 *   app → stop      task → stopped
 *   hai chiều: heartbeat · task → error {fatal}
 */
export type AppToTaskMessage =
  | { readonly type: 'init'; readonly spec: TaskSpec }
  | { readonly type: 'start' }
  | { readonly type: 'stop' }
  | {
      readonly type: 'command';
      readonly commandId: string;
      readonly name: string;
      readonly data: unknown;
    }
  | { readonly type: 'heartbeat'; readonly at: number };

export type TaskToAppMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'started' }
  | { readonly type: 'stopped' }
  | {
      readonly type: 'data';
      readonly seq: number;
      readonly sentAt: number;
      readonly channel?: string;
      readonly payload: unknown;
    }
  | {
      readonly type: 'command_ack';
      readonly commandId: string;
      readonly ok: boolean;
      readonly error?: string;
    }
  | { readonly type: 'heartbeat'; readonly at: number }
  | {
      readonly type: 'error';
      readonly fatal: boolean;
      readonly message: string;
    };

/** Phong bì chung cho mọi transport (parentPort, WebSocket...). */
export interface TaskEnvelope<TMsg> {
  readonly v: typeof TASK_PROTOCOL_VERSION;
  readonly taskId: string;
  readonly msg: TMsg;
}

/** Dữ liệu thô mà supervisor chuyển tiếp cho các context khác (vd odds/ACL). */
export interface TaskDataMessage {
  readonly taskId: string;
  readonly tenant: string;
  readonly kind: string;
  readonly seq: number;
  readonly sentAt: number;
  readonly receivedAt: number;
  readonly channel?: string;
  readonly payload: unknown;
}
