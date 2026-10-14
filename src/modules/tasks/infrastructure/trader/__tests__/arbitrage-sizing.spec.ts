import { describe, expect, it } from 'vitest';
import {
  depthSummary,
  NO_FEE,
  sizeArbitrage,
  takerFeePerShare,
  type SizingInput,
} from '../arbitrage-sizing.js';

const FEE = { enabled: true, rate: 0.05, exponent: 1 };
const base: SizingInput = {
  bookOdds: 2,
  asks: [
    { price: 0.49, size: 1000 },
    { price: 0.4, size: 50 },
    { price: 0.45, size: 100 },
  ],
  fee: FEE,
  targetStake: 100,
  minStake: 10,
  minNetMargin: 0.01,
  minShares: 5,
  budget: Number.POSITIVE_INFINITY,
};

describe('takerFeePerShare', () => {
  it('rate · p·(1−p) mỗi share; tắt phí = 0', () => {
    expect(takerFeePerShare(0.4, FEE)).toBeCloseTo(0.012, 9);
    expect(takerFeePerShare(0.4, NO_FEE)).toBe(0);
  });
});

describe('sizeArbitrage', () => {
  it('ăn các mức còn lãi sau phí, dừng ở mức hết lãi; cân hai chân theo odds', () => {
    const r = sizeArbitrage(base);
    if (!r.ok) throw new Error(r.reason);
    // 0.40 (lãi 9.6%) và 0.45 (3.9%) ăn hết; 0.49 sau phí lỗ → dừng
    expect(r.levels.map((l) => [l.price, l.shares])).toEqual([
      [0.4, 50],
      [0.45, 100],
    ]);
    expect(r.limitedBy).toBe('depth');
    expect(r.shares).toBe(150);
    expect(r.stake).toBe(75); // 150 share / odds 2
    expect(r.polyCost).toBeCloseTo(66.8375, 6);
    expect(r.totalCost).toBeCloseTo(141.8375, 6);
    expect(r.payout).toBe(150);
    expect(r.profit).toBeCloseTo(8.1625, 6);
  });

  it('dừng đúng tiền mục tiêu', () => {
    const r = sizeArbitrage({ ...base, targetStake: 25 });
    if (!r.ok) throw new Error(r.reason);
    expect(r).toMatchObject({ shares: 50, stake: 25, limitedBy: 'stake' });
    expect(r.profit).toBeCloseTo(4.4, 6);
  });

  it('giới hạn theo ngân sách còn lại (tổng theo trận)', () => {
    const r = sizeArbitrage({ ...base, budget: 30 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.limitedBy).toBe('budget');
    expect(r.totalCost).toBeLessThanOrEqual(30);
    expect(r.shares).toBeCloseTo(32.89, 6);
  });

  it('ngân sách không đủ tiền tối thiểu → BUDGET_EXHAUSTED', () => {
    const r = sizeArbitrage({ ...base, budget: 5 });
    expect(r).toMatchObject({ ok: false, reason: 'BUDGET_EXHAUSTED' });
  });

  it('giá tốt nhất đã hết lãi → NO_EDGE', () => {
    const r = sizeArbitrage({ ...base, asks: [{ price: 0.49, size: 1000 }] });
    expect(r).toMatchObject({ ok: false, reason: 'NO_EDGE' });
  });

  it('sổ lệnh mỏng hơn tiền tối thiểu → INSUFFICIENT_DEPTH', () => {
    const r = sizeArbitrage({
      ...base,
      asks: [{ price: 0.4, size: 10 }],
      minStake: 50,
    });
    expect(r).toMatchObject({ ok: false, reason: 'INSUFFICIENT_DEPTH' });
  });

  it('dưới số share tối thiểu của market → BELOW_MIN_ORDER', () => {
    const r = sizeArbitrage({
      ...base,
      asks: [{ price: 0.4, size: 3 }],
      minStake: 0,
    });
    expect(r).toMatchObject({ ok: false, reason: 'BELOW_MIN_ORDER' });
  });
});

describe('depthSummary', () => {
  it('liệt kê mức giá kèm lãi ròng; cộng share/tiền ở các mức còn đạt ngưỡng', () => {
    const d = depthSummary(base);
    expect(d.levels.map((l) => [l.price, l.ok])).toEqual([
      [0.4, true],
      [0.45, true],
      [0.49, false],
    ]);
    expect(d.maxPrice).toBe(0.45);
    expect(d.sharesAtEdge).toBe(150);
    expect(d.maxStakeAtEdge).toBe(75);
    expect(d.targetShares).toBe(200);
    expect(d.levels[0].netMargin).toBeCloseTo(1 / 0.912 - 1, 6);
  });
});
