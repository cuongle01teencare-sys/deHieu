import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import type { TradeAttempt } from './trade-attempt.js';
import type { TradeAttemptRepository } from './trading.ports.js';

/**
 * Kết quả lệnh sau khi trận xong. Một cặp arbitrage gồm hai cửa NGƯỢC nhau: chân Polymarket thắng
 * thì chân csgoempire thua và ngược lại. Lỗ một chân là bình thường — lãi thật nằm ở cả cặp (pnl).
 */
export const SETTLE_WINNERS = ['polymarket', 'csgoempire', 'void'] as const;
export type SettleWinner = (typeof SETTLE_WINNERS)[number];
export type LegResult = 'won' | 'lost' | 'void';
export type SettleSource = 'polymarket' | 'manual';

export interface TradeSettlement {
  readonly attemptId: string;
  readonly profileId: string;
  readonly mode: string;
  readonly winner: SettleWinner;
  /** Tiền nhận về mỗi share Polymarket (1 thắng, 0 thua, 0.5 hòa...). */
  readonly polyPrice: number;
  readonly bookResult: LegResult;
  readonly bookPnl: number;
  readonly polyPnl: number;
  /** Lãi/lỗ cả cặp = bookPnl + polyPnl. */
  readonly pnl: number;
  readonly source: SettleSource;
  readonly by: string | null;
  readonly resolvedAt: number;
}

/** Chỉ lệnh đã có tiền vào (thật khớp đủ/một phần, giấy, giấy đối chiếu) mới có kết quả. */
export const SETTLEABLE_STATUSES = ['filled', 'partial', 'paper_filled'];

/** Số tiền thật của hai chân (ưu tiên số khớp thật trong legs). */
export function legAmounts(t: TradeAttempt) {
  const bl = t.legs.find((l) => l.venue === 'csgoempire');
  const pl = t.legs.find((l) => l.venue === 'polymarket');
  const stake = bl ? bl.filledAmount : (t.book?.stake ?? 0);
  return {
    stake,
    odds: bl && bl.avgPrice > 0 ? bl.avgPrice : (t.book?.odds ?? 0),
    shares: pl ? pl.filledAmount : (t.polymarket?.shares ?? 0),
    polyCost: pl ? pl.cost : (t.polymarket?.cost ?? 0),
    tokenId: t.polymarket?.tokenId || pl?.marketRef || null,
  };
}

/** Tính lãi/lỗ từng chân theo cửa thắng. polyPrice chỉ dùng khi winner đến từ Polymarket. */
export function computeSettlement(
  t: TradeAttempt,
  winner: SettleWinner,
  polyPrice?: number,
): Pick<
  TradeSettlement,
  'winner' | 'polyPrice' | 'bookResult' | 'bookPnl' | 'polyPnl' | 'pnl'
> {
  const a = legAmounts(t);
  const bookResult: LegResult =
    winner === 'csgoempire' ? 'won' : winner === 'polymarket' ? 'lost' : 'void';
  const price =
    polyPrice ??
    (winner === 'polymarket'
      ? 1
      : winner === 'csgoempire'
        ? 0
        : // hủy trận (sửa tay): coi như Polymarket hoàn đúng tiền đã bỏ ra
          a.shares > 0
          ? a.polyCost / a.shares
          : 0);
  const bookPnl =
    bookResult === 'won'
      ? a.stake * (a.odds - 1)
      : bookResult === 'lost'
        ? -a.stake
        : 0;
  const polyPnl = a.shares * price - a.polyCost;
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    winner,
    polyPrice: price,
    bookResult,
    bookPnl: r(bookPnl),
    polyPnl: r(polyPnl),
    pnl: r(bookPnl + polyPnl),
  };
}

/** Giá resolve của token Polymarket → cửa thắng của cặp. */
export function winnerFromPolyPrice(price: number): SettleWinner {
  if (price >= 0.999) return 'polymarket';
  if (price <= 0.001) return 'csgoempire';
  return 'void';
}

export interface TradeSettlementRepository {
  /** Lệnh có tiền, có token Polymarket, chưa có kết quả, tạo trước `before`. */
  pendingSettlement(before: number, limit: number): Promise<TradeAttempt[]>;
  getSettlement(attemptId: string): Promise<TradeSettlement | null>;
  saveSettlement(s: TradeSettlement): Promise<void>;
  deleteSettlement(attemptId: string): Promise<boolean>;
  /** Mọi lệnh có tiền của một tài khoản (mọi mode), mới nhất trước, kèm kết quả. */
  accountTrades(q: {
    readonly accountId: string;
    readonly since?: number;
    readonly limit: number;
  }): Promise<{ trade: TradeAttempt; settlement: TradeSettlement | null }[]>;
}
export const TRADE_SETTLEMENT_REPOSITORY = Symbol(
  'TRADE_SETTLEMENT_REPOSITORY',
);

/** tokenId → tiền nhận mỗi share, CHỈ với market đã resolve xong. */
export interface PolymarketResolutionSource {
  resolve(tokenIds: readonly string[]): Promise<Map<string, number>>;
}
export const POLYMARKET_RESOLUTION_SOURCE = Symbol(
  'POLYMARKET_RESOLUTION_SOURCE',
);

/** Đối soát kết quả: tự động từ Polymarket + sửa tay. */
export class SettlementAdmin {
  private _running: Promise<{ checked: number; settled: number }> | null = null;
  constructor(
    private readonly _repo: TradeSettlementRepository,
    private readonly _trades: TradeAttemptRepository,
    private readonly _source: PolymarketResolutionSource,
    /** Chỉ hỏi lệnh đã vào ít nhất chừng này (trận chưa thể xong ngay). */
    private readonly _minAgeMs = 30 * 60_000,
  ) {}

  /** Một lượt đối soát; gọi chồng nhau thì dùng chung lượt đang chạy. */
  run(now = Date.now()): Promise<{ checked: number; settled: number }> {
    this._running ??= this._run(now).finally(() => {
      this._running = null;
    });
    return this._running;
  }

  private async _run(now: number) {
    const pending = await this._repo.pendingSettlement(
      now - this._minAgeMs,
      500,
    );
    const tokens = [
      ...new Set(
        pending
          .map((t) => legAmounts(t).tokenId)
          .filter((v): v is string => !!v),
      ),
    ];
    if (!tokens.length) return { checked: 0, settled: 0 };
    const prices = await this._source.resolve(tokens);
    let settled = 0;
    for (const t of pending) {
      const token = legAmounts(t).tokenId;
      const price = token ? prices.get(token) : undefined;
      if (price === undefined) continue;
      await this._repo.saveSettlement({
        attemptId: t.id,
        profileId: t.profileId,
        mode: t.mode,
        ...computeSettlement(t, winnerFromPolyPrice(price), price),
        source: 'polymarket',
        by: null,
        resolvedAt: Date.now(),
      });
      settled++;
    }
    return { checked: pending.length, settled };
  }

  async setManual(
    attemptId: string,
    winner: SettleWinner,
    by: string,
  ): Promise<OperationStatus<TradeSettlement>> {
    const t = await this._trades.get(attemptId);
    if (!t) return { status: 'NOT_FOUND' };
    if (!SETTLEABLE_STATUSES.includes(t.status))
      return {
        status: 'FAILED',
        reason: 'NOT_SETTLEABLE: lệnh không có tiền vào nên không có kết quả',
      };
    const s: TradeSettlement = {
      attemptId: t.id,
      profileId: t.profileId,
      mode: t.mode,
      ...computeSettlement(t, winner),
      source: 'manual',
      by,
      resolvedAt: Date.now(),
    };
    await this._repo.saveSettlement(s);
    return { status: 'SUCEED', data: s };
  }

  /** Bỏ kết quả (lượt tự động sau sẽ lấy lại từ Polymarket). */
  async clear(attemptId: string): Promise<OperationStatus<true>> {
    return (await this._repo.deleteSettlement(attemptId))
      ? { status: 'SUCEED', data: true }
      : { status: 'NOT_FOUND' };
  }
}
