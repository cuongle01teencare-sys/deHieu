/** Private worker configuration. Never return this object from the public API. */
export interface LiveTradingConfig {
  empire: {
    browserProfile: string;
    token: string;
    expiresAt: number;
    apiUrl: string;
    brandId: string;
    sessionId: string;
    minBet: number;
    /** Tương thích cấu hình worker cũ; phiên mới không còn sao chép cookie khỏi Chromium. */
    cookie?: string;
    /** User-Agent của chính Chrome đã lấy JWT, dùng cho request BetBy. */
    userAgent?: string;
  };
  polymarket: {
    walletAddress: string;
    funderAddress: string | null;
    secretCipher: string;
  };
}
