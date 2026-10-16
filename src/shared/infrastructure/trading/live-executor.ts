import type { LiveTradingConfig } from '../../application/live-trading.js';
import { accountResource, type AccountLock } from './account-lock.js';
import {
  ApiVenueOrders,
  maskSecrets,
  type OrderPlan,
  type VenueFill,
  type EmpireBalanceStore,
  type VenueAccountIdentity,
  type VenueOrders,
} from './venue-orders.js';

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
  /** Mốc thời gian (ms epoch): bắt đầu khóa + chuẩn bị, chuẩn bị xong (đọc số dư, coupon/max, ký lệnh). */
  timing?: { startedAt: number; preparedAt: number };
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
    // AccountLock (Redis) cũng là kho số dư csgoempire do Chrome nền ghi
    private readonly venues: VenueOrders = new ApiVenueOrders(
      'readEmpireBalance' in locks
        ? (locks as unknown as EmpireBalanceStore)
        : undefined,
    ),
  ) {}

  async execute(
    c: LiveTradingConfig,
    p: OrderPlan,
    signal: AbortSignal,
  ): Promise<ExecutionResult> {
    let didSubmit = false;
    const startedAt = Date.now();
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
        let preparedAt: number;
        try {
          prepared = await Promise.all([
            this.venues.empire(c.empire, p, signal),
            this.venues.polymarket(c.polymarket, p, signal),
          ]);
          preparedAt = Date.now();
        } catch (e) {
          const code =
            e instanceof Error
              ? e.message.split(':')[0]
              : 'LIVE_PREFLIGHT_FAILED';
          // Giữ CHI TIẾT sau mã (endpoint, HTTP, lý do sàn trả) để biết vì sao hủy, không chỉ mã trơn.
          const detail =
            e instanceof Error
              ? maskSecrets(e.message.slice(code.length + 1).trim()).slice(
                  0,
                  240,
                )
              : '';
          const reason = /^[A-Z_0-9]+$/.test(code)
            ? detail
              ? `${code}: ${detail}`
              : code
            : 'LIVE_PREFLIGHT_FAILED';
          if (code === 'CSGOEMPIRE_SESSION_EXPIRED')
            await this.locks.halt([resources[0]], reason);
          return {
            status: 'cancelled',
            reason,
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
        const [bookOrder, polyOrder] = prepared;
        // Polymarket TRƯỚC: FOK khớp đủ hoặc không khớp gì → thua cuộc đua giá thì dừng, không mất gì.
        // Chỉ khi Polymarket khớp đủ mới đặt BetBy (odds BetBy sống lâu hơn, nhưng vé không bán lại được).
        const polyFill = await this.submitLeg(() => polyOrder.submit());
        let bookFill: VenueFill;
        let halt: string | null = null;
        if (polyFill.status === 'filled') {
          // Odds BetBy giảm → đặt bù với tiền cược theo odds mới sao cho không lỗ ở cả hai cửa
          bookFill = await this.submitLeg(() =>
            bookOrder.submit({
              hedge: { shares: polyFill.filledAmount, cost: polyFill.cost },
            }),
          );
          if (bookFill.status !== 'filled')
            halt = `${marker} — CHỈ chân Polymarket khớp (${polyFill.filledAmount} share, ${polyFill.cost.toFixed(2)}$); BetBy ${bookFill.status}: ${bookFill.error ?? '—'}. Bán lại share Polymarket hoặc bù tay chân BetBy, rồi chạy pnpm trading:resume … --reconciled`;
        } else {
          bookFill = notSent(
            `NOT_SENT: không gửi BetBy vì Polymarket ${polyFill.status}`,
          );
          // Bị từ chối hẳn = không có gì trên sàn. Còn lại (lỗi mạng, khớp một phần, chưa rõ) = có thể
          // đang có share Polymarket → giữ khóa để đối soát.
          if (polyFill.status !== 'rejected')
            halt = `${marker} — Polymarket ${polyFill.status}: ${polyFill.error ?? '—'}; chưa gửi BetBy. Kiểm tra lệnh trên Polymarket, rồi chạy pnpm trading:resume … --reconciled`;
        }
        const fills = [bookFill, polyFill];
        const success = !halt && bookFill.status === 'filled';
        const result: ExecutionResult = {
          status: success ? 'filled' : halt ? 'partial' : 'cancelled',
          reason: success
            ? null
            : halt
              ? marker
              : `POLYMARKET_NOT_FILLED: ${polyFill.error ?? polyFill.status} — không gửi BetBy`,
          submitted: true,
          fills,
          cash,
          timing: { startedAt, preparedAt },
        };
        await this.locks.saveResult(p.id, { plan: p, result });
        // giữ khóa kèm lý do đọc được (vẫn gỡ được bằng resume / clearHalt theo marker)
        if (halt)
          await this.locks.halt(
            resources,
            `${halt} (khóa lúc ${new Date().toISOString()})`,
          );
        else await this.locks.clearHalt(resources, marker);
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
  /** Gửi một chân, chờ tối đa 30 giây; lỗi mạng / quá hạn = KHÔNG RÕ kết quả (không bao giờ tự gửi lại). */
  private async submitLeg(send: () => Promise<VenueFill>): Promise<VenueFill> {
    const sentAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        send(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('ORDER_RESULT_UNKNOWN')),
            30_000,
          );
        }),
      ]);
    } catch (e) {
      const why =
        e instanceof Error && e.message !== 'ORDER_RESULT_UNKNOWN'
          ? `: ${e.name} — ${maskSecrets(e.message).slice(0, 200)}`
          : ': không có phản hồi sau 30 giây';
      return {
        status: 'error',
        orderRef: null,
        filledAmount: 0,
        avgPrice: 0,
        fee: 0,
        cost: 0,
        sentAt,
        ackedAt: Date.now(),
        filledAt: null,
        error: `ORDER_RESULT_UNKNOWN${why}`,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  close() {
    this.locks.close();
  }
}

/** Chân không được gửi (vì chân kia chưa khớp): không có gì trên sàn. */
function notSent(error: string): VenueFill {
  return {
    status: 'rejected',
    orderRef: null,
    filledAmount: 0,
    avgPrice: 0,
    fee: 0,
    cost: 0,
    sentAt: 0,
    ackedAt: 0,
    filledAt: null,
    error,
  };
}
