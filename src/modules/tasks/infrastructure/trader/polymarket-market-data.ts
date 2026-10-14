import { getJson } from '../shared/abortable.js';
import type { BookLevel, FeeSchedule } from './arbitrage-sizing.js';

/** Thông số giao dịch của một market (gamma), đổi rất ít → cache. */
export interface MarketTradingInfo {
  readonly fee: FeeSchedule;
  /** Số share tối thiểu một lệnh. */
  readonly minShares: number;
  readonly tickSize: number;
  readonly acceptingOrders: boolean;
}

export interface OrderBookSnapshot {
  readonly asks: readonly BookLevel[];
  readonly bids: readonly BookLevel[];
  /** Thời điểm sổ lệnh theo CLOB (ms), null nếu không có. */
  readonly at: number | null;
  readonly minShares: number | null;
  readonly tickSize: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const levels = (raw: unknown): BookLevel[] =>
  Array.isArray(raw)
    ? raw.flatMap((l: unknown) => {
        const o = l as { price?: unknown; size?: unknown } | null;
        const price = num(o?.price);
        const size = num(o?.size);
        return price !== null && size !== null ? [{ price, size }] : [];
      })
    : [];

/** Dịch feeSchedule của gamma; thiếu / tắt → không phí. */
export function parseTradingInfo(
  m: Record<string, unknown>,
): MarketTradingInfo {
  const fs = (m.feeSchedule ?? null) as Record<string, unknown> | null;
  const rate = num(fs?.rate) ?? 0;
  const exponent = num(fs?.exponent) ?? 1;
  const enabled = m.feesEnabled !== false && rate > 0;
  return {
    fee: { enabled, rate, exponent },
    minShares: num(m.orderMinSize) ?? 5,
    tickSize: num(m.orderPriceMinTickSize) ?? 0.01,
    acceptingOrders: m.acceptingOrders !== false && m.closed !== true,
  };
}

export function parseOrderBook(raw: unknown): OrderBookSnapshot {
  const b = (raw ?? {}) as Record<string, unknown>;
  return {
    asks: levels(b.asks).sort((x, y) => x.price - y.price),
    bids: levels(b.bids).sort((x, y) => y.price - x.price),
    at: num(b.timestamp),
    minShares: num(b.min_order_size),
    tickSize: num(b.tick_size),
  };
}

/** Đọc sổ lệnh (CLOB) và thông số market (gamma) qua REST công khai, không cần ví. */
export class PolymarketMarketData {
  private readonly _info = new Map<
    string,
    { at: number; value: Promise<MarketTradingInfo> }
  >();

  constructor(
    private readonly _urls: {
      readonly clobRest: string;
      readonly gammaRest: string;
    },
    private readonly _infoTtlMs = 10 * 60_000,
    private readonly _timeoutMs = 5_000,
  ) {}

  async orderBook(
    tokenId: string,
    signal: AbortSignal,
  ): Promise<OrderBookSnapshot> {
    const url = `${this._urls.clobRest}/book?token_id=${encodeURIComponent(tokenId)}`;
    return parseOrderBook(await getJson(url, signal, this._timeoutMs));
  }

  /** Cache theo conditionId; lỗi không bị cache. */
  tradingInfo(
    conditionId: string,
    signal: AbortSignal,
  ): Promise<MarketTradingInfo> {
    const hit = this._info.get(conditionId);
    if (hit && Date.now() - hit.at < this._infoTtlMs) return hit.value;
    const value = (async () => {
      const url = `${this._urls.gammaRest}/markets?condition_ids=${encodeURIComponent(conditionId)}`;
      const rows = await getJson(url, signal, this._timeoutMs);
      const m = Array.isArray(rows)
        ? (rows[0] as Record<string, unknown>)
        : null;
      if (!m) throw new Error(`gamma: không thấy market ${conditionId}`);
      return parseTradingInfo(m);
    })();
    this._info.set(conditionId, { at: Date.now(), value });
    value.catch(() => {
      if (this._info.get(conditionId)?.value === value)
        this._info.delete(conditionId);
    });
    return value;
  }
}
