import {
  DEFAULT_ARBITRAGE_SETTINGS,
  type ArbitrageSettings,
  type ArbitrageSettingsStore,
} from '../../application/arbitrage-settings.js';

/**
 * Tạm giữ trong RAM (mất khi restart). Cần bền → thêm adapter Drizzle/Redis
 * cài cùng port, không đụng use case.
 */
export class InMemoryArbitrageSettingsStore implements ArbitrageSettingsStore {
  private _settings: ArbitrageSettings = DEFAULT_ARBITRAGE_SETTINGS;

  get() {
    return Promise.resolve(this._settings);
  }

  update(patch: Partial<ArbitrageSettings>) {
    this._settings = { ...this._settings, ...patch };
    return Promise.resolve(this._settings);
  }
}
