import { eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../../shared/infrastructure/database/transaction-context.js';
import type {
  PersistedTask,
  PersistedTaskDesired,
  TaskSpecStore,
} from '../../../application/task-spec.store.js';
import type { TaskRuntimeTarget } from '../../../domain/task-spec.js';
import { drizzlePersistedTasksTable as t } from './drizzle-persisted-task.schema.js';

export class DrizzleTaskSpecStore implements TaskSpecStore {
  constructor(private readonly _tx: TransactionContext) {}

  async list(): Promise<PersistedTask[]> {
    const rows = await this._tx.executor.select().from(t).orderBy(t.createdAt);
    return rows.map((r) => ({
      spec: {
        taskId: r.taskId,
        kind: r.kind,
        tenant: r.tenant,
        params: r.params,
        runtime: r.runtime as TaskRuntimeTarget,
        persist: true,
      },
      desired: r.desired === 'stopped' ? 'stopped' : 'running',
    }));
  }

  async save({ spec, desired }: PersistedTask): Promise<void> {
    const values = {
      taskId: spec.taskId,
      kind: spec.kind,
      tenant: spec.tenant,
      params: spec.params,
      runtime: spec.runtime,
      desired,
    };
    await this._tx.executor
      .insert(t)
      .values(values)
      .onConflictDoUpdate({
        target: t.taskId,
        set: { ...values, updatedAt: new Date() },
      });
  }

  async setDesired(
    taskId: string,
    desired: PersistedTaskDesired,
  ): Promise<void> {
    await this._tx.executor
      .update(t)
      .set({ desired, updatedAt: new Date() })
      .where(eq(t.taskId, taskId));
  }

  async delete(taskId: string): Promise<void> {
    await this._tx.executor.delete(t).where(eq(t.taskId, taskId));
  }
}
