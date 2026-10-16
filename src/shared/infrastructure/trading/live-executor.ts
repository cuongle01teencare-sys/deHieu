import type { LiveTradingConfig } from '../../application/live-trading.js';
import { accountResource, type AccountLock } from './account-lock.js';
import {
  ApiVenueOrders,
  type OrderPlan,
  type VenueFill,
  type VenueAccountIdentity,
  type VenueOrders,
} from './venue-orders.js';
import { SESSION_EXPIRED } from './empire-session.js';

export interface ExecutionResult {
  status: 'filled' | 'partial' | 'cancelled' | 'error';
  reason: string | null;
  /** False means neither order was sent: the worker can release reservations. */
  submitted: boolean;
  fills: VenueFill[];
  /** Cash + tài khoản thật đọc ngay trước khi gửi lệnh. */
  cash?: {
    venue: string;
    available: number;
    required: number;
    account?: VenueAccountIdentity;
  }[];
}
export interface LiveExecutor {
  execute(
    config: LiveTradingConfig,
    plan: OrderPlan,
    signal: AbortSignal,
  ): Promise<ExecutionResult>;
  close(): void;
}

export class LiveOrderExecutor implements LiveExecutor {
  constructor(
    private readonly locks: Pick<
      AccountLock,
      | 'with'
      | 'halted'
      | 'claim'
      | 'halt'
      | 'clearHalt'
      | 'saveResult'
      | 'close'
    >,
    private readonly venues: VenueOrders = new ApiVenueOrders(),
  ) {}

  async execute(
    c: LiveTradingConfig,
    p: OrderPlan,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    let didSubmit = false;
    const resources = [
      accountResource('csgoempire', c.empire.browserProfile),
      accountResource(
        'polymarket',
        (
          c.polymarket.funderAddress ?? c.polymarket.walletAddress
        ).toLowerCase(),
      ),
    ];
    try {
      return await this.locks.with(resources, async (checkLock) => {
        const halted = await this.locks.halted(resources);
        if (halted)
          return {
            status: 'cancelled',
            reason: halted,
            submitted: false,
            fills: [],
          };
        // Both preparations are read-only (cash, limits, signing); neither submits an order.
        let prepared;
        try {
          prepared = await Promise.all([
            this.venues.empire(c.empire, p, signal),
            this.venues.polymarket(c.polymarket, p, signal),
          ]);
        } catch (e) {
          const code =
            e instanceof Error
              ? e.message.split(':')[0]
              : 'LIVE_PREFLIGHT_FAILED';
          if (code === 'CSGOEMPIRE_SESSION_EXPIRED')
            await this.locks.halt([resources[0]], SESSION_EXPIRED);
          return {
            status: 'cancelled',
            reason: /^[A-Z_0-9]+$/.test(code) ? code : 'LIVE_PREFLIGHT_FAILED',
            submitted: false,
            fills: [],
          };
        }
        const cash = prepared.map((order, i) => ({
          venue: i ? 'polymarket' : 'csgoempire',
          available: order.cash,
          required: order.requiredCash,
          account: order.account,
        }));
        if (
          cash.some(
            (x) =>
              !Number.isFinite(x.available) ||
              !Number.isFinite(x.required) ||
              x.available < 0 ||
              x.required <= 0,
          )
        )
          return {
            status: 'cancelled',
            reason: 'CASH_UNAVAILABLE: hủy cả hai chân',
            submitted: false,
            fills: [],
            cash,
          };
        if (cash.some((x) => x.available + 1e-9 < x.required))
          return {
            status: 'cancelled',
            reason: 'INSUFFICIENT_CASH: hủy cả hai chân',
            submitted: false,
            fills: [],
            cash,
          };
        signal.throwIfAborted();
        if (
          Date.now() >= p.expiresAt ||
          c.empire.expiresAt <= Date.now() + 20_000
        )
          return {
            status: 'cancelled',
            reason: 'SIGNAL_OR_SESSION_EXPIRED',
            submitted: false,
            fills: [],
            cash,
          };
        await checkLock();
        if (!(await this.locks.claim(p.id)))
          return {
            status: 'cancelled',
            reason: 'LIVE_ALREADY_SUBMITTED',
            submitted: false,
            fills: [],
            cash,
          };
        // Persistent before submission: a worker crash cannot silently resume betting.
        const marker = `LIVE_RECONCILIATION_REQUIRED:${p.id}`;
        await this.locks.halt(resources, marker);
        signal.throwIfAborted();
        await checkLock();
        didSubmit = true;
        const fills = await Promise.all(
          prepared.map(async (order) => {
            const sentAt = Date.now();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              return await Promise.race([
                order.submit(),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(
                    () => reject(new Error('ORDER_RESULT_UNKNOWN')),
                    30_000,
                  );
                }),
              ]);
            } catch {
              // A network failure is an unknown outcome, never an automatic retry.
              return {
                status: 'error' as const,
                orderRef: null,
                filledAmount: 0,
                avgPrice: 0,
                fee: 0,
                cost: 0,
                sentAt,
                ackedAt: Date.now(),
                filledAt: null,
                error: 'ORDER_RESULT_UNKNOWN',
              };
            } finally {
              if (timer) clearTimeout(timer);
            }
          }),
        );
        const success = fills.every((f) => f.status === 'filled');
        const rejected = fills.every((f) => f.status === 'rejected');
        const result: ExecutionResult = {
          status: success ? 'filled' : rejected ? 'cancelled' : 'partial',
          reason: success ? null : rejected ? 'BOTH_ORDERS_REJECTED' : marker,
          submitted: true,
          fills,
          cash,
        };
        await this.locks.saveResult(p.id, { plan: p, result });
        if (success || rejected) await this.locks.clearHalt(resources, marker);
        return result;
      });
    } catch (e) {
      if (didSubmit)
        throw new Error('LIVE_RECONCILIATION_REQUIRED', { cause: e });
      const code =
        e instanceof Error ? e.message.split(':')[0] : 'LIVE_PREFLIGHT_FAILED';
      return {
        status: 'cancelled',
        reason: /^[A-Z_0-9]+$/.test(code) ? code : 'LIVE_PREFLIGHT_FAILED',
        submitted: false,
        fills: [],
      };
    }
  }
  close() {
    this.locks.close();
  }
}
