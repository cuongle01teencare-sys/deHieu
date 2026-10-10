import type { MarketType } from '../../../domain/market-type.js';

export const POLYMARKET_SPORTS: Readonly<Record<string, string>> = {
  cs2: 'cs2',
};

export const POLYMARKET_MARKETS: Readonly<Record<string, MarketType>> = {
  moneyline: 'game-winner', // child_moneyline = theo map → thêm khi cần
};
