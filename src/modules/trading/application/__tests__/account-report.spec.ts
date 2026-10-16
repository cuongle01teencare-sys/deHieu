import { describe, expect, it, vi } from 'vitest';
import type { TradeAttempt } from '../trade-attempt.js';
import {
  computeSettlement,
  SettlementAdmin,
  winnerFromPolyPrice,
  type TradeSettlement,
} from '../trade-settlement.js';
import { buildAccountReport, periodKeys } from '../account-report.js';

const trade = (id: string, over: Partial<TradeAttempt> = {}): TradeAttempt => ({
  id,
  profileId: 'p1',
  mode: 'live',
  signalId: `sig-${id}`,
  room: 'room:lol:a~b:match-winner',
  sport: 'lol',
  market: 'match-winner',
  teams: ['a', 'b'],
  phase: 'live',
  comboId: 'sptpub>0|polymarket>1',
  status: 'filled',
  reason: null,
  signalMargin: 0.06,
  tierName: 'VIP',
  // 25$ ở odds 2.0 bên csgoempire + 50 share giá 0.4 (+0.5 phí) bên Polymarket
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
  polymarket: {
    tenant: 'polymarket',
    side: 1,
    pick: 'b',
    odds: 2.5,
    url: null,
    startsAt: null,
    tournament: null,
    tokenId: 'tok',
    shares: 50,
    avgPrice: 0.4,
    fee: 0.5,
    cost: 20.5,
  },
  totalCost: 45.5,
  payout: 50,
  profit: 4.5,
  netMargin: 0.0989,
  latencyMs: 10,
  detail: {},
  createdAt: Date.UTC(2026, 9, 15, 20, 0), // 16/10 03:00 giờ Việt Nam
  csgoempireAccountId: 'e1',
  polymarketAccountId: 'pm1',
  timing: null,
  legs: [],
  ...over,
});

const settled = (
  t: TradeAttempt,
  winner: 'polymarket' | 'csgoempire' | 'void',
): TradeSettlement => ({
  attemptId: t.id,
  profileId: t.profileId,
  mode: t.mode,
  ...computeSettlement(t, winner),
  source: 'polymarket',
  by: null,
  resolvedAt: 0,
});

describe('kết quả lệnh', () => {
  it('Polymarket thắng: chân Poly lãi, chân csgoempire lỗ, cả cặp vẫn lãi', () => {
    expect(computeSettlement(trade('a'), 'polymarket')).toEqual({
      winner: 'polymarket',
      polyPrice: 1,
      bookResult: 'lost',
      bookPnl: -25,
      polyPnl: 29.5,
      pnl: 4.5,
    });
  });
  it('csgoempire thắng: ngược lại, cả cặp vẫn lãi', () => {
    expect(computeSettlement(trade('a'), 'csgoempire')).toMatchObject({
      bookPnl: 25,
      polyPnl: -20.5,
      pnl: 4.5,
    });
  });
  it('dùng số khớp thật trong chân lệnh khi có', () => {
    const t = trade('a', {
      legs: [
        {
          venue: 'csgoempire',
          accountId: 'e1',
          side: 0,
          pick: 'a',
          signalPrice: 2,
          requestedPrice: 2,
          requestedAmount: 25,
          filledAmount: 20,
          avgPrice: 2.1,
          fee: 0,
          cost: 20,
          status: 'filled',
          marketRef: null,
          orderRef: null,
          sentAt: null,
          ackedAt: null,
          filledAt: null,
          error: null,
          raw: {},
        },
      ],
    });
    expect(computeSettlement(t, 'csgoempire').bookPnl).toBeCloseTo(22);
  });
  it('giá resolve → cửa thắng', () => {
    expect(winnerFromPolyPrice(1)).toBe('polymarket');
    expect(winnerFromPolyPrice(0)).toBe('csgoempire');
    expect(winnerFromPolyPrice(0.5)).toBe('void');
  });
  it('đối soát tự động chỉ ghi lệnh có market đã resolve', async () => {
    const save = vi.fn(() => Promise.resolve());
    const admin = new SettlementAdmin(
      {
        pendingSettlement: () =>
          Promise.resolve([
            trade('a'),
            trade('b', {
              polymarket: { ...trade('b').polymarket!, tokenId: 'open' },
            }),
          ]),
        saveSettlement: save,
        getSettlement: vi.fn(),
        deleteSettlement: vi.fn(),
        accountTrades: vi.fn(),
      },
      { get: vi.fn() } as never,
      { resolve: () => Promise.resolve(new Map([['tok', 0]])) },
    );
    expect(await admin.run()).toEqual({ checked: 2, settled: 1 });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'a',
        winner: 'csgoempire',
        source: 'polymarket',
        pnl: 4.5,
      }),
    );
  });
});

describe('báo cáo tài khoản', () => {
  it('kỳ theo giờ Việt Nam: ngày, tuần (thứ Hai), tháng, quý, năm', () => {
    expect(
      periodKeys(Date.UTC(2026, 9, 15, 20, 0), 'Asia/Ho_Chi_Minh'),
    ).toEqual({
      day: '2026-10-16',
      week: '2026-10-12',
      month: '2026-10',
      quarter: '2026-Q4',
      year: '2026',
    });
  });

  it('lãi chân tách khỏi lãi cả cặp; giấy đối chiếu so với lệnh thật', () => {
    const live = trade('L');
    const live2 = trade('L2', { createdAt: Date.UTC(2026, 6, 1) });
    const shadow = trade('L:shadow', {
      mode: 'shadow',
      status: 'paper_filled',
      profit: 5,
      detail: { shadowOf: 'L' },
    });
    // giấy vào được nhưng lệnh thật không khớp (không có trong danh sách)
    const lonely = trade('X:shadow', {
      mode: 'shadow',
      status: 'paper_filled',
      detail: { shadowOf: 'X' },
    });
    const r = buildAccountReport({
      account: { id: 'pm1', label: 'Poly 1', venue: 'polymarket' },
      rows: [
        { trade: live, settlement: settled(live, 'csgoempire') },
        { trade: live2, settlement: null },
        { trade: shadow, settlement: settled(shadow, 'csgoempire') },
        { trade: lonely, settlement: null },
      ],
      modes: ['live'],
      timeZone: 'Asia/Ho_Chi_Minh',
      truncated: false,
    });
    expect(r.totals).toMatchObject({
      trades: 2,
      settled: 1,
      legPnl: -20.5,
      pairPnl: 4.5,
      legLosses: 1,
      expected: 9,
    });
    expect(r.series.quarter.map((b) => b.key)).toEqual(['2026-Q3', '2026-Q4']);
    expect(r.trades[0]).toMatchObject({
      id: 'L',
      leg: { venue: 'polymarket', result: 'lost', pnl: -20.5 },
      other: { venue: 'csgoempire', result: 'won', pnl: 25 },
      pairPnl: 4.5,
      pairedWith: 'L:shadow',
    });
    expect(r.compare.paired).toEqual({
      count: 1,
      liveExpected: 4.5,
      shadowExpected: 5,
      bothSettled: 1,
      livePnl: 4.5,
      shadowPnl: 4.5,
      shadowOnly: 1,
    });
    expect(r.compare.byMode.shadow.trades).toBe(2);
  });
});
