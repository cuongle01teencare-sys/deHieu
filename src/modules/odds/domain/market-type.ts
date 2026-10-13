/**
 * Market chuẩn của domain. Mở rộng thủ công khi cần, kèm mapper từng tenant
 * (vd sptpub 186 "Winner" ↔ polymarket "moneyline" ↔ 'game-winner').
 *
 * Hai phía (side 0 / side 1) của mỗi market:
 * - game-winner: teams[0] thắng / teams[1] thắng.
 * - map-handicap-{m|p}{x}: kèo chấp map, mức chấp tính cho teams[0] (m = âm, p = dương).
 *   Vd 'map-handicap-m1.5': side 0 = teams[0] -1.5, side 1 = teams[1] +1.5.
 * - total-maps-{x}: tổng số map của cả trận. side 0 = over x, side 1 = under x
 *   (không phụ thuộc đội nào đứng trước).
 * - map-{n}-winner: thắng riêng map thứ n. side 0 = teams[0] thắng map n, side 1 = teams[1].
 * Chỉ giữ các mức mà ≥ 2 tenant cùng có; mức khác translator bỏ qua
 * vì room chỉ một tenant không bao giờ ra kèo.
 */
export const MARKET_TYPES = [
  'game-winner',
  'map-handicap-m2.5',
  'map-handicap-m1.5',
  'map-handicap-p1.5',
  'map-handicap-p2.5',
  'total-maps-2.5',
  'total-maps-3.5',
  'total-maps-4.5',
  'map-1-winner',
  'map-2-winner',
  'map-3-winner',
  'map-4-winner',
  'map-5-winner',
] as const;

export type MarketType = (typeof MARKET_TYPES)[number];

export const isMarketType = (v: string): v is MarketType =>
  (MARKET_TYPES as readonly string[]).includes(v);

/** Mức chấp của teams[0] → market. Mức không hỗ trợ (hoặc không hữu hạn) → null. */
export const mapHandicapMarket = (lineOfTeam0: number): MarketType | null => {
  if (!Number.isFinite(lineOfTeam0)) return null;
  const id = `map-handicap-${lineOfTeam0 < 0 ? 'm' : 'p'}${Math.abs(lineOfTeam0)}`;
  return isMarketType(id) ? id : null;
};

/** Mốc tổng số map → market. Mốc không hỗ trợ → null. */
export const totalMapsMarket = (total: number): MarketType | null => {
  if (!Number.isFinite(total) || total <= 0) return null;
  const id = `total-maps-${total}`;
  return isMarketType(id) ? id : null;
};

/** Số thứ tự map (1, 2, ...) → market. Không hỗ trợ → null. */
export const mapWinnerMarket = (mapNumber: number): MarketType | null => {
  if (!Number.isInteger(mapNumber) || mapNumber < 1) return null;
  const id = `map-${mapNumber}-winner`;
  return isMarketType(id) ? id : null;
};

export type MarketShape =
  | { readonly kind: 'winner' }
  /** line = mức chấp của teams[0]. */
  | { readonly kind: 'map-handicap'; readonly line: number }
  | { readonly kind: 'total-maps'; readonly total: number }
  | { readonly kind: 'map-winner'; readonly map: number };

/** Đọc ngược market → cấu trúc (để hiển thị, tính pick...). */
export const describeMarket = (m: MarketType): MarketShape => {
  const h = /^map-handicap-([mp])(\d+(?:\.\d+)?)$/.exec(m);
  if (h)
    return {
      kind: 'map-handicap',
      line: (h[1] === 'm' ? -1 : 1) * Number(h[2]),
    };
  const t = /^total-maps-(\d+(?:\.\d+)?)$/.exec(m);
  if (t) return { kind: 'total-maps', total: Number(t[1]) };
  const w = /^map-(\d+)-winner$/.exec(m);
  if (w) return { kind: 'map-winner', map: Number(w[1]) };
  return { kind: 'winner' };
};
