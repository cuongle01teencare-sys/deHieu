import type { ArbitrageLeg } from './arbitrage-opportunity.js';
import type { Phase } from './phase.js';

/** Kèo gửi cho consumer (Discord, bot giao dịch). */
export interface ArbitrageSignal {
  readonly signalId: string;
  readonly room: string;
  readonly sport: string;
  readonly market: string;
  readonly teams: readonly [string, string];
  readonly comboId: string;
  readonly phase: Phase;
  readonly margin: number;
  readonly legs: readonly [ArbitrageLeg, ArbitrageLeg];
  readonly issuedAt: number;
  readonly expiresAt: number;
}
