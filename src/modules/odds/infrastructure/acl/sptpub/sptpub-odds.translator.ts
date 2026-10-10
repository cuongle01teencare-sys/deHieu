import type { TaskDataMessage } from '../../../../tasks/application/task-protocol.js';
import type {
  OddsLineChange,
  RawOddsTranslator,
} from '../../../application/raw-odds.translator.js';
import type { TeamNameResolver } from '../../../application/team-name.resolver.js';
import { MatchKey } from '../../../domain/match-key.js';
import { OddsLine } from '../../../domain/odds-line.js';
import type { Phase } from '../../../domain/phase.js';

const FEED_PHASE: Readonly<Record<string, Phase>> = {
  'sptpub.live': 'live',
  'sptpub.prematch': 'prematch',
};
import { SptPubFeedSchema, type SptPubOutcomeDTO } from './sptpub-feed.dto.js';
import { SPTPUB_MARKETS, SPTPUB_SPORTS } from './sptpub-odds.mapping.js';

interface Route {
  sport: string;
  teams: readonly [string, string]; // competitor1, competitor2 (đã chuẩn hóa)
  startsAt: number;
  /** Feed (task) sở hữu trận: live và prematch cùng gửi một trận khi trận chuyển sang live. */
  taskId: string;
  phase: Phase;
}

/**
 * ACL sptpub. Delta chỉ mang eventId nên phải giữ bảng định tuyến eventId → trận
 * (lấy từ `desc` ở snapshot). Bảng này nằm trong RAM, tự dựng lại khi snapshot về.
 */
export class SptPubOddsTranslator implements RawOddsTranslator {
  readonly tenant = 'sptpub';
  readonly kinds = [
    'sptpub.descriptor',
    'sptpub.live',
    'sptpub.prematch',
  ] as const;
  private readonly _routes = new Map<string, Route>();
  /** eventId|marketId → outcomeId → outcome mới nhất (delta có thể chỉ gửi 1 outcome). */
  private readonly _last = new Map<string, Map<string, SptPubOutcomeDTO>>();
  /** taskId → eventId đã thấy trong lần snapshot đang chạy (để dọn trận đã biến mất). */
  private readonly _seen = new Map<string, Set<string>>();

  constructor(private readonly _teams: TeamNameResolver) {}

  translate(msg: TaskDataMessage): Promise<OddsLineChange[]> {
    const phase = FEED_PHASE[msg.kind];
    if (!phase) return Promise.resolve([]); // descriptor: chưa dùng tới
    if (msg.channel === 'snapshot-start') {
      this._seen.set(msg.taskId, new Set());
      return Promise.resolve([]);
    }
    const parsed = SptPubFeedSchema.safeParse(msg.payload);
    if (!parsed.success) return Promise.resolve([]); // TODO: log/metric

    const changes: OddsLineChange[] = [];
    for (const [eventId, ev] of Object.entries(parsed.data.events ?? {})) {
      if (msg.channel === 'snapshot') this._seen.get(msg.taskId)?.add(eventId);
      if (ev === null) {
        if (this._routes.get(eventId)?.taskId === msg.taskId)
          changes.push(...this._removeEvent(eventId));
        continue;
      }
      if (ev.desc) {
        const sport = SPTPUB_SPORTS[ev.desc.sport];
        const [c1, c2] = ev.desc.competitors;
        if (sport && !ev.desc.virtual && ev.desc.type === 'match' && c1 && c2)
          this._routes.set(eventId, {
            sport,
            teams: [this._teams.resolve(c1.name), this._teams.resolve(c2.name)],
            startsAt: ev.desc.scheduled * 1000,
            taskId: msg.taskId,
            phase,
          });
      }
      const route = this._routes.get(eventId);
      if (!route || !ev.markets || route.taskId !== msg.taskId) continue;

      for (const [marketId, specs] of Object.entries(ev.markets)) {
        const map = SPTPUB_MARKETS[marketId];
        if (!map) continue;
        const key = MatchKey.of({
          sport: route.sport,
          teamX: route.teams[0],
          teamY: route.teams[1],
          market: map.market,
        });
        const cacheKey = `${eventId}|${marketId}`;
        const outs = specs?.[map.specifier];

        if (specs === null || outs === null || outs === undefined) {
          if (specs === null || outs === null) {
            this._last.delete(cacheKey);
            changes.push({
              type: 'remove',
              key,
              tenant: this.tenant,
              phase: route.phase,
            });
          }
          continue;
        }

        const cache =
          this._last.get(cacheKey) ?? new Map<string, SptPubOutcomeDTO>();
        for (const [oid, o] of Object.entries(outs)) if (o) cache.set(oid, o);
        this._last.set(cacheKey, cache);

        const o1 = cache.get(map.outcomes[0]);
        const o2 = cache.get(map.outcomes[1]);
        if (!o1 || !o2) continue;

        // đưa odds về thứ tự đội của MatchKey (alphabet), bất kể home/away
        const c1First = key.sideOf(route.teams[0]) === 0;
        const [first, second] = c1First ? [o1, o2] : [o2, o1];
        const [oidFirst, oidSecond] = c1First
          ? map.outcomes
          : [map.outcomes[1], map.outcomes[0]];
        const suspended =
          !!first.b ||
          !!second.b ||
          !(Number(first.k) > 1) || // cũng bắt NaN / chuỗi rỗng
          !(Number(second.k) > 1);

        changes.push({
          type: 'set',
          key,
          line: OddsLine.create({
            tenant: this.tenant,
            odds: suspended
              ? [1.01, 1.01]
              : [Number(first.k), Number(second.k)],
            status: suspended ? 'suspended' : 'open',
            phase: route.phase,
            updatedAt: msg.sentAt,
            startsAt: route.startsAt,
            ref: {
              e: eventId,
              m: marketId,
              s: map.specifier,
              o0: oidFirst,
              o1: oidSecond,
            },
          }),
        });
      }
    }

    // hết snapshot: trận của feed này mà không còn trong snapshot → đã biến mất trong lúc gián đoạn
    const seen = this._seen.get(msg.taskId);
    if (msg.channel === 'snapshot' && parsed.data.snapshot_complete && seen) {
      for (const [eventId, route] of this._routes)
        if (route.taskId === msg.taskId && !seen.has(eventId))
          changes.push(...this._removeEvent(eventId));
      this._seen.delete(msg.taskId);
    }
    return Promise.resolve(changes);
  }

  release(taskId: string, kind: string): Promise<OddsLineChange[]> {
    if (!FEED_PHASE[kind]) return Promise.resolve([]); // descriptor không cung cấp odds
    const changes: OddsLineChange[] = [];
    for (const [eventId, route] of this._routes)
      if (route.taskId === taskId) changes.push(...this._removeEvent(eventId));
    this._seen.delete(taskId);
    return Promise.resolve(changes);
  }

  private _removeEvent(eventId: string): OddsLineChange[] {
    const route = this._routes.get(eventId);
    this._routes.delete(eventId);
    if (!route) return [];
    return Object.entries(SPTPUB_MARKETS).map(([marketId, m]) => {
      this._last.delete(`${eventId}|${marketId}`);
      return {
        type: 'remove' as const,
        phase: route.phase,
        key: MatchKey.of({
          sport: route.sport,
          teamX: route.teams[0],
          teamY: route.teams[1],
          market: m.market,
        }),
        tenant: this.tenant,
      };
    });
  }
}
