import type { SignalPolicySettings } from '../domain/signal-policy.js';

export interface ArbitrageSettings extends SignalPolicySettings {
  /** Hai chân chỉ được ghép khi giờ bắt đầu lệch không quá giá trị này. */
  readonly maxStartDriftMs: number;
}

export const DEFAULT_ARBITRAGE_SETTINGS: ArbitrageSettings = {
  minMargin: 0.02,
  marginStep: 0.01,
  signalTtlMs: 30_000,
  maxStartDriftMs: 20 * 60_000,
  enabledPhases: ['live', 'prematch'],
};

/** Port: cấu hình chỉnh được qua API (cần quyền arbitrage-settings:write). */
export interface ArbitrageSettingsStore {
  get(): Promise<ArbitrageSettings>;
  update(patch: Partial<ArbitrageSettings>): Promise<ArbitrageSettings>;
}

export const ARBITRAGE_SETTINGS_STORE = Symbol('ARBITRAGE_SETTINGS_STORE');
