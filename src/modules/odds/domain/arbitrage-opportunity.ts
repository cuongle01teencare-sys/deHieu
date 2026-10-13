import type { MatchKey, Side } from './match-key.js';
import type { Phase } from './phase.js';

export interface ArbitrageLeg {
  readonly tenant: string;
  readonly side: Side; // phía trong room (xem MarketType); bot dùng ref + side để chọn outcome
  /** Cửa được chọn, để hiển thị: "alliance", "alliance +1.5", "over 2.5"... (xem pickOf). */
  readonly pick: string;
  readonly odds: number;
  readonly ref: Readonly<Record<string, string>>;
}

/** Một tổ hợp: cược side 0 ở legs[0].tenant và side 1 ở legs[1].tenant. */
export interface ArbitrageOpportunity {
  readonly key: MatchKey;
  readonly comboId: string; // vd 'sptpub>0|polymarket>1'
  /** live nếu bất kỳ chân nào live. */
  readonly phase: Phase;
  /** Lợi nhuận trên tổng vốn: 1 / (1/oA + 1/oB) - 1. 0.02 = 2%. */
  readonly margin: number;
  readonly legs: readonly [ArbitrageLeg, ArbitrageLeg];
}

export const arbitrageMargin = (oddsA: number, oddsB: number): number =>
  1 / (1 / oddsA + 1 / oddsB) - 1;
