/**
 * Tính lệnh arbitrage hai chân (thuần, không I/O):
 *   chân sách (csgoempire/sptpub): cược S ở odds O → thắng nhận S·O
 *   chân polymarket: mua N share cửa ngược lại → thắng nhận N (mỗi share 1$)
 * Cân hai chân: N = S·O ⇒ dù cửa nào thắng cũng nhận N.
 * Tổng chi = S + Σ nᵢ·(pᵢ + phí(pᵢ)); lãi = N − tổng chi.
 *
 * Phí taker polymarket (feeSchedule của market): mỗi share = rate · (p·(1−p))^exponent.
 * Maker không mất phí, nhưng lệnh khớp ngay (FOK/FAK) luôn là taker.
 */

export interface BookLevel {
  readonly price: number;
  readonly size: number;
}

export interface FeeSchedule {
  /** false = market không thu phí. */
  readonly enabled: boolean;
  readonly rate: number;
  readonly exponent: number;
}

export const NO_FEE: FeeSchedule = { enabled: false, rate: 0, exponent: 1 };

/** Phí taker cho MỘT share ở giá p. */
export const takerFeePerShare = (p: number, fee: FeeSchedule): number =>
  fee.enabled && fee.rate > 0 ? fee.rate * (p * (1 - p)) ** fee.exponent : 0;

export interface SizingInput {
  /** Odds thập phân chân sách. */
  readonly bookOdds: number;
  /** Lệnh bán (ask) của token cần mua; thứ tự bất kỳ. */
  readonly asks: readonly BookLevel[];
  readonly fee: FeeSchedule;
  /** Tiền mục tiêu chân sách (theo bảng vốn). */
  readonly targetStake: number;
  /** Dưới mức này thì không vào (sổ lệnh mỏng / bị giới hạn). */
  readonly minStake: number;
  /** Lãi ròng tối thiểu: chỉ ăn mức giá còn đạt ngưỡng này ở biên. */
  readonly minNetMargin: number;
  /** Số share tối thiểu một lệnh của market (orderMinSize). */
  readonly minShares: number;
  /** Ngân sách còn lại (USD, cả hai chân) theo các giới hạn tổng; Infinity = không giới hạn. */
  readonly budget: number;
  /** Bước làm tròn số share (xuống). */
  readonly shareStep?: number;
}

export interface FillLevel {
  readonly price: number;
  readonly shares: number;
  readonly fee: number;
}

export type SizingResult =
  | {
      readonly ok: true;
      readonly stake: number;
      readonly shares: number;
      readonly avgPrice: number;
      readonly fee: number;
      /** Tiền chân polymarket (gồm phí). */
      readonly polyCost: number;
      readonly totalCost: number;
      readonly payout: number;
      readonly profit: number;
      readonly netMargin: number;
      readonly levels: readonly FillLevel[];
      /** Bị giới hạn bởi: bảng vốn / độ sâu sổ lệnh / ngân sách. */
      readonly limitedBy: 'stake' | 'depth' | 'budget';
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'NO_EDGE' // mức giá tốt nhất đã không đạt ngưỡng lãi
        | 'INSUFFICIENT_DEPTH' // đủ lãi nhưng sổ lệnh quá mỏng so với tiền tối thiểu
        | 'BUDGET_EXHAUSTED' // giới hạn tổng theo trận không còn đủ tiền tối thiểu
        | 'BELOW_MIN_ORDER'; // số share dưới mức tối thiểu của market
      readonly detail: string;
    };

const floorTo = (n: number, step: number) => Math.floor(n / step + 1e-9) * step;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function sizeArbitrage(i: SizingInput): SizingResult {
  const step = i.shareStep ?? 0.01;
  const bookUnit = 1 / i.bookOdds; // tiền chân sách cho mỗi 1$ thắng
  const maxUnitCost = 1 / (1 + i.minNetMargin);
  const asks = [...i.asks]
    .filter((l) => l.price > 0 && l.price < 1 && l.size > 0)
    .sort((a, b) => a.price - b.price);

  const best = asks[0];
  if (!best)
    return { ok: false, reason: 'INSUFFICIENT_DEPTH', detail: 'sổ lệnh trống' };
  const bestUnit = bookUnit + best.price + takerFeePerShare(best.price, i.fee);
  if (bestUnit > maxUnitCost)
    return {
      ok: false,
      reason: 'NO_EDGE',
      detail: `giá tốt nhất ${best.price} → lãi ${pct(1 / bestUnit - 1)} < ${pct(i.minNetMargin)}`,
    };

  const targetShares = i.targetStake * i.bookOdds;
  let shares = 0;
  let budget = i.budget;
  let limitedBy: 'stake' | 'depth' | 'budget' = 'depth';
  const levels: FillLevel[] = [];
  for (const l of asks) {
    const fee = takerFeePerShare(l.price, i.fee);
    const unit = bookUnit + l.price + fee;
    if (unit > maxUnitCost) break; // từ đây giá chỉ tệ hơn
    let take = Math.min(l.size, targetShares - shares);
    if (take === targetShares - shares) limitedBy = 'stake';
    if (take * unit > budget) {
      take = budget / unit;
      limitedBy = 'budget';
    }
    take = floorTo(take, step);
    if (take <= 0) break;
    levels.push({ price: l.price, shares: take, fee: r6(take * fee) });
    shares += take;
    budget -= take * unit;
    if (limitedBy !== 'depth' || shares >= targetShares - step / 2) break;
  }

  shares = r6(shares);
  const stake = r6(shares * bookUnit);
  if (shares < i.minShares)
    return {
      ok: false,
      reason: limitedBy === 'budget' ? 'BUDGET_EXHAUSTED' : 'BELOW_MIN_ORDER',
      detail: `${shares} share < tối thiểu ${i.minShares}`,
    };
  if (stake + 1e-9 < i.minStake)
    return {
      ok: false,
      reason:
        limitedBy === 'budget' ? 'BUDGET_EXHAUSTED' : 'INSUFFICIENT_DEPTH',
      detail: `chỉ vào được ${stake.toFixed(2)}$ < tối thiểu ${i.minStake}$`,
    };

  const fee = r6(levels.reduce((s, l) => s + l.fee, 0));
  const spent = levels.reduce((s, l) => s + l.shares * l.price, 0);
  const polyCost = r6(spent + fee);
  const totalCost = r6(stake + polyCost);
  const profit = r6(shares - totalCost);
  return {
    ok: true,
    stake,
    shares,
    avgPrice: r6(spent / shares),
    fee,
    polyCost,
    totalCost,
    payout: shares,
    profit,
    netMargin: r6(profit / totalCost),
    levels,
    limitedBy,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/** Một mức giá của sổ lệnh kèm lãi ròng nếu ăn ở mức đó (để xem sổ lệnh mỏng cỡ nào). */
export interface DepthLevel {
  readonly price: number;
  readonly size: number;
  /** Tiền mua hết mức này (gồm phí). */
  readonly usd: number;
  /** Lãi ròng của cặp lệnh nếu mua ở đúng giá này. */
  readonly netMargin: number;
  /** Còn đạt ngưỡng lãi ròng tối thiểu. */
  readonly ok: boolean;
}

export interface DepthSummary {
  /** Tối đa `maxLevels` mức ask rẻ nhất. */
  readonly levels: readonly DepthLevel[];
  /** Giá cao nhất còn đạt ngưỡng lãi (null = không mức nào đạt). */
  readonly maxPrice: number | null;
  /** Tổng share / tiền (gồm phí) ở các mức còn đạt ngưỡng. */
  readonly sharesAtEdge: number;
  readonly usdAtEdge: number;
  /** Số share cần để cân đủ tiền mục tiêu. */
  readonly targetShares: number;
  /** Tiền chân sách tối đa vào được với độ sâu hiện có. */
  readonly maxStakeAtEdge: number;
}

/** Tóm tắt độ sâu sổ lệnh so với ngưỡng lãi — ghi vào lệnh để admin xem vì sao vào ít / bỏ qua. */
export function depthSummary(
  i: Pick<
    SizingInput,
    'bookOdds' | 'asks' | 'fee' | 'targetStake' | 'minNetMargin'
  >,
  maxLevels = 10,
): DepthSummary {
  const bookUnit = 1 / i.bookOdds;
  const maxUnit = 1 / (1 + i.minNetMargin);
  const asks = [...i.asks]
    .filter((l) => l.price > 0 && l.price < 1 && l.size > 0)
    .sort((a, b) => a.price - b.price);
  let sharesAtEdge = 0;
  let usdAtEdge = 0;
  let maxPrice: number | null = null;
  const levels: DepthLevel[] = [];
  for (const l of asks) {
    const fee = takerFeePerShare(l.price, i.fee);
    const unit = bookUnit + l.price + fee;
    const ok = unit <= maxUnit;
    if (ok) {
      sharesAtEdge += l.size;
      usdAtEdge += l.size * (l.price + fee);
      maxPrice = l.price;
    }
    if (levels.length < maxLevels)
      levels.push({
        price: l.price,
        size: l.size,
        usd: r6(l.size * (l.price + fee)),
        netMargin: r6(1 / unit - 1),
        ok,
      });
  }
  return {
    levels,
    maxPrice,
    sharesAtEdge: r6(sharesAtEdge),
    usdAtEdge: r6(usdAtEdge),
    targetShares: r6(i.targetStake * i.bookOdds),
    maxStakeAtEdge: r6(sharesAtEdge * bookUnit),
  };
}

/**
 * Số share lớn nhất ≤ `shares` mà lệnh MUA FOK của Polymarket nhận: share tối đa 4 số lẻ (dùng bước
 * 0.01) và tiền (share × giá giới hạn) tối đa 2 số lẻ. 0 = không có mức hợp lệ gần đó.
 */
export function polymarketBuyShares(shares: number, price: number): number {
  const cents = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
  let units = Math.floor(shares * 100 + 1e-6);
  for (let i = 0; i < 10_000 && units > 0; i++, units--) {
    const s = units / 100;
    if (cents(s * price)) return s;
  }
  return 0;
}
