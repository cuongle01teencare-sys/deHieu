import { sizeArbitrage, type SizingResult } from './arbitrage-sizing.js';
import type {
  MarketTradingInfo,
  OrderBookSnapshot,
} from './polymarket-market-data.js';

/** Dữ liệu một chiến lược nhận để quyết định với một kèo. */
export interface StrategyInput {
  readonly margin: number;
  readonly bookOdds: number;
  readonly book: OrderBookSnapshot;
  readonly market: MarketTradingInfo;
  readonly targetStake: number;
  readonly minStake: number;
  readonly minNetMargin: number;
  /** Ngân sách còn lại theo các giới hạn tổng (USD, cả hai chân). */
  readonly budget: number;
  readonly params: Readonly<Record<string, unknown>>;
}

export type StrategyDecision = SizingResult;

/**
 * Chiến lược = id → hàm quyết định (có thể async: gọi mô hình ML, dịch vụ ngoài...).
 * Thêm chiến lược mới = thêm một mục ở đây; profile chọn bằng strategy.id.
 */
export interface TradeStrategy {
  readonly id: string;
  readonly description: string;
  decide(i: StrategyInput): StrategyDecision | Promise<StrategyDecision>;
}

const num = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;

/** Ăn lệnh bán (taker) từ giá tốt nhất, dừng khi lãi ròng ở biên dưới ngưỡng. */
const arbTaker: TradeStrategy = {
  id: 'arb-taker',
  description:
    'Mua ngay các mức giá còn lãi ≥ minNetMargin sau phí taker; cân hai chân theo odds sách.',
  decide: (i) =>
    sizeArbitrage({
      bookOdds: i.bookOdds,
      asks: i.book.asks,
      fee: i.market.fee,
      targetStake: i.targetStake,
      minStake: i.minStake,
      // tham số tùy chọn: tăng ngưỡng riêng cho chiến lược
      minNetMargin: Math.max(i.minNetMargin, num(i.params.minNetMargin, 0)),
      minShares: Math.max(i.market.minShares, i.book.minShares ?? 0),
      budget: i.budget,
    }),
};

export const TRADE_STRATEGIES: Readonly<Record<string, TradeStrategy>> = {
  [arbTaker.id]: arbTaker,
};
