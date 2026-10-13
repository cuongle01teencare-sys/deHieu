/** Nhóm market cho ma trận Chi tiết trận (thứ tự hiển thị cố định). */
export interface MarketGroup {
  id: 'winner' | 'map-winner' | 'handicap' | 'total' | 'other';
  label: string;
}

export const MARKET_GROUPS: MarketGroup[] = [
  { id: 'winner', label: 'Thắng trận' },
  { id: 'map-winner', label: 'Thắng từng map' },
  { id: 'handicap', label: 'Chấp map' },
  { id: 'total', label: 'Tổng số map' },
  { id: 'other', label: 'Khác' },
];

export function marketGroup(market: string): MarketGroup['id'] {
  if (market === 'game-winner') return 'winner';
  if (/^map-\d-winner$/.test(market)) return 'map-winner';
  if (market.startsWith('map-handicap-')) return 'handicap';
  if (market.startsWith('total-maps-')) return 'total';
  return 'other';
}

/** Thứ tự trong nhóm: map-1..5; chấp m2.5, m1.5, p1.5, p2.5; tổng 2.5 → 4.5. */
export function marketOrder(market: string): number {
  const map = /^map-(\d)-winner$/.exec(market);
  if (map) return Number(map[1]);
  const hcp = /^map-handicap-([mp])(\d\.5)$/.exec(market);
  if (hcp) return (hcp[1] === 'm' ? -1 : 1) * Number(hcp[2]);
  const tot = /^total-maps-(\d\.5)$/.exec(market);
  if (tot) return Number(tot[1]);
  return 0;
}

/** Tên hiển thị ngắn gọn của market. */
export function marketLabel(market: string): string {
  if (market === 'game-winner') return 'Thắng trận';
  const map = /^map-(\d)-winner$/.exec(market);
  if (map) return `Map ${map[1]}`;
  const hcp = /^map-handicap-([mp])(\d\.5)$/.exec(market);
  if (hcp) return `Chấp ${hcp[1] === 'm' ? '−' : '+'}${hcp[2]}`;
  const tot = /^total-maps-(\d\.5)$/.exec(market);
  if (tot) return `Tổng ${tot[1]} map`;
  return market;
}

/** 'cs2:alliance~sinners' → { sport, teams }. */
export function parseMatchId(match: string): { sport: string; teams: [string, string] } {
  const [sport = '', pair = ''] = match.split(':');
  const [a = '', b = ''] = pair.split('~');
  return { sport, teams: [a, b] };
}

export const SPORT_LABEL: Record<string, string> = { cs2: 'CS2', lol: 'LoL', dota2: 'Dota 2', valorant: 'Valorant' };
