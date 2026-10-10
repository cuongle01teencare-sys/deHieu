/**
 * Market chuẩn của domain. Mở rộng thủ công khi cần, kèm mapper từng tenant
 * (vd sptpub 186 "Winner" ↔ polymarket "moneyline" ↔ 'game-winner').
 */
export const MARKET_TYPES = ['game-winner'] as const;

export type MarketType = (typeof MARKET_TYPES)[number];

export const isMarketType = (v: string): v is MarketType =>
  (MARKET_TYPES as readonly string[]).includes(v);
