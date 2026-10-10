import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { ArbitrageSignal } from '../../domain/arbitrage-signal.js';
import { MatchKey } from '../../domain/match-key.js';
import type { Phase } from '../../domain/phase.js';
import type { ArbitrageSettingsStore } from '../arbitrage-settings.js';
import type { OddsRoomStore } from '../odds-room.store.js';
import type { SignalStateStore } from '../signal-state.store.js';
import { toLineView, type RoomLineView } from './room-views.js';

export interface GetRoomQuery {
  readonly room: string; // room:cs2:alliance~sinners:game-winner
}

export interface RoomComboView {
  readonly comboId: string;
  readonly phase: Phase;
  readonly margin: number;
  readonly aboveMinMargin: boolean;
  readonly legs: readonly { tenant: string; team: string; odds: number }[];
}

export interface RoomDetailView {
  readonly room: string;
  readonly sport: string;
  readonly market: string;
  readonly teams: readonly [string, string];
  /** tenant → dòng kèo; odds theo thứ tự `teams`. */
  readonly lines: Readonly<Record<string, RoomLineView>>;
  /** Mọi tổ hợp hợp lệ hiện tại, margin giảm dần (âm = không có arbitrage). */
  readonly combos: readonly RoomComboView[];
  readonly minMargin: number;
  /** Kèo đang hiệu lực của room này. */
  readonly activeSignals: readonly ArbitrageSignal[];
}

/** Chi tiết một room: odds từng tenant, các tổ hợp + margin, kèo đang phát. */
export class GetRoomHandler implements QueryHandler<
  GetRoomQuery,
  RoomDetailView | null
> {
  constructor(
    private readonly _rooms: OddsRoomStore,
    private readonly _settings: ArbitrageSettingsStore,
    private readonly _signals: SignalStateStore,
    private readonly _now: () => number = Date.now,
  ) {}

  async execute({ room }: GetRoomQuery): Promise<RoomDetailView | null> {
    const key = MatchKey.parse(room);
    if (!key) return null;
    const [r, settings, active] = await Promise.all([
      this._rooms.get(key),
      this._settings.get(),
      this._signals.activeSignals(),
    ]);
    if (r.lines.size === 0) return null;
    const now = this._now();

    return {
      room: key.toString(),
      sport: key.sport,
      market: key.market,
      teams: key.teams,
      lines: Object.fromEntries(
        [...r.lines].map(([t, l]) => [t, toLineView(l, now)]),
      ),
      combos: r
        .combinations(settings.maxStartDriftMs)
        .sort((a, b) => b.margin - a.margin)
        .map((c) => ({
          comboId: c.comboId,
          phase: c.phase,
          margin: c.margin,
          aboveMinMargin: c.margin >= settings.minMargin,
          legs: c.legs.map((l) => ({
            tenant: l.tenant,
            team: l.team,
            odds: l.odds,
          })),
        })),
      minMargin: settings.minMargin,
      activeSignals: active.filter((s) => s.room === key.toString()),
    };
  }
}
