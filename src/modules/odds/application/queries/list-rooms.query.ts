import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { OddsRoom } from '../../domain/odds-room.js';
import type { Phase } from '../../domain/phase.js';
import type { ArbitrageSettingsStore } from '../arbitrage-settings.js';
import type { OddsRoomStore } from '../odds-room.store.js';

export interface ListRoomsQuery {
  /** Chỉ room có dòng kèo của tenant này. */
  readonly tenant?: string;
  readonly sport?: string;
  readonly phase?: Phase;
  /** true = chỉ room có ≥ 2 tenant (đã ghép được trận giữa các nhà cái). */
  readonly matched?: boolean;
  /** Tìm theo tên đội (chuỗi con, không phân biệt hoa thường). */
  readonly q?: string;
  readonly limit: number;
  readonly offset: number;
}

/** Một dòng trong danh sách: đủ để nhận ra trận và lấy `room` mở chi tiết. */
export interface RoomListItem {
  /** Id để xem chi tiết: GET /arbitrage/rooms/{room}. */
  readonly room: string;
  readonly sport: string;
  readonly market: string;
  readonly teams: readonly [string, string];
  readonly tenants: readonly string[];
  readonly phases: readonly Phase[];
  /** Margin tốt nhất (âm = không có arbitrage); null = chưa ghép được. */
  readonly bestMargin: number | null;
  readonly aboveMinMargin: boolean;
  readonly startsAt: number;
  readonly lastUpdatedAt: number;
}

export interface RoomsOverview {
  readonly total: number;
  /** Room có ≥ 2 tenant. */
  readonly matched: number;
  /** Room có ít nhất một tổ hợp hợp lệ (cả hai chân mở, giờ bắt đầu khớp). */
  readonly withCombos: number;
  /** Room có tổ hợp đạt minMargin. */
  readonly aboveMinMargin: number;
  readonly minMargin: number;
  readonly byTenant: Readonly<
    Record<
      string,
      { lines: number; open: number; suspended: number; newestAgeMs: number }
    >
  >;
}

export interface ListRoomsResult {
  /** Số room khớp bộ lọc (trước phân trang). */
  readonly total: number;
  readonly items: readonly RoomListItem[];
}

/** Danh sách room đang có trong store — để biết room nào tồn tại rồi mở chi tiết. */
export class ListRoomsHandler implements QueryHandler<
  ListRoomsQuery,
  ListRoomsResult
> {
  constructor(
    private readonly _rooms: OddsRoomStore,
    private readonly _settings: ArbitrageSettingsStore,
    private readonly _now: () => number = Date.now,
  ) {}

  async execute(q: ListRoomsQuery): Promise<ListRoomsResult> {
    const settings = await this._settings.get();
    const needle = q.q?.toLowerCase();
    const items = (await this._rooms.list())
      .map((r) => toItem(r, settings.maxStartDriftMs, settings.minMargin))
      .filter(
        (v) =>
          (!q.tenant || v.tenants.includes(q.tenant)) &&
          (!q.sport || v.sport === q.sport) &&
          (!q.phase || v.phases.includes(q.phase)) &&
          (q.matched === undefined || q.matched === v.tenants.length >= 2) &&
          (!needle || v.teams.some((t) => t.includes(needle))),
      )
      .sort(
        (a, b) =>
          (b.bestMargin ?? -Infinity) - (a.bestMargin ?? -Infinity) ||
          a.room.localeCompare(b.room),
      );
    return {
      total: items.length,
      items: items.slice(q.offset, q.offset + q.limit),
    };
  }

  /** Số liệu tổng hợp cho /arbitrage/stats. */
  async overview(): Promise<RoomsOverview> {
    const settings = await this._settings.get();
    const now = this._now();
    const rooms = await this._rooms.list();
    const byTenant: Record<
      string,
      { lines: number; open: number; suspended: number; newestAgeMs: number }
    > = {};
    let matched = 0;
    let withCombos = 0;
    let above = 0;
    for (const r of rooms) {
      const item = toItem(r, settings.maxStartDriftMs, settings.minMargin);
      if (item.tenants.length >= 2) matched++;
      if (item.bestMargin !== null) withCombos++;
      if (item.aboveMinMargin) above++;
      for (const [tenant, l] of r.lines) {
        const t = (byTenant[tenant] ??= {
          lines: 0,
          open: 0,
          suspended: 0,
          newestAgeMs: Infinity,
        });
        t.lines++;
        if (l.isOpen) t.open++;
        else t.suspended++;
        t.newestAgeMs = Math.min(t.newestAgeMs, now - l.props.updatedAt);
      }
    }
    return {
      total: rooms.length,
      matched,
      withCombos,
      aboveMinMargin: above,
      minMargin: settings.minMargin,
      byTenant,
    };
  }
}

function toItem(
  room: OddsRoom,
  maxDrift: number,
  minMargin: number,
): RoomListItem {
  const combos = room.combinations(maxDrift);
  const best = combos.length ? Math.max(...combos.map((c) => c.margin)) : null;
  const lines = [...room.lines.values()];
  return {
    room: room.key.toString(),
    sport: room.key.sport,
    market: room.key.market,
    teams: room.key.teams,
    tenants: [...room.lines.keys()].sort(),
    phases: [...new Set(lines.map((l) => l.props.phase))],
    bestMargin: best,
    aboveMinMargin: best !== null && best >= minMargin,
    startsAt: Math.min(...lines.map((l) => l.props.startsAt)),
    lastUpdatedAt: Math.max(...lines.map((l) => l.props.updatedAt)),
  };
}
