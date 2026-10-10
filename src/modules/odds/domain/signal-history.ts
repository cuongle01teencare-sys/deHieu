import type { ArbitrageLeg } from './arbitrage-opportunity.js';
import type { Phase } from './phase.js';

/**
 * Vòng đời một kèo trong lịch sử:
 *  active     : đang sống (có thể đã được làm mới nhiều lần)
 *  superseded : bị kèo mới hơn của cùng tổ hợp ghi đè (không phải hủy)
 *  cancelled  : bị hủy, kèm lý do (CancelReason)
 *  abandoned  : app dừng/khởi động lại khi kèo còn sống
 */
export const SIGNAL_STATUSES = [
  'active',
  'superseded',
  'cancelled',
  'abandoned',
] as const;

export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export interface SignalHistoryEntry {
  readonly signalId: string;
  readonly room: string;
  readonly sport: string;
  readonly market: string;
  readonly phase: Phase;
  readonly comboId: string;
  readonly teams: readonly [string, string];
  readonly margin: number;
  readonly legs: readonly [ArbitrageLeg, ArbitrageLeg];
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly refreshCount: number;
  readonly lastRefreshedAt: Date | null;
  readonly status: SignalStatus;
  /** Lý do khi cancelled/abandoned. */
  readonly statusReason: string | null;
  readonly closedAt: Date | null;
  /** Kèo mới đã ghi đè kèo này (khi superseded). */
  readonly supersededBy: string | null;
}
