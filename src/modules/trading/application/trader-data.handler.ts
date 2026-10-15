import type { TradeAttemptRepository } from './trading.ports.js';
import { TradeAttemptSchema } from './trade-attempt.js';
import type { TraderConfigSync } from './trader-config.sync.js';
import type { OneClickBoard } from './one-click-board.js';

/** Kind của task trader (khai báo ở danh mục task). */
export const TRADER_TASK_KIND = 'trader.arbitrage';

/** Dữ liệu một task trader gửi về (phần cần dùng của TaskDataMessage). */
export interface TraderDataMessage {
  readonly taskId: string;
  readonly kind: string;
  readonly channel?: string;
  readonly payload: unknown;
}

/**
 * Đầu vào từ task trader:
 *  - 'config_request' {profileId} → gửi cấu hình;
 *  - 'trade' TradeAttempt → ghi database;
 *  - 'oneclick' → bảng On click (kèo chờ người vào lệnh).
 * Message của kind khác bị bỏ qua.
 */
export class TraderDataHandler {
  constructor(
    private readonly _trades: TradeAttemptRepository,
    private readonly _sync: TraderConfigSync,
    private readonly _retries: {
      readonly attempts: number;
      readonly baseDelayMs: number;
      readonly sleep: (ms: number) => Promise<void>;
    } = {
      attempts: 5,
      baseDelayMs: 500,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    private readonly _board: OneClickBoard | null = null,
  ) {}

  async execute(msg: TraderDataMessage): Promise<void> {
    if (msg.kind !== TRADER_TASK_KIND) return;
    if (msg.channel === 'config_request') {
      const profileId = (msg.payload as { profileId?: unknown } | null)
        ?.profileId;
      if (typeof profileId === 'string' && profileId)
        await this._sync.answer(msg.taskId, profileId);
      return;
    }
    if (msg.channel === 'oneclick') {
      this._board?.apply(msg.payload);
      return;
    }
    if (msg.channel === 'trade') {
      const t = TradeAttemptSchema.parse(msg.payload);
      // database chập chờn: thử lại để không mất lệnh (ghi trùng id được bỏ qua)
      for (let attempt = 1; ; attempt++) {
        try {
          return await this._trades.record(t);
        } catch (e) {
          if (attempt >= this._retries.attempts) throw e;
          await this._retries.sleep(
            this._retries.baseDelayMs * 2 ** (attempt - 1),
          );
        }
      }
    }
  }
}
