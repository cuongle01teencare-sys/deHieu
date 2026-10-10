import type { TaskRegistry } from '../../application/task-registry.js';
import type { TaskRecord } from '../../domain/task-record.js';

/** Đủ cho một instance app. Cần nhiều instance → thay bằng adapter Redis. */
export class InMemoryTaskRegistry implements TaskRegistry {
  private readonly _records = new Map<string, TaskRecord>();

  get(taskId: string) {
    return Promise.resolve(this._records.get(taskId) ?? null);
  }

  list() {
    return Promise.resolve([...this._records.values()]);
  }

  save(record: TaskRecord) {
    this._records.set(record.spec.taskId, record);
    return Promise.resolve();
  }

  delete(taskId: string) {
    this._records.delete(taskId);
    return Promise.resolve();
  }
}
