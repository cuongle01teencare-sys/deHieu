import type { TaskDataMessage } from '../../../../tasks/application/task-protocol.js';
import type {
  OddsLineChange,
  RawOddsTranslator,
} from '../../../application/raw-odds.translator.js';
import type { TeamNameResolver } from '../../../application/team-name.resolver.js';
import { MatchKey, type Side } from '../../../domain/match-key.js';
import { OddsLine } from '../../../domain/odds-line.js';
import type { Phase } from '../../../domain/phase.js';
import {
  PolymarketEventSchema,
  PolymarketEventsPayloadSchema,
  PolymarketMarketSchema,
  PolymarketStreamEventSchema,
} from './polymarket.dto.js';
import {
  POLYMARKET_MARKETS,
  POLYMARKET_SPORTS,
} from './polymarket-odds.mapping.js';

interface MarketRoute {
  key: MatchKey;
  startsAt: number;
  conditionId: string;
  slug: string;
  tokens: [string, string]; // token theo thứ tự đội của MatchKey
  asks: [number | null, number | null];
  /** Task 'polymarket.descriptor' đã khai báo market này. */
  taskId: string;
  /** Trận đang live hay chưa — cập nhật mỗi lần descriptor làm mới danh sách trận. */
  phase: Phase;
}

/** Đồng bộ tập token cần theo dõi với task stream (module nối vào lệnh của task). */
export type SyncAssets = (
  op: 'subscribe' | 'unsubscribe',
  assetIds: string[],
) => Promise<void>;

/**
 * ACL Polymarket. Mỗi đội là một token có ask riêng → odds = 1 / best_ask của token đội đó.
 * Giữ bảng định tuyến token → market (lấy từ task 'polymarket.descriptor'); live/prematch tách theo trạng thái trận.
 */
export class PolymarketOddsTranslator implements RawOddsTranslator {
  readonly tenant = 'polymarket';
  readonly kinds = ['polymarket.descriptor', 'polymarket.stream'] as const;
  private readonly _markets = new Map<string, MarketRoute>(); // conditionId → route
  private readonly _tokens = new Map<
    string,
    { conditionId: string; side: Side }
  >();

  constructor(
    private readonly _teams: TeamNameResolver,
    private readonly _sync: SyncAssets = () => Promise.resolve(),
  ) {}

  translate(msg: TaskDataMessage): Promise<OddsLineChange[]> {
    if (msg.kind === 'polymarket.descriptor') return this._onEvents(msg);
    if (msg.kind === 'polymarket.stream')
      return Promise.resolve(this._onStream(msg));
    return Promise.resolve([]);
  }

  private async _onEvents(msg: TaskDataMessage): Promise<OddsLineChange[]> {
    const page = PolymarketEventsPayloadSchema.safeParse(msg.payload);
    if (!page.success) return [];
    const changes: OddsLineChange[] = [];
    const dropped: string[] = [];

    for (const raw of page.data) {
      const ev = PolymarketEventSchema.safeParse(raw);
      if (!ev.success) continue;
      const sport = POLYMARKET_SPORTS[ev.data.sports.sport?.sport ?? ''];
      if (!sport) continue;

      for (const rawMarket of ev.data.markets) {
        const parsed = PolymarketMarketSchema.safeParse(rawMarket);
        if (!parsed.success) continue;
        const m = parsed.data;
        const market = POLYMARKET_MARKETS[m.sports.sportsMarketType ?? ''];
        const startIso = m.sports.gameStartTime ?? ev.data.schedule.startTime;
        const { yes, no } = m.outcomes;
        if (
          !market ||
          !m.conditionId ||
          !startIso ||
          !yes.tokenId ||
          !no.tokenId
        )
          continue;

        const names = [
          this._teams.resolve(yes.label),
          this._teams.resolve(no.label),
        ];
        if (!names[0] || !names[1] || names[0] === names[1]) continue;
        const key = MatchKey.of({
          sport,
          teamX: names[0],
          teamY: names[1],
          market,
        });

        if (m.state.closed || m.state.acceptingOrders === false) {
          const known = this._markets.get(m.conditionId);
          dropped.push(...this._dropMarket(m.conditionId));
          changes.push({
            type: 'remove',
            key,
            tenant: this.tenant,
            phase: known?.phase ?? 'prematch',
          });
          continue;
        }

        const flip = key.sideOf(names[0]) !== 0;
        const tokens: [string, string] = flip
          ? [no.tokenId, yes.tokenId]
          : [yes.tokenId, no.tokenId];
        // seed từ snapshot: ask(yes) = bestAsk, ask(no) ≈ 1 - bestBid; stream sẽ cập nhật chính xác
        const seed: [number | null, number | null] = [
          validAsk(m.prices.bestAsk),
          validAsk(m.prices.bestBid != null ? 1 - m.prices.bestBid : null),
        ];

        const startsAt = Date.parse(startIso);
        // trạng thái live lấy từ danh sách trận; thiếu thì suy theo giờ bắt đầu
        const phase: Phase =
          (ev.data.state?.live ?? startsAt <= msg.sentAt) ? 'live' : 'prematch';
        let route = this._markets.get(m.conditionId);
        if (route) {
          route.phase = phase; // trận chuyển prematch → live
        } else {
          const created: MarketRoute = {
            key,
            startsAt,
            conditionId: m.conditionId,
            slug: m.slug ?? ev.data.slug ?? '',
            tokens,
            asks: flip ? [seed[1], seed[0]] : seed,
            taskId: msg.taskId,
            phase,
          };
          route = created;
          this._markets.set(m.conditionId, created);
          tokens.forEach((t, i) =>
            this._tokens.set(t, {
              conditionId: created.conditionId,
              side: i as Side,
            }),
          );
        }
        const change = this._toChange(route, msg.sentAt);
        if (change) changes.push(change);
      }
    }

    // gửi TOÀN BỘ token đang biết: lệnh idempotent, đồng thời tự phục hồi khi task stream khởi động lại
    if (this._tokens.size)
      await this._sync('subscribe', [...this._tokens.keys()]);
    if (dropped.length) await this._sync('unsubscribe', dropped);
    return changes;
  }

  private _onStream(msg: TaskDataMessage): OddsLineChange[] {
    const ev = PolymarketStreamEventSchema.safeParse(msg.payload);
    if (!ev.success) return [];
    const e = ev.data;
    const touched = new Set<string>();
    const changes: OddsLineChange[] = [];

    if (e.type === 'price_change')
      e.payload.priceChanges.forEach((p) =>
        this._setAsk(p.assetId, p.bestAsk, touched),
      );
    else if (e.type === 'best_bid_ask')
      this._setAsk(e.payload.assetId, e.payload.bestAsk, touched);
    else if (e.type === 'book') {
      const best = Math.min(...e.payload.asks.map((a) => a.price));
      this._setAsk(
        e.payload.assetId,
        Number.isFinite(best) ? best : null,
        touched,
      );
    } else if (e.type === 'market_resolved') {
      for (const t of e.payload.assetIds ?? []) {
        const cid = this._tokens.get(t)?.conditionId;
        const route = cid ? this._markets.get(cid) : undefined;
        if (route) {
          changes.push({
            type: 'remove',
            key: route.key,
            tenant: this.tenant,
            phase: route.phase,
          });
          this._dropMarket(route.conditionId);
        }
      }
    }

    for (const cid of touched) {
      const route = this._markets.get(cid);
      const change = route && this._toChange(route, msg.sentAt);
      if (change) changes.push(change);
    }
    return changes;
  }

  async release(taskId: string, kind: string): Promise<OddsLineChange[]> {
    const changes: OddsLineChange[] = [];

    if (kind === 'polymarket.stream') {
      // mất nguồn giá: gỡ dòng, giữ bảng định tuyến; giá về lại khi có task stream mới
      for (const route of this._markets.values()) {
        route.asks = [null, null];
        changes.push({
          type: 'remove',
          key: route.key,
          tenant: this.tenant,
          phase: route.phase,
        });
      }
    } else if (kind === 'polymarket.descriptor') {
      // mất nguồn danh sách trận: gỡ mọi market do task này khai báo
      const dropped: string[] = [];
      for (const route of [...this._markets.values()])
        if (route.taskId === taskId) {
          changes.push({
            type: 'remove',
            key: route.key,
            tenant: this.tenant,
            phase: route.phase,
          });
          dropped.push(...this._dropMarket(route.conditionId));
        }
      if (dropped.length) await this._sync('unsubscribe', dropped);
    }
    return changes;
  }

  private _setAsk(
    assetId: string,
    ask: number | null | undefined,
    touched: Set<string>,
  ) {
    const t = this._tokens.get(assetId);
    const route = t && this._markets.get(t.conditionId);
    if (!t || !route) return;
    route.asks[t.side] = validAsk(ask);
    touched.add(t.conditionId);
  }

  private _toChange(r: MarketRoute, at: number): OddsLineChange {
    const a = validAsk(r.asks[0]);
    const b = validAsk(r.asks[1]);
    const open = a !== null && b !== null;
    return {
      type: 'set',
      key: r.key,
      line: OddsLine.create({
        tenant: this.tenant,
        odds: open ? [1 / a, 1 / b] : [1.01, 1.01],
        status: open ? 'open' : 'suspended',
        phase: r.phase,
        updatedAt: at,
        startsAt: r.startsAt,
        ref: {
          c: r.conditionId,
          slug: r.slug,
          t0: r.tokens[0],
          t1: r.tokens[1],
        },
      }),
    };
  }

  /** Trả về các token bị bỏ. */
  private _dropMarket(conditionId: string): string[] {
    const r = this._markets.get(conditionId);
    r?.tokens.forEach((t) => this._tokens.delete(t));
    this._markets.delete(conditionId);
    return r ? [...r.tokens] : [];
  }
}

/**
 * Giá (xác suất) dùng được để tính odds = 1/giá: phải nằm trong (0, 1).
 * Giá 1 (chắc thắng / market sắp đóng) hoặc 0 (không có lệnh) → coi như không có giá → dòng suspended.
 */
function validAsk(ask: number | null | undefined): number | null {
  return ask != null && Number.isFinite(ask) && ask > 0 && ask < 1 ? ask : null;
}
