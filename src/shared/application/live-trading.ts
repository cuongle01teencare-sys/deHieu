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
    /** Cookie header for direct balance requests; held in memory only. */
    cookie: string;
  };
  polymarket: {
    walletAddress: string;
    funderAddress: string | null;
    secretCipher: string;
  };
}
