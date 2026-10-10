/**
 * Bus sự kiện VẬN HÀNH (khác domain event): các module báo "trạng thái vừa đổi"
 * để admin theo dõi/cảnh báo/ghi audit. Module phát không biết ai nghe.
 *
 * topic dùng để admin subscribe: tasks | nodes | consumers | signals | odds | alerts | audit | room:{id}
 */
export type OpsSeverity = 'info' | 'warning' | 'critical';

interface Base<TType extends string, TData> {
  readonly type: TType;
  readonly topic: string;
  readonly at: number;
  readonly data: TData;
}

export type OpsEvent =
  | Base<
      'task.state',
      {
        taskId: string;
        kind: string;
        tenant: string;
        from: string;
        to: string;
        reason?: string;
      }
    >
  | Base<
      'task.error',
      { taskId: string; kind: string; message: string; fatal: boolean }
    >
  | Base<'task.removed', { taskId: string; kind: string }>
  | Base<'node.connected', { nodeId: string }>
  | Base<'node.disconnected', { nodeId: string; affectedTasks: string[] }>
  | Base<'consumer.connected', { consumerId: string; role: string }>
  | Base<'consumer.disconnected', { consumerId: string; role: string }>
  | Base<
      'signal.issued' | 'signal.refreshed',
      {
        signalId: string;
        room: string;
        comboId: string;
        phase: string;
        margin: number;
        supersedes?: string | null;
      }
    >
  | Base<
      'signal.cancelled',
      { signalId: string; room: string; comboId: string; reason: string }
    >
  /** Mọi thay đổi dòng kèo — CHỈ gửi cho ai subscribe đúng room (topic room:{id}). */
  | Base<
      'odds.changed',
      {
        room: string;
        tenant: string;
        phase: string;
        removed: boolean;
        odds?: readonly [number, number];
        status?: string;
        reason?: string;
      }
    >
  /** Chuyển trạng thái dòng kèo: xuất hiện / open↔suspended / bị gỡ. */
  | Base<
      'odds.transition',
      {
        room: string;
        tenant: string;
        phase: string;
        from: string | null; // null = mới xuất hiện
        to: string; // open | suspended | removed
        reason?: string;
      }
    >
  | Base<
      'incident.opened' | 'incident.resolved' | 'incident.acknowledged',
      {
        key: string;
        kind: string;
        severity: OpsSeverity;
        title: string;
        message: string;
        by?: string;
      }
    >
  | Base<
      'audit.recorded',
      {
        principalId: string | null;
        method: string;
        route: string;
        ok: boolean;
        status: number;
      }
    >;

export type OpsEventType = OpsEvent['type'];
export type OpsListener = (event: OpsEvent) => void;

export interface OpsEventBus {
  publish(event: OpsEvent): void;
  /** Trả về hàm hủy đăng ký. */
  subscribe(listener: OpsListener): () => void;
}

export const OPS_EVENT_BUS = Symbol('OPS_EVENT_BUS');
