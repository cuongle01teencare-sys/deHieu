import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { TransactionContext } from '../../../../../../shared/infrastructure/database/transaction-context.js';
import { SignalHistoryRecorder } from '../../../../application/signal-history.recorder.js';
import type { ArbitrageSignal } from '../../../../domain/arbitrage-signal.js';
import {
  ArbitrageSignalCancelled,
  ArbitrageSignalIssued,
  ArbitrageSignalRefreshed,
} from '../../../../domain/events/arbitrage-signal.events.js';
import { DrizzleSignalHistoryRepository } from '../drizzle-signal-history.repository.js';

const signal = (id: string, margin: number): ArbitrageSignal => ({
  signalId: id,
  room: 'room:cs2:alliance~sinners:game-winner',
  sport: 'cs2',
  market: 'game-winner',
  teams: ['alliance', 'sinners'],
  comboId: 'polymarket>0|sptpub>1',
  phase: 'live',
  margin,
  legs: [
    {
      tenant: 'polymarket',
      side: 0,
      pick: 'alliance',
      odds: 2.08,
      ref: { t0: 'tA' },
      startsAt: 1_000,
    },
    {
      tenant: 'sptpub',
      side: 1,
      pick: 'sinners',
      odds: 2.26,
      ref: { e: '1' },
      startsAt: 1_000,
    },
  ],
  issuedAt: 1_000,
  expiresAt: 31_000,
});

describe('Lịch sử kèo (recorder + DrizzleSignalHistoryRepository)', () => {
  let client: PGlite;
  let repo: DrizzleSignalHistoryRepository;
  let recorder: SignalHistoryRecorder;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './drizzle' });
    repo = new DrizzleSignalHistoryRepository({
      executor: db,
    } as unknown as TransactionContext);
    recorder = new SignalHistoryRecorder(repo, (e) => {
      throw e;
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('ghi vòng đời: phát → làm mới → bị ghi đè → kèo mới bị hủy kèm lý do', async () => {
    await recorder.publish([new ArbitrageSignalIssued(signal('s1', 0.03))]);
    await recorder.publish([
      new ArbitrageSignalRefreshed({
        ...signal('s1', 0.03),
        expiresAt: 61_000,
      }),
    ]);
    await recorder.publish([
      new ArbitrageSignalIssued(signal('s2', 0.05), 's1'),
    ]);
    await recorder.publish([
      new ArbitrageSignalCancelled(
        's2',
        'room:cs2:alliance~sinners:game-winner',
        'polymarket>0|sptpub>1',
        'phase_disabled',
        {
          startTimes: [
            { tenant: 'polymarket', startsAt: 1_000 },
            { tenant: 'sptpub', startsAt: 2_701_000 },
          ],
          startDriftMs: 2_700_000,
          maxStartDriftMs: 1_200_000,
        },
      ),
    ]);
    await recorder.flush();

    const s1 = await repo.get('s1');
    expect(s1).toMatchObject({
      status: 'superseded',
      supersededBy: 's2',
      refreshCount: 1,
      phase: 'live',
    });
    expect(s1?.legs[0]).toMatchObject({
      tenant: 'polymarket',
      ref: { t0: 'tA' },
    });
    expect(await repo.get('s2')).toMatchObject({
      status: 'cancelled',
      statusReason: 'phase_disabled',
      closeDetail: { startDriftMs: 2_700_000, maxStartDriftMs: 1_200_000 },
    });
    expect((await repo.get('s2'))?.legs[0].startsAt).toBe(1_000);
    expect((await repo.get('s1'))?.closeDetail).toBeNull();

    const cancelled = await repo.list({
      status: 'cancelled',
      limit: 10,
      offset: 0,
    });
    expect(cancelled.map((e) => e.signalId)).toEqual(['s2']);
  });

  it.each(['better_opportunity', 'margin_decreased'] as const)(
    'thay kèo: lưu trạng thái cancelled và lý do %s của kèo cũ',
    async (reason) => {
      const old = signal('s1', reason === 'better_opportunity' ? 0.05 : 0.09);
      const next = signal('s2', reason === 'better_opportunity' ? 0.09 : 0.05);
      await recorder.publish([new ArbitrageSignalIssued(old)]);
      await recorder.publish([
        new ArbitrageSignalCancelled(
          old.signalId,
          old.room,
          old.comboId,
          reason,
        ),
        new ArbitrageSignalIssued(next),
      ]);
      await recorder.flush();
      expect(await repo.get('s1')).toMatchObject({
        status: 'cancelled',
        statusReason: reason,
      });
      expect(await repo.get('s2')).toMatchObject({
        status: 'active',
        margin: next.margin,
      });
    },
  );

  it('khởi động lại: đóng các kèo còn active', async () => {
    await recorder.publish([new ArbitrageSignalIssued(signal('s3', 0.03))]);
    await recorder.flush();
    expect(await repo.abandonActive('app_restart', new Date())).toBe(1);
    expect(await repo.get('s3')).toMatchObject({
      status: 'abandoned',
      statusReason: 'app_restart',
    });
  });

  it('giữ lại: chỉ xóa kèo đã kết thúc phát trước mốc, không đụng kèo active', async () => {
    await recorder.publish([new ArbitrageSignalIssued(signal('old-1', 0.03))]);
    await recorder.publish([new ArbitrageSignalIssued(signal('old-2', 0.03))]);
    await recorder.publish([new ArbitrageSignalIssued(signal('live', 0.03))]);
    await recorder.flush();
    await repo.close('old-1', 'cancelled', 'below_threshold', new Date(2_000));
    await repo.close('old-2', 'superseded', null, new Date(2_000), 'live');
    const before = new Date(5_000); // cả ba phát lúc 1_000
    expect(await repo.purgeOlderThan(before, 1)).toBe(1);
    expect(await repo.purgeOlderThan(before, 10)).toBe(1);
    expect(await repo.purgeOlderThan(before, 10)).toBe(0);
    expect(await repo.get('live')).toMatchObject({ status: 'active' });
  });

  it('xóa tay: theo trạng thái, không bao giờ xóa kèo đang sống; xóa từng kèo', async () => {
    for (const id of ['p-live', 'p-c', 'p-s', 'p-a'])
      await recorder.publish([new ArbitrageSignalIssued(signal(id, 0.03))]);
    await recorder.flush();
    await repo.close('p-c', 'cancelled', 'below_threshold', new Date(2_000));
    await repo.close('p-s', 'superseded', null, new Date(2_000), 'p-live');
    await repo.close('p-a', 'abandoned', 'app_restart', new Date(2_000));
    const before = new Date(Date.now() + 1);
    expect(await repo.countPurgeable({ before })).toBe(3);
    expect(await repo.countPurgeable({ before, statuses: ['cancelled'] })).toBe(
      1,
    );
    expect(
      await repo.purge({ before, statuses: ['cancelled', 'superseded'] }, 10),
    ).toBe(2);
    expect(await repo.get('p-a')).toMatchObject({ status: 'abandoned' });
    expect(await repo.deleteOne('p-live')).toBe('ACTIVE');
    expect(await repo.deleteOne('p-a')).toBe('DELETED');
    expect(await repo.deleteOne('p-a')).toBe('NOT_FOUND');
    expect(await repo.get('p-live')).toMatchObject({ status: 'active' });
  });

  it('đếm theo bộ lọc (cho phân trang)', async () => {
    await recorder.publish([new ArbitrageSignalIssued(signal('c1', 0.03))]);
    await recorder.publish([new ArbitrageSignalIssued(signal('c2', 0.03))]);
    await recorder.flush();
    await repo.close('c1', 'cancelled', 'below_threshold', new Date(2_000));
    expect(await repo.count({ limit: 1, offset: 0 })).toBe(2);
    expect(await repo.count({ status: 'cancelled', limit: 1, offset: 0 })).toBe(
      1,
    );
  });
});
