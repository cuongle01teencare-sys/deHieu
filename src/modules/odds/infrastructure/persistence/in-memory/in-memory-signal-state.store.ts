import type { SignalStateStore } from '../../../application/signal-state.store.js';
import type { ArbitrageSignal } from '../../../domain/arbitrage-signal.js';
import type { ComboSignalState } from '../../../domain/signal-policy.js';

/** Trạng thái kèo sống ngắn (≤ vài phút) → in-memory là đủ cho một instance app. */
export class InMemorySignalStateStore implements SignalStateStore {
  private readonly _combos = new Map<string, Map<string, ComboSignalState>>();
  private readonly _signals = new Map<string, ArbitrageSignal>();

  getCombos(room: string) {
    return Promise.resolve(new Map(this._combos.get(room) ?? []));
  }

  saveCombos(room: string, combos: ReadonlyMap<string, ComboSignalState>) {
    if (combos.size === 0) this._combos.delete(room);
    else this._combos.set(room, new Map(combos));
    return Promise.resolve();
  }

  roomsWithActiveSignals() {
    return Promise.resolve([...this._combos.keys()]);
  }

  putSignal(signal: ArbitrageSignal) {
    this._signals.set(signal.signalId, signal);
    return Promise.resolve();
  }

  removeSignals(signalIds: readonly string[]) {
    signalIds.forEach((id) => this._signals.delete(id));
    return Promise.resolve();
  }

  activeSignals() {
    return Promise.resolve([...this._signals.values()]);
  }
}
