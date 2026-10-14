/** Cấu hình chung của auto trade (mọi profile). */
export interface TradingSettings {
  /**
   * Tổng tiền tối đa (USD, cả hai chân) vào MỘT trận, cộng dồn MỌI tài khoản/profile.
   * Mặc định bật; 0 = tắt giới hạn.
   */
  readonly matchExposureCapUsd: number;
}

export const DEFAULT_TRADING_SETTINGS: TradingSettings = {
  matchExposureCapUsd: 500,
};

export function validateTradingSettings(s: TradingSettings): string | null {
  return s.matchExposureCapUsd >= 0
    ? null
    : 'matchExposureCapUsd phải ≥ 0 (0 = tắt)';
}
