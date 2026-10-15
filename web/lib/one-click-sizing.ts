import type { TradeAttempt, TradeDetail } from './trading-types';

/**
 * Bản sao (trình duyệt) của bộ chia tiền taker của trader (`arbitrage-sizing.ts`), để trang On click
 * tính lại ngay khi người nhập tiền mục tiêu. Tính trên sổ lệnh lúc trader cập nhật kèo (tối đa 10
 * mức rẻ nhất) — chỉ là ước tính; bấm vào lệnh thì trader đọc lại sổ thật và tính lại.
 *   chân csgoempire cược S ở odds O ⇒ cần N = S·O share Polymarket; mua từ mức rẻ nhất, mức nào
 *   lãi ròng (sau phí) dưới ngưỡng thì dừng ⇒ vào ít hơn tiền mục tiêu.
 */
export type SizingPreview =
  | {
      ok: true;
      stake: number;
      shares: number;
      avgPrice: number;
      fee: number;
      polyCost: number;
      totalCost: number;
      profit: number;
      netMargin: number;
      levels: { price: number; shares: number }[];
      limitedBy: 'stake' | 'depth' | 'budget';
    }
  | { ok: false; reason: 'NO_EDGE' | 'INSUFFICIENT_DEPTH' | 'BUDGET_EXHAUSTED' | 'BELOW_MIN_ORDER' | 'NO_DATA'; detail: string };

const floorTo = (n: number, step: number) => Math.floor(n / step + 1e-9) * step;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function previewSizing(a: TradeAttempt, targetStake: number): SizingPreview {
  const d = a.detail as TradeDetail;
  const odds = a.book?.odds;
  const asksRaw = d.depth?.levels;
  if (!odds || !asksRaw?.length || !d.sizing) return { ok: false, reason: 'NO_DATA', detail: 'thiếu sổ lệnh trong phân tích' };
  const fee = d.fee ?? { enabled: false, rate: 0, exponent: 1 };
  const feeOf = (p: number) => (fee.enabled && fee.rate > 0 ? fee.rate * (p * (1 - p)) ** fee.exponent : 0);
  const step = 0.01;
  const bookUnit = 1 / odds;
  const maxUnitCost = 1 / (1 + d.sizing.minNetMargin);
  const minStake = Math.min(d.sizing.minStake, targetStake);
  const asks = asksRaw.filter((l) => l.price > 0 && l.price < 1 && l.size > 0).sort((x, y) => x.price - y.price);
  const best = asks[0];
  if (!best) return { ok: false, reason: 'INSUFFICIENT_DEPTH', detail: 'sổ lệnh trống' };
  if (bookUnit + best.price + feeOf(best.price) > maxUnitCost) return { ok: false, reason: 'NO_EDGE', detail: `giá tốt nhất ${best.price} đã hết lãi` };

  const targetShares = targetStake * odds;
  let shares = 0;
  let budget = d.budget ?? Infinity;
  let limitedBy: 'stake' | 'depth' | 'budget' = 'depth';
  const levels: { price: number; shares: number; fee: number }[] = [];
  for (const l of asks) {
    const f = feeOf(l.price);
    const unit = bookUnit + l.price + f;
    if (unit > maxUnitCost) break;
    let take = Math.min(l.size, targetShares - shares);
    if (take === targetShares - shares) limitedBy = 'stake';
    if (take * unit > budget) {
      take = budget / unit;
      limitedBy = 'budget';
    }
    take = floorTo(take, step);
    if (take <= 0) break;
    levels.push({ price: l.price, shares: take, fee: r6(take * f) });
    shares += take;
    budget -= take * unit;
    if (limitedBy !== 'depth' || shares >= targetShares - step / 2) break;
  }
  shares = r6(shares);
  const stake = r6(shares * bookUnit);
  if (shares < d.sizing.minShares)
    return { ok: false, reason: limitedBy === 'budget' ? 'BUDGET_EXHAUSTED' : 'BELOW_MIN_ORDER', detail: `${shares} share < tối thiểu ${d.sizing.minShares}` };
  if (stake + 1e-9 < minStake)
    return { ok: false, reason: limitedBy === 'budget' ? 'BUDGET_EXHAUSTED' : 'INSUFFICIENT_DEPTH', detail: `chỉ vào được ${stake.toFixed(2)}$ < tối thiểu ${minStake}$` };
  const feeSum = r6(levels.reduce((s, l) => s + l.fee, 0));
  const spent = levels.reduce((s, l) => s + l.shares * l.price, 0);
  const polyCost = r6(spent + feeSum);
  const totalCost = r6(stake + polyCost);
  const profit = r6(shares - totalCost);
  return { ok: true, stake, shares, avgPrice: r6(spent / shares), fee: feeSum, polyCost, totalCost, profit, netMargin: r6(profit / totalCost), levels, limitedBy };
}
