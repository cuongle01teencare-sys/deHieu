import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { TransactionContext } from '../../../../../../shared/infrastructure/database/transaction-context.js';
import type { DbExecutor } from '../../../../../../shared/infrastructure/database/database.types.js';
import { DrizzleNotifyConfigRepository } from '../drizzle-notify-config.repository.js';
import { DrizzleArbitrageSettingsStore } from '../../../settings/drizzle-arbitrage-settings.store.js';
import { DEFAULT_ARBITRAGE_SETTINGS } from '../../../../application/arbitrage-settings.js';
import { drizzleAppSettingsTable } from '../drizzle-app-settings.schema.js';

describe('Postgres: hạng kèo, kênh thông báo, cấu hình arbitrage', () => {
  let client: PGlite;
  let tx: TransactionContext;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './drizzle' });
    tx = new TransactionContext(db as unknown as DbExecutor);
  });

  afterEach(async () => {
    await client.close();
  });

  it('lưu/đọc hạng và kênh; xóa hạng thì gỡ khỏi kênh', async () => {
    const repo = new DrizzleNotifyConfigRepository(tx);
    await repo.saveTier({
      id: 't1',
      name: 'VIP',
      minMargin: 0.05,
      maxMargin: null,
    });
    await repo.saveTier({
      id: 't0',
      name: 'Thường',
      minMargin: 0.02,
      maxMargin: 0.05,
    });
    await repo.saveChannel({
      id: 'c1',
      name: 'Telegram',
      enabled: true,
      tierIds: ['t1', 't0'],
      config: { type: 'telegram', botToken: 'tok', chatId: '-100' },
    });
    expect((await repo.listTiers()).map((t) => t.name)).toEqual([
      'Thường',
      'VIP',
    ]);
    expect(await repo.listChannels()).toEqual([
      {
        id: 'c1',
        name: 'Telegram',
        enabled: true,
        tierIds: ['t1', 't0'],
        config: { type: 'telegram', botToken: 'tok', chatId: '-100' },
      },
    ]);

    expect(await repo.deleteTier('t1')).toBe(true);
    expect(await repo.deleteTier('t1')).toBe(false);
    expect((await repo.listChannels())[0]?.tierIds).toEqual(['t0']);

    // ghi đè cùng id
    await repo.saveChannel({
      id: 'c1',
      name: 'Discord',
      enabled: false,
      tierIds: [],
      config: {
        type: 'discord',
        webhookUrl: 'https://discord.com/api/webhooks/1/x',
      },
    });
    expect(await repo.listChannels()).toEqual([
      expect.objectContaining({
        name: 'Discord',
        enabled: false,
        config: {
          type: 'discord',
          webhookUrl: 'https://discord.com/api/webhooks/1/x',
        },
      }),
    ]);
    expect(await repo.deleteChannel('c1')).toBe(true);
    expect(await repo.listChannels()).toEqual([]);
  });

  it('cấu hình arbitrage: lưu rồi nạp lại ở lần khởi động sau', async () => {
    const first = new DrizzleArbitrageSettingsStore(tx);
    expect(await first.load()).toEqual(DEFAULT_ARBITRAGE_SETTINGS);
    await first.update({
      minMargin: 0.035,
      marginStep: 0.02,
      marginDropStep: 0.005,
      enabledPhases: ['prematch'],
    });

    const afterRestart = new DrizzleArbitrageSettingsStore(tx);
    await afterRestart.load();
    expect(await afterRestart.get()).toEqual({
      ...DEFAULT_ARBITRAGE_SETTINGS,
      minMargin: 0.035,
      marginStep: 0.02,
      marginDropStep: 0.005,
      enabledPhases: ['prematch'],
    });
  });

  it('cấu hình cũ giữ bước tăng đã lưu và mặc định bước giảm là 1%', async () => {
    await tx.executor.insert(drizzleAppSettingsTable).values({
      key: 'arbitrage',
      value: { minMargin: 0.03, marginStep: 0.025 },
    });
    const store = new DrizzleArbitrageSettingsStore(tx);
    expect(await store.load()).toEqual({
      ...DEFAULT_ARBITRAGE_SETTINGS,
      minMargin: 0.03,
      marginStep: 0.025,
      marginDropStep: 0.01,
    });
    await store.update({ marginDropStep: 0.015 });
    expect(await new DrizzleArbitrageSettingsStore(tx).load()).toMatchObject({
      marginStep: 0.025,
      marginDropStep: 0.015,
    });
  });
});
