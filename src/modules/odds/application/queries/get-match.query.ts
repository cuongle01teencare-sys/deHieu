import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import { MARKET_TYPES } from '../../domain/market-type.js';
import { MatchKey } from '../../domain/match-key.js';
import { pickOf } from '../../domain/pick.js';
import type { ArbitrageSettingsStore } from '../arbitrage-settings.js';
import type { OddsRoomStore } from '../odds-room.store.js';
import { toLineView, type RoomLineView } from './room-views.js';

export interface GetMatchQuery {
  /** 'cs2:alliance~sinners' */
  readonly match: string;
}

/** Một ô của ma trận market × tenant là một dòng kèo (hoặc không có). */
export interface MatchMarketView {
  readonly market: string;
  /** Id room: GET /arbitrage/rooms/{room}. */
  readonly room: string;
  /** Nhãn hai phía, vd ["alliance +1.5", "sinners -1.5"], ["over 2.5", "under 2.5"]. */
  readonly picks: readonly [string, string];
  readonly lines: Readonly<Record<string, RoomLineView>>;
  readonly combos: number;
  readonly bestMargin: number | null;
  readonly aboveMinMargin: boolean;
}

export interface MatchView {
  readonly match: string;
  readonly sport: string;
  readonly teams: readonly [string, string];
  readonly tenants: readonly string[];
  readonly startsAt: number;
  readonly minMargin: number;
  /** Theo thứ tự MARKET_TYPES; chỉ market đang có room. */
  readonly markets: readonly MatchMarketView[];
}

/** Toàn bộ market của một trận dưới dạng ma trận market × tenant. */
export class GetMatchHandler implements QueryHandler<
  GetMatchQuery,
  MatchView | null
> {
  constructor(
    private readonly _rooms: OddsRoomStore,
    private readonly _settings: ArbitrageSettingsStore,
    private readonly _now: () => number = Date.now,
  ) {}

  /** 'room:cs2:a~b:map-1-winner' → 'cs2:a~b'; sai dạng → null. */
  matchOfRoom(room: string): string | null {
    return MatchKey.parse(room)?.matchId() ?? null;
  }

  async execute(q: GetMatchQuery): Promise<MatchView | null> {
    const id = MatchKey.parseMatchId(q.match);
    if (!id) return null;
    const settings = await this._settings.get();
    const now = this._now();
    const base = MatchKey.of({
      sport: id.sport,
      teamX: id.teams[0],
      teamY: id.teams[1],
      market: MARKET_TYPES[0],
    });

    const markets: MatchMarketView[] = [];
    const tenants = new Set<string>();
    let startsAt = Infinity;
    for (const market of MARKET_TYPES) {
      const key = base.withMarket(market);
      const room = await this._rooms.get(key);
      if (!room.lines.size) continue;
      const combos = room.combinations(settings.maxStartDriftMs);
      const best = combos.length
        ? Math.max(...combos.map((c) => c.margin))
        : null;
      const lines: Record<string, RoomLineView> = {};
      for (const [tenant, l] of room.lines) {
        lines[tenant] = toLineView(l, now);
        tenants.add(tenant);
        startsAt = Math.min(startsAt, l.props.startsAt);
      }
      markets.push({
        market,
        room: key.toString(),
        picks: [pickOf(key, 0), pickOf(key, 1)],
        lines,
        combos: combos.length,
        bestMargin: best,
        aboveMinMargin: best !== null && best >= settings.minMargin,
      });
    }
    if (!markets.length) return null;
    return {
      match: base.matchId(),
      sport: id.sport,
      teams: id.teams,
      tenants: [...tenants].sort(),
      startsAt,
      minMargin: settings.minMargin,
      markets,
    };
  }
}
