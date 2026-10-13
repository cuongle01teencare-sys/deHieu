import type {
  PersistedTask,
  PersistedTaskDesired,
  TaskSpecStore,
} from '../../application/task-spec.store.js';

/** Dùng cho test / chạy không có Postgres: mất khi restart. */
export class InMemoryTaskSpecStore implements TaskSpecStore {
  private readonly _tasks = new Map<string, PersistedTask>();

  list() {
    return Promise.resolve([...this._tasks.values()]);
  }

  save(task: PersistedTask) {
    this._tasks.set(task.spec.taskId, task);
    return Promise.resolve();
  }

  setDesired(taskId: string, desired: PersistedTaskDesired) {
    const cur = this._tasks.get(taskId);
    if (cur) this._tasks.set(taskId, { ...cur, desired });
    return Promise.resolve();
  }

  delete(taskId: string) {
    this._tasks.delete(taskId);
    return Promise.resolve();
  }
}
