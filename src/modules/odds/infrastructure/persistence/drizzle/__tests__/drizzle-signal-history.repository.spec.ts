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
      team: 'alliance',
      odds: 2.08,
      ref: { t0: 'tA' },
    },
    { tenant: 'sptpub', side: 1, team: 'sinners', odds: 2.26, ref: { e: '1' } },
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
    });

    const cancelled = await repo.list({
      status: 'cancelled',
      limit: 10,
      offset: 0,
    });
    expect(cancelled.map((e) => e.signalId)).toEqual(['s2']);
  });

  it('khởi động lại: đóng các kèo còn active', async () => {
    await recorder.publish([new ArbitrageSignalIssued(signal('s3', 0.03))]);
    await recorder.flush();
    expect(await repo.abandonActive('app_restart', new Date())).toBe(1);
    expect(await repo.get('s3')).toMatchObject({
      status: 'abandoned',
      statusReason: 'app_restart',
    });
  });
});
