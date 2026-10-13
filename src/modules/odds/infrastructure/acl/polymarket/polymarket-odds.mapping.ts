import {
  mapHandicapMarket,
  mapWinnerMarket,
  totalMapsMarket,
  type MarketType,
} from '../../../domain/market-type.js';
import type { PolymarketMarketDTO } from './polymarket.dto.js';

export const POLYMARKET_SPORTS: Readonly<Record<string, string>> = {
  cs2: 'cs2',
  lol: 'lol',
  dota2: 'dota2',
  val: 'valorant',
};

export interface PolymarketMarketMapping {
  /**
   * - 'team': outcome yes/no là tên đội → cặp đội lấy từ outcome, token đảo theo thứ tự đội của room.
   * - 'side': outcome yes/no là side 0/side 1 của room (vd Over/Under) → cặp đội lấy từ
   *   market moneyline cùng event, token giữ nguyên.
   */
  readonly outcomesBy: 'team' | 'side';
  /**
   * market của polymarket → market domain. `yesFirst` = đội của outcome yes là teams[0]
   * của MatchKey (chỉ có nghĩa khi outcomesBy 'team'). null = bỏ qua market này.
   */
  toMarket(m: PolymarketMarketDTO, yesFirst: boolean): MarketType | null;
}

/** Số map của child_moneyline: "Map 1 Winner" (cs2, valorant) / "Game 1 Winner" (lol, dota2), dự phòng slug "...-game1". */
const mapNumberOf = (m: PolymarketMarketDTO): number | null => {
  const t = /^(?:map|game) (\d+) winner$/i.exec(m.groupItemTitle?.trim() ?? '');
  const s = /-game(\d+)$/.exec(m.slug ?? '');
  const n = t?.[1] ?? s?.[1];
  return n ? Number(n) : null;
};

/** sportsMarketType → cách đọc market đó. */
export const POLYMARKET_MARKETS: Readonly<
  Record<string, PolymarketMarketMapping>
> = {
  moneyline: { outcomesBy: 'team', toMarket: () => 'game-winner' },
  // Thắng từng map: yes/no là tên đội, số map nằm ở groupItemTitle/slug.
  child_moneyline: {
    outcomesBy: 'team',
    toMarket: (m) => {
      const map = mapNumberOf(m);
      return map === null ? null : mapWinnerMarket(map);
    },
  },
  // line = mức chấp của outcome yes (vd yes=INFURITY, line=-1.5 ↔ "INF (-1.5) vs ... (+1.5)").
  // LoL cũng dùng map_handicap ("Game Handicap").
  map_handicap: {
    outcomesBy: 'team',
    toMarket: (m, yesFirst) => {
      const line = m.sports.line;
      return line == null ? null : mapHandicapMarket(yesFirst ? line : -line);
    },
  },
  // "Games Total: O/U 2.5": yes = Over, no = Under, line = mốc tổng số map của cả trận.
  totals: {
    outcomesBy: 'side',
    toMarket: (m) =>
      m.sports.line == null ? null : totalMapsMarket(m.sports.line),
  },
};
