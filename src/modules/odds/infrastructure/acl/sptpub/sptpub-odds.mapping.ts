import type { MarketType } from '../../../domain/market-type.js';

/** sport id của sptpub → sport của domain. Mở rộng khi cần. */
export const SPTPUB_SPORTS: Readonly<Record<string, string>> = {
  '109': 'cs2', // Counter-Strike
};

/** market id → market domain + outcome của competitor1/competitor2. */
export const SPTPUB_MARKETS: Readonly<
  Record<
    string,
    {
      market: MarketType;
      specifier: string;
      outcomes: readonly [string, string];
    }
  >
> = {
  '186': { market: 'game-winner', specifier: '', outcomes: ['4', '5'] }, // "Winner"
};
