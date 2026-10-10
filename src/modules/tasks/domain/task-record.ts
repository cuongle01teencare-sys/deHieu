import type { TaskSpec } from './task-spec.js';
import type { TaskState } from './task-state.js';

/** Bản ghi quản lý publisher — admin xem được toàn bộ thông tin này. */
export interface TaskRecord {
  readonly spec: TaskSpec;
  readonly state: TaskState;
  readonly consecutiveFailures: number;
  readonly totalRestarts: number;
  readonly lastHeartbeatAt: number | null;
  readonly lastDataAt: number | null;
  readonly lastSeq: number | null;
  readonly lastError: string | null;
  readonly updatedAt: number;
}
