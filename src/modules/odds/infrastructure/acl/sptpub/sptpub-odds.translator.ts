import type { TaskDataMessage } from '../../../../tasks/application/task-protocol.js';
import type {
  OddsLineChange,
  RawOddsTranslator,
} from '../../../application/raw-odds.translator.js';
import type { TeamNameResolver } from '../../../application/team-name.resolver.js';
import {
  NO_SKIP_REPORTER,
  type SkipReporter,
} from '../../../application/ingest-stats.js';
import { MatchKey } from '../../../domain/match-key.js';
import { OddsLine } from '../../../domain/odds-line.js';
import type { Phase } from '../../../domain/phase.js';
import { SptPubFeedSchema, type SptPubOutcomeDTO } from './sptpub-feed.dto.js';
import { SPTPUB_MARKETS, SPTPUB_SPORTS } from './sptpub-odds.mapping.js';
import { SptPubSourceLinks } from './sptpub-source-links.js';

const FEED_PHASE: Readonly<Record<string, Phase>> = {
  'sptpub.live': 'live',
  'sptpub.prematch': 'prematch',
};

interface Route {
  sport: string;
  teams: readonly [string, string]; // competitor1, competitor2 (đã chuẩn hóa)
  startsAt: number;
  /** Feed (task) sở hữu trận: live và prematch cùng gửi một trận khi trận chuyển sang live. */
  taskId: string;
  phase: Phase;
  sourceDesc: unknown;
}

/** Một (market, specifier) đã ghi vào room — nhớ để cập nhật delta và để gỡ đúng room. */
interface Book {
  key: MatchKey;
  phase: Phase;
  /** outcomeId → outcome mới nhất (delta có thể chỉ gửi 1 outcome). */
  outcomes: Map<string, SptPubOutcomeDTO>;
}

/**
 * ACL sptpub. Delta chỉ mang eventId nên phải giữ bảng định tuyến eventId → trận
 * (lấy từ `desc` ở snapshot). Bảng này nằm trong RAM, tự dựng lại khi snapshot về.
 * Một market có thể có nhiều specifier (vd "hcp=-1.5", "hcp=2.5"); mỗi specifier → một room.
 */
export class SptPubOddsTranslator implements RawOddsTranslator {
  readonly tenant = 'sptpub';
  readonly kinds = [
    'sptpub.descriptor',
    'sptpub.live',
    'sptpub.prematch',
  ] as const;
  private readonly _routes = new Map<string, Route>();
  /** eventId → `${marketId}|${specifier}` → sổ kèo đã phát. */
  private readonly _books = new Map<string, Map<string, Book>>();
  /** taskId → eventId đã thấy trong lần snapshot đang chạy (để dọn trận đã biến mất). */
  private readonly _seen = new Map<string, Set<string>>();
  private readonly _sourceLinks = new Map<string, SptPubSourceLinks>();

  constructor(
    private readonly _teams: TeamNameResolver,
    /** Báo dữ liệu bị bỏ qua (theo lý do) cho bộ đếm ingest. */
    private readonly _skip: SkipReporter = NO_SKIP_REPORTER,
  ) {}

  translate(msg: TaskDataMessage): Promise<OddsLineChange[]> {
    const phase = FEED_PHASE[msg.kind];
    if (!phase) return Promise.resolve([]); // descriptor: chưa dùng tới
    if (msg.channel === 'snapshot-start') {
      this._seen.set(msg.taskId, new Set());
      this._sourceLinks.delete(msg.taskId);
      return Promise.resolve([]);
    }
    const parsed = SptPubFeedSchema.safeParse(msg.payload);
    if (!parsed.success) {
      this._skip(msg.kind, 'parse_failed');
      return Promise.resolve([]);
    }

    const sourceLinks =
      this._sourceLinks.get(msg.taskId) ?? new SptPubSourceLinks();
    sourceLinks.update(parsed.data);
    this._sourceLinks.set(msg.taskId, sourceLinks);
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
        if (!sport) this._skip(msg.kind, 'unsupported_sport');
        else if (ev.desc.virtual || ev.desc.type !== 'match' || !c1 || !c2)
          this._skip(msg.kind, 'invalid_event');
        else
          this._routes.set(eventId, {
            sport,
            teams: [this._teams.resolve(c1.name), this._teams.resolve(c2.name)],
            startsAt: ev.desc.scheduled * 1000,
            taskId: msg.taskId,
            phase,
            sourceDesc: ev.desc,
          });
      }
      const route = this._routes.get(eventId);
      if (!route || !ev.markets || route.taskId !== msg.taskId) continue;
      if (!route.teams[0] || route.teams[0] === route.teams[1]) {
        this._skip(msg.kind, 'same_team_names');
        continue;
      }

      // competitor1 có phải teams[0] của room không: quyết định thứ tự odds (market theo đội) và dấu mức chấp
      const c1First = MatchKey.isFirst(route.teams[0], route.teams[1]);
      const books = this._books.get(eventId) ?? new Map<string, Book>();
      this._books.set(eventId, books);

      for (const [marketId, specs] of Object.entries(ev.markets)) {
        const map = SPTPUB_MARKETS[marketId];
        if (!map) {
          this._skip(msg.kind, 'unsupported_market');
          continue;
        }

        if (specs === null) {
          // cả market bị gỡ → gỡ mọi specifier đã phát của market này
          for (const [id, book] of books)
            if (id.startsWith(`${marketId}|`)) {
              books.delete(id);
              changes.push(this._remove(book));
            }
          continue;
        }

        for (const [spec, outs] of Object.entries(specs)) {
          const market = map.toMarket(spec, c1First);
          if (!market) {
            this._skip(msg.kind, 'unsupported_line'); // specifier/mức không hỗ trợ
            continue;
          }
          const id = `${marketId}|${spec}`;

          if (outs === null) {
            const book = books.get(id);
            if (book) {
              books.delete(id);
              changes.push(this._remove(book));
            }
            continue;
          }

          const key = MatchKey.of({
            sport: route.sport,
            teamX: route.teams[0],
            teamY: route.teams[1],
            market,
          });
          const book = books.get(id) ?? {
            key,
            phase: route.phase,
            outcomes: new Map<string, SptPubOutcomeDTO>(),
          };
          book.phase = route.phase;
          books.set(id, book);
          for (const [oid, o] of Object.entries(outs))
            if (o) book.outcomes.set(oid, o);

          const o1 = book.outcomes.get(map.outcomes[0]);
          const o2 = book.outcomes.get(map.outcomes[1]);
          if (!o1 || !o2) continue;

          // outcome theo đội → đưa về thứ tự đội của MatchKey (alphabet), bất kể home/away;
          // outcome theo phía (over/under) → giữ nguyên
          const keep = map.outcomesBy === 'side' || c1First;
          const [first, second] = keep ? [o1, o2] : [o2, o1];
          const [oidFirst, oidSecond] = keep
            ? map.outcomes
            : [map.outcomes[1], map.outcomes[0]];
          const suspended =
            !!first.b ||
            !!second.b ||
            !(Number(first.k) > 1) || // cũng bắt NaN / chuỗi rỗng
            !(Number(second.k) > 1);

          const sourceUrl = sourceLinks.eventUrl(eventId, route.sourceDesc);
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
                s: spec,
                o0: oidFirst,
                o1: oidSecond,
                ...(sourceUrl ? { url: sourceUrl } : {}),
              },
            }),
          });
        }
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
    this._sourceLinks.delete(taskId);
    return Promise.resolve(changes);
  }

  /** Gỡ trận: mọi room mà trận này đã thực sự ghi vào. */
  private _removeEvent(eventId: string): OddsLineChange[] {
    this._routes.delete(eventId);
    const books = this._books.get(eventId);
    this._books.delete(eventId);
    return books ? [...books.values()].map((b) => this._remove(b)) : [];
  }

  private _remove(b: Book): OddsLineChange {
    return { type: 'remove', key: b.key, tenant: this.tenant, phase: b.phase };
  }
}
