import type { ArbitrageOpportunity } from './arbitrage-opportunity.js';
import type { Phase } from './phase.js';
import type { CancelReason } from './removal-reason.js';

export type { CancelReason } from './removal-reason.js';

export interface SignalPolicySettings {
  /** Ngưỡng tối thiểu, vd 0.02 = 2%. Dưới ngưỡng = mất kèo. */
  readonly minMargin: number;
  /** Mỗi lần lợi nhuận tăng thêm >= bước này (vd 0.01 = 1%) → kèo MỚI. */
  readonly marginStep: number;
  /** Thời hạn kèo, vd 30_000. Kèo còn nguyên sau thời hạn → phát lại. */
  readonly signalTtlMs: number;
  /** Kênh được phép tạo kèo. Kèo của kênh bị tắt sẽ bị hủy (phase_disabled). */
  readonly enabledPhases: readonly Phase[];
}

/** Trạng thái của một tổ hợp đang có kèo. */
export interface ComboSignalState {
  readonly comboId: string;
  /** Mốc cao nhất đã phát; kèo mới chỉ khi vượt mốc này + marginStep. */
  readonly highWaterMargin: number;
  readonly lastIssuedAt: number;
  /** Kèo đang hiệu lực của tổ hợp. Mỗi tổ hợp chỉ có MỘT kèo; kèo mới ghi đè kèo cũ. */
  readonly signalId: string;
}

export type SignalDecision =
  | {
      readonly type: 'issue';
      readonly opportunity: ArbitrageOpportunity;
      /** Kèo cũ bị ghi đè (không gửi cancel cho nó). */
      readonly supersedes?: string;
    }
  | {
      readonly type: 'refresh';
      readonly signalId: string;
      readonly opportunity: ArbitrageOpportunity;
    }
  | {
      readonly type: 'cancel';
      readonly comboId: string;
      readonly signalId: string;
      readonly reason: CancelReason;
    };

/**
 * Quy tắc (đã thống nhất):
 *  - chưa có kèo, kênh đang bật, lợi nhuận >= min       → issue
 *  - đã có kèo, lợi nhuận >= mốc cao nhất + step          → issue kèo mới, GHI ĐÈ kèo cũ (không cancel)
 *  - đã có kèo, kênh của kèo bị tắt                        → cancel (phase_disabled)
 *  - đã có kèo, lợi nhuận < min                           → cancel (below_threshold)
 *  - đã có kèo, tổ hợp biến mất                           → cancel, lý do do `explainMissing` cho biết
 *  - đã có kèo, còn >= min, quá signalTtlMs từ lần phát cuối → refresh
 *  - lợi nhuận giảm nhưng vẫn >= min                      → không gửi gì
 */
export const decideSignals = (
  previous: ReadonlyMap<string, ComboSignalState>,
  combinations: readonly ArbitrageOpportunity[],
  now: number,
  s: SignalPolicySettings,
  explainMissing: (comboId: string) => CancelReason,
): SignalDecision[] => {
  const decisions: SignalDecision[] = [];
  const current = new Map(combinations.map((c) => [c.comboId, c]));
  const enabled = (o: ArbitrageOpportunity) =>
    s.enabledPhases.includes(o.phase);
  const cancel = (state: ComboSignalState, reason: CancelReason) =>
    decisions.push({
      type: 'cancel',
      comboId: state.comboId,
      signalId: state.signalId,
      reason,
    });

  for (const [comboId, state] of previous) {
    const opp = current.get(comboId);
    if (!opp) cancel(state, explainMissing(comboId));
    else if (!enabled(opp)) cancel(state, 'phase_disabled');
    else if (opp.margin < s.minMargin) cancel(state, 'below_threshold');
    else if (opp.margin >= state.highWaterMargin + s.marginStep)
      decisions.push({
        type: 'issue',
        opportunity: opp,
        supersedes: state.signalId,
      });
    else if (now - state.lastIssuedAt >= s.signalTtlMs)
      decisions.push({
        type: 'refresh',
        signalId: state.signalId,
        opportunity: opp,
      });
  }

  for (const opp of combinations)
    if (!previous.has(opp.comboId) && enabled(opp) && opp.margin >= s.minMargin)
      decisions.push({ type: 'issue', opportunity: opp });

  return decisions;
};
