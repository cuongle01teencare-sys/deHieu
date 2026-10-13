import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { TransactionContext } from '../../../../shared/infrastructure/database/transaction-context.js';
import type { DbExecutor } from '../../../../shared/infrastructure/database/database.types.js';
import { DrizzleTaskSpecStore } from '../persistence/drizzle/drizzle-task-spec.store.js';

describe('DrizzleTaskSpecStore', () => {
  let client: PGlite;
  let store: DrizzleTaskSpecStore;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './drizzle' });
    store = new DrizzleTaskSpecStore(
      new TransactionContext(db as unknown as DbExecutor),
    );
  });

  afterEach(async () => {
    await client.close();
  });

  it('lưu, đổi desired, ghi đè, xóa', async () => {
    const spec = {
      taskId: 'poly-lol',
      kind: 'polymarket.descriptor',
      tenant: 'polymarket',
      params: { tagIds: [65], intervalMs: 30000 },
      runtime: { type: 'remote' as const, nodeId: 'n1' },
      persist: true,
    };
    await store.save({ spec, desired: 'running' });
    expect(await store.list()).toEqual([{ spec, desired: 'running' }]);

    await store.setDesired('poly-lol', 'stopped');
    expect((await store.list())[0]?.desired).toBe('stopped');

    await store.save({
      spec: { ...spec, params: { tagIds: [100780] } },
      desired: 'running',
    });
    expect(await store.list()).toEqual([
      { spec: { ...spec, params: { tagIds: [100780] } }, desired: 'running' },
    ]);

    await store.delete('poly-lol');
    await store.delete('poly-lol'); // không có cũng không lỗi
    expect(await store.list()).toEqual([]);
  });
});
