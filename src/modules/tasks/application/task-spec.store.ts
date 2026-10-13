import type { TaskSpec } from '../domain/task-spec.js';

/** Trạng thái admin mong muốn của task lưu bền: chạy lại khi khởi động hay giữ nguyên đã dừng. */
export type PersistedTaskDesired = 'running' | 'stopped';

export interface PersistedTask {
  readonly spec: TaskSpec;
  readonly desired: PersistedTaskDesired;
}

/**
 * Port: nơi lưu bền các task có `persist = true` (Postgres).
 * Khởi động app → đọc lại, task `running` tự chạy, task `stopped` hiện ở trạng thái STOPPED.
 */
export interface TaskSpecStore {
  list(): Promise<PersistedTask[]>;
  /** Thêm hoặc ghi đè theo taskId. */
  save(task: PersistedTask): Promise<void>;
  setDesired(taskId: string, desired: PersistedTaskDesired): Promise<void>;
  /** Không có cũng không lỗi. */
  delete(taskId: string): Promise<void>;
}

export const TASK_SPEC_STORE = Symbol('TASK_SPEC_STORE');
