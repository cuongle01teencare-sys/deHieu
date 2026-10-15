import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { TransactionContext } from '../../../../../../shared/infrastructure/database/transaction-context.js';
import type { DbExecutor } from '../../../../../../shared/infrastructure/database/database.types.js';
import { DEFAULT_STAKE_PLAN } from '../../../../domain/stake-plan.js';
import {
  DEFAULT_RISK_LIMITS,
  DEFAULT_STRATEGY,
} from '../../../../domain/trader-profile.js';
import type { TradeAttempt } from '../../../../application/trade-attempt.js';
import {
  DrizzleTradeAttemptRepository,
  DrizzleTraderProfileRepository,
  DrizzleTradingAccountRepository,
  DrizzleTradingSettingsStore,
} from '../drizzle-trading.repositories.js';

const trade = (id: string, over: Partial<TradeAttempt> = {}): TradeAttempt => ({
  id,
  profileId: 'p1',
  mode: 'paper',
  signalId: `sig-${id}`,
  room: 'room:lol:a~b:match-winner',
  sport: 'lol',
  market: 'match-winner',
  teams: ['a', 'b'],
  phase: 'live',
  comboId: 'sptpub>0|polymarket>1',
  status: 'paper_filled',
  reason: null,
  signalMargin: 0.06,
  tierName: 'VIP',
  book: {
    tenant: 'sptpub',
    side: 0,
    pick: 'a',
    odds: 2,
    stake: 25,
    url: null,
    startsAt: null,
    tournament: null,
  },
  polymarket: null,
  totalCost: 45.6,
  payout: 50,
  profit: 4.4,
  netMargin: 0.0965,
  latencyMs: 120,
  detail: {},
  createdAt: Date.now(),
  csgoempireAccountId: null,
  polymarketAccountId: null,
  timing: null,
  legs: [],
  ...over,
});

describe('Postgres: auto trade', () => {
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

  it('tài khoản + profile: lưu/đọc/xóa', async () => {
    const accounts = new DrizzleTradingAccountRepository(tx);
    await accounts.save({
      id: 'a1',
      label: 'Poly',
      enabled: true,
      config: {
        venue: 'polymarket',
        walletAddress: `0x${'a'.repeat(40)}`,
        funderAddress: null,
      },
      secretCipher: 'v1:x:y:z',
    });
    await accounts.save({
      id: 'a2',
      label: 'Empire',
      enabled: false,
      config: { venue: 'csgoempire', browserProfile: 'empire-1' },
      secretCipher: null,
    });
    expect(await accounts.get('a1')).toMatchObject({
      config: { venue: 'polymarket', funderAddress: null },
      secretCipher: 'v1:x:y:z',
    });
    expect((await accounts.list()).map((a) => a.id)).toEqual(['a2', 'a1']);

    const profiles = new DrizzleTraderProfileRepository(tx);
    const p = {
      id: 'p1',
      name: 'A',
      enabled: true,
      mode: 'paper' as const,
      csgoempireAccountId: 'a2',
      polymarketAccountId: 'a1',
      stakePlan: { ...DEFAULT_STAKE_PLAN, overrides: { vip: { stake: 80 } } },
      strategy: DEFAULT_STRATEGY,
      risk: DEFAULT_RISK_LIMITS,
    };
    await profiles.save(p);
    expect(await profiles.get('p1')).toEqual(p);
    expect(await profiles.delete('p1')).toBe(true);
    expect(await accounts.delete('a1')).toBe(true);
    expect(await accounts.get('a1')).toBeNull();
  });

  it('cấu hình chung: mặc định giới hạn theo trận BẬT; lưu 0 = tắt', async () => {
    const s = new DrizzleTradingSettingsStore(tx);
    expect((await s.get()).matchExposureCapUsd).toBeGreaterThan(0);
    await s.save({ matchExposureCapUsd: 0 });
    expect(await s.get()).toEqual({ matchExposureCapUsd: 0 });
  });

  it('lệnh: bỏ trùng id, lọc + phân trang, thống kê theo lý do', async () => {
    const r = new DrizzleTradeAttemptRepository(tx);
    const t0 = Date.now() - 10_000;
    await r.record(trade('t1', { createdAt: t0 }));
    await r.record(trade('t1', { createdAt: t0, profit: 999 })); // worker gửi lại
    await r.record(
      trade('t2', {
        status: 'skipped',
        reason: 'NO_EDGE: giá tốt nhất 0.5',
        totalCost: 0,
        profit: 0,
        createdAt: t0 + 1,
      }),
    );
    await r.record(
      trade('t3', {
        status: 'skipped',
        reason: 'NO_EDGE: khác',
        totalCost: 0,
        profit: 0,
        createdAt: t0 + 2,
      }),
    );
    expect((await r.list({ limit: 10 })).map((x) => x.id)).toEqual([
      't3',
      't2',
      't1',
    ]);
    expect(
      (await r.list({ limit: 10, before: t0 + 2 })).map((x) => x.id),
    ).toEqual(['t2', 't1']);
    expect(
      (await r.list({ limit: 10, status: 'paper_filled' }))[0],
    ).toMatchObject({
      id: 't1',
      profit: 4.4,
      teams: ['a', 'b'],
    });
    expect(await r.stats({})).toMatchObject({
      attempts: 3,
      filled: 1,
      skipped: 2,
      cancelled: 0,
      errors: 0,
      totalCost: 45.6,
      profit: 4.4,
      skipReasons: { NO_EDGE: 2 },
    });
  });

  it('xóa lệnh: theo nhiều trạng thái, profile, mốc thời gian, một lệnh, toàn bộ (kèm chân)', async () => {
    const r = new DrizzleTradeAttemptRepository(tx);
    const t0 = Date.now() - 10_000;
    const leg = {
      venue: 'csgoempire',
      accountId: null,
      side: 0,
      pick: 'a',
      signalPrice: 2,
      requestedPrice: 2,
      requestedAmount: 25,
      filledAmount: 25,
      avgPrice: 2,
      fee: 0,
      cost: 25,
      status: 'simulated' as const,
      marketRef: null,
      orderRef: null,
      sentAt: null,
      ackedAt: null,
      filledAt: null,
      error: null,
      raw: {},
    };
    await r.record(trade('f1', { createdAt: t0, legs: [leg] }));
    await r.record(
      trade('f2', { profileId: 'p2', createdAt: t0 + 1, legs: [leg] }),
    );
    await r.record(trade('s1', { status: 'skipped', createdAt: t0 + 2 }));
    await r.record(trade('s2', { status: 'skipped', createdAt: t0 + 3 }));
    await r.record(trade('c1', { status: 'cancelled', createdAt: t0 + 4 }));
    await r.record(trade('e1', { status: 'error', createdAt: t0 + 5 }));
    const ids = async () => (await r.list({ limit: 50 })).map((x) => x.id);

    // skipped HOẶC error
    const f = { statuses: ['skipped', 'error'] as const };
    expect(await r.count(f)).toBe(3);
    expect(await r.purge(f)).toBe(3);
    expect(await ids()).toEqual(['c1', 'f2', 'f1']);

    // lệnh đã vào của một profile, chân lệnh bị xóa theo
    expect(await r.purge({ statuses: ['paper_filled'], profileId: 'p2' })).toBe(
      1,
    );
    expect(await r.get('f2')).toBeNull();
    expect((await r.get('f1'))?.legs).toHaveLength(1);

    // mốc thời gian
    expect(await r.purge({ before: t0 + 1 })).toBe(1);
    expect(await ids()).toEqual(['c1']);

    // một lệnh
    expect(await r.delete('c1')).toBe(true);
    expect(await r.delete('c1')).toBe(false);

    // toàn bộ
    await r.record(trade('x1', { legs: [leg] }));
    await r.record(trade('x2', { status: 'skipped' }));
    expect(await r.purge({})).toBe(2);
    expect(await r.count({})).toBe(0);
    const left = await client.query<{ n: number }>(
      'select count(*)::int as n from trade_legs',
    );
    expect(left.rows[0]?.n).toBe(0);
  });

  it('lệnh vào: lưu từng chân + mốc thời gian, đọc lại đủ', async () => {
    const r = new DrizzleTradeAttemptRepository(tx);
    const now = Date.now();
    const leg = {
      accountId: 'acc',
      side: 0,
      pick: 'a',
      fee: 0,
      status: 'simulated' as const,
      marketRef: null,
      orderRef: null,
      sentAt: null,
      ackedAt: null,
      filledAt: null,
      error: null,
      raw: {},
    };
    await r.record(
      trade('t9', {
        csgoempireAccountId: 'e1',
        polymarketAccountId: 'p1',
        timing: {
          signalIssuedAt: now - 120,
          receivedAt: now - 100,
          marketDataAt: now - 40,
          decidedAt: now - 30,
        },
        legs: [
          {
            ...leg,
            venue: 'csgoempire',
            signalPrice: 2,
            requestedPrice: 2,
            requestedAmount: 25,
            filledAmount: 25,
            avgPrice: 2,
            cost: 25,
          },
          {
            ...leg,
            venue: 'polymarket',
            side: 1,
            pick: 'b',
            signalPrice: 0.41,
            requestedPrice: 0.4,
            requestedAmount: 50,
            filledAmount: 50,
            avgPrice: 0.4,
            fee: 0.6,
            cost: 20.6,
            marketRef: 'tok',
          },
        ],
      }),
    );
    // gửi lại: không nhân đôi chân
    await r.record(trade('t9'));
    const got = await r.get('t9');
    expect(got).toMatchObject({
      csgoempireAccountId: 'e1',
      timing: { signalIssuedAt: now - 120, marketDataAt: now - 40 },
    });
    expect(got?.legs.map((l) => [l.venue, l.cost])).toEqual([
      ['csgoempire', 25],
      ['polymarket', 20.6],
    ]);
    expect((await r.list({ limit: 5 }))[0]?.legs).toHaveLength(2);
    expect(await r.get('missing')).toBeNull();
  });
});
