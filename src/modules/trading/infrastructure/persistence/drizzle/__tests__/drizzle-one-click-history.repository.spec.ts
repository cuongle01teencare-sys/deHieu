import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TransactionContext } from '../../../../../../shared/infrastructure/database/transaction-context.js';
import type { DbExecutor } from '../../../../../../shared/infrastructure/database/database.types.js';
import type { OneClickCandidate } from '../../../../application/one-click-board.js';
import type { TradeAttempt } from '../../../../application/trade-attempt.js';
import { DrizzleOneClickHistoryRepository } from '../drizzle-one-click-history.repository.js';

const cand = (
  signalId: string,
  at: number,
  teams: [string, string] = ['bushido', 'johnny'],
): OneClickCandidate => ({
  profileId: 'p1',
  signalId,
  expiresAt: at + 300_000,
  updatedAt: at,
  analysis: {
    id: `p1:${signalId}`,
    profileId: 'p1',
    mode: 'paper',
    signalId,
    room: `room:cs2:${teams.join('~')}:game-winner`,
    sport: 'cs2',
    market: 'game-winner',
    teams,
    phase: 'prematch',
    comboId: 'sptpub>0|polymarket>1',
    status: 'paper_filled',
    reason: 'ONE_CLICK: giá bán thấp nhất 0.55 ≥ 0.5',
    signalMargin: 0.0491,
    tierName: 'Phổ thông',
    book: null,
    polymarket: null,
    totalCost: 48,
    payout: 50,
    profit: 2,
    netMargin: 0.04,
    latencyMs: 3,
    detail: { minAsk: 0.55, oneClickMinPrice: 0.5 },
    createdAt: at,
    csgoempireAccountId: null,
    polymarketAccountId: null,
    timing: null,
    legs: [],
  } satisfies TradeAttempt,
});

describe('Postgres: lịch sử On click', () => {
  let client: PGlite;
  let repo: DrizzleOneClickHistoryRepository;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: './drizzle' });
    repo = new DrizzleOneClickHistoryRepository(
      new TransactionContext(db as unknown as DbExecutor),
    );
  });

  afterEach(async () => {
    await client.close();
  });

  it('lên bảng, cập nhật, rời bảng; lọc theo kết quả / mã kèo / tên đội; mở lại khi quay lại bảng', async () => {
    expect(await repo.upsert(cand('0af4d189-1', 1_000))).toEqual({
      state: 'none',
    });
    expect(await repo.upsert(cand('0af4d189-1', 2_000))).toEqual({
      state: 'open',
    }); // làm mới
    await repo.upsert(cand('s-2', 3_000, ['navi', 'faze']));
    await repo.upsert(cand('s-3', 4_000));
    await repo.end(
      'p1',
      '0af4d189-1',
      'cancelled:margin_decreased',
      null,
      new Date(5_000),
    );
    await repo.end(
      'p1',
      's-2',
      'manual:paper_filled',
      'admin',
      new Date(6_000),
    );

    const all = await repo.list({ profileId: 'p1', limit: 10, offset: 0 });
    expect(all.total).toBe(3);
    expect(all.items.map((e) => e.signalId)).toEqual([
      's-3',
      's-2',
      '0af4d189-1',
    ]);
    expect(all.items[2]).toMatchObject({
      updates: 2,
      firstAt: 1_000,
      lastAt: 2_000,
      endedAt: 5_000,
      endReason: 'cancelled:margin_decreased',
      minAsk: 0.55,
      threshold: 0.5,
      analysis: { signalId: '0af4d189-1' },
    });
    const ids = async (q: Record<string, string>) =>
      (await repo.list({ limit: 10, offset: 0, ...q })).items.map(
        (e) => e.signalId,
      );
    expect(await ids({ outcome: 'open' })).toEqual(['s-3']);
    expect(await ids({ outcome: 'manual' })).toEqual(['s-2']);
    expect(await ids({ outcome: 'cancelled' })).toEqual(['0af4d189-1']);
    expect(await ids({ q: '0AF4' })).toEqual(['0af4d189-1']);
    expect(await ids({ q: 'navi' })).toEqual(['s-2']);

    // app khởi động lại → đóng dòng đang mở; trader gửi lại → mở lại
    expect(await repo.endAllOpen('app_restart', new Date(7_000))).toBe(1);
    expect(await ids({ outcome: 'other' })).toEqual(['s-3']);
    expect(await repo.upsert(cand('s-3', 8_000))).toEqual({
      state: 'ended',
      reason: 'app_restart',
    });
    expect(await ids({ outcome: 'open' })).toEqual(['s-3']);
    // đã rời bảng thì end lần nữa không ghi đè
    await repo.end('p1', 's-2', 'expired', null, new Date(9_000));
    expect(
      (await repo.list({ q: 's-2', limit: 1, offset: 0 })).items[0],
    ).toMatchObject({
      endReason: 'manual:paper_filled',
      enteredBy: 'admin',
    });
  });
});
