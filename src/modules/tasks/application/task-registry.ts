import type { TaskRecord } from '../domain/task-record.js';

/** Port: nơi lưu trạng thái các publisher để xem/điều khiển qua API. */
export interface TaskRegistry {
  get(taskId: string): Promise<TaskRecord | null>;
  list(): Promise<TaskRecord[]>;
  save(record: TaskRecord): Promise<void>;
  delete(taskId: string): Promise<void>;
}

export const TASK_REGISTRY = Symbol('TASK_REGISTRY');
