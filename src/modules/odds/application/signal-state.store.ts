import type { ArbitrageSignal } from '../domain/arbitrage-signal.js';
import type { ComboSignalState } from '../domain/signal-policy.js';

/** Port: trạng thái kèo theo room (mốc cao nhất, kèo còn hiệu lực). */
export interface SignalStateStore {
  getCombos(room: string): Promise<Map<string, ComboSignalState>>;
  saveCombos(
    room: string,
    combos: ReadonlyMap<string, ComboSignalState>,
  ): Promise<void>;
  roomsWithActiveSignals(): Promise<string[]>;

  putSignal(signal: ArbitrageSignal): Promise<void>;
  removeSignals(signalIds: readonly string[]): Promise<void>;
  activeSignals(): Promise<ArbitrageSignal[]>;
}

export const SIGNAL_STATE_STORE = Symbol('SIGNAL_STATE_STORE');
