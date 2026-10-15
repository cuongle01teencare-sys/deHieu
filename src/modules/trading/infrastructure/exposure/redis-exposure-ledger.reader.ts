import type { Redis } from 'ioredis';
import type {
  EntryRef,
  EntryUsage,
  ExposureLedgerReader,
  ExposureSnapshot,
  MatchUsage,
} from '../../application/exposure.ports.js';

/**
 * Đọc sổ phơi nhiễm mà task trader ghi (khớp định dạng khóa của RedisExposureLedger,
 * module tasks — `trade:paper`):
 *   {ns}:match:{match}                              tiền đã dùng chung theo trận
 *   {ns}:profile:{profileId}:match:{match}          tiền đã dùng riêng profile
 *   {ns}:slot:entry:{profileId}:{room}:{combo}:{tier}   số lệnh đã vào mỗi cửa mỗi hạng
 * (khóa {ns}:done:* là dấu "đã xử lý", bỏ qua).
 */
export class RedisExposureLedgerReader implements ExposureLedgerReader {
  constructor(
    private readonly _redis: Redis,
    private readonly _ns = 'trade:paper',
  ) {}

  async snapshot(): Promise<ExposureSnapshot> {
    const keys = (
      await Promise.all(
        ['match:*', 'profile:*', 'slot:entry:*'].map((p) =>
          this._scan(`${this._ns}:${p}`),
        ),
      )
    ).flat();
    const values = keys.length ? await this._redis.mget(...keys) : [];
    const ttls = await Promise.all(keys.map((k) => this._redis.pttl(k)));
    const matches = new Map<
      string,
      MatchUsage & { byProfile: MatchUsage['byProfile'][number][] }
    >();
    const entries: EntryUsage[] = [];
    const matchOf = (m: string) => {
      let cur = matches.get(m);
      if (!cur) {
        cur = { match: m, usedUsd: null, ttlMs: null, byProfile: [] };
        matches.set(m, cur);
      }
      return cur;
    };
    keys.forEach((key, i) => {
      const n = Number(values[i] ?? 0) || 0;
      const t = ttls[i] ?? -1;
      const ttlMs = t >= 0 ? t : null;
      const k = key.slice(this._ns.length + 1);
      if (k.startsWith('match:')) {
        const m = matchOf(k.slice('match:'.length));
        matches.set(m.match, { ...m, usedUsd: n, ttlMs });
      } else if (k.startsWith('profile:')) {
        const rest = k.slice('profile:'.length);
        const at = rest.indexOf(':match:');
        if (at < 0) return;
        matchOf(rest.slice(at + ':match:'.length)).byProfile.push({
          profileId: rest.slice(0, at),
          usedUsd: n,
          ttlMs,
        });
      } else if (k.startsWith('slot:entry:')) {
        const e = parseEntry(k.slice('slot:entry:'.length));
        if (e) entries.push({ ...e, count: n, ttlMs });
      }
    });
    return {
      matches: [...matches.values()].sort(
        (a, b) => (b.usedUsd ?? 0) - (a.usedUsd ?? 0),
      ),
      entries: entries.sort((a, b) => a.room.localeCompare(b.room)),
    };
  }

  async resetMatch(match: string): Promise<number> {
    const keys = [
      `${this._ns}:match:${match}`,
      ...(await this._scan(`${this._ns}:profile:*:match:${escapeGlob(match)}`)),
    ];
    return this._redis.del(...keys);
  }

  resetEntry(e: EntryRef): Promise<number> {
    return this._redis.del(
      `${this._ns}:slot:entry:${e.profileId}:${e.room}:${e.comboId}:${e.tierId}`,
    );
  }

  private async _scan(pattern: string): Promise<string[]> {
    const out: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this._redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        500,
      );
      out.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    return out;
  }
}

/** `{profileId}:{room}:{combo}:{tier}`; room chứa ':' nên tách profile từ trái, combo + tier từ phải. */
export function parseEntry(s: string): EntryRef | null {
  const first = s.indexOf(':');
  const last = s.lastIndexOf(':');
  if (first < 0 || last <= first) return null;
  const beforeTier = s.slice(0, last);
  const comboAt = beforeTier.lastIndexOf(':');
  if (comboAt <= first) return null;
  return {
    profileId: s.slice(0, first),
    room: beforeTier.slice(first + 1, comboAt),
    comboId: beforeTier.slice(comboAt + 1),
    tierId: s.slice(last + 1),
  };
}

const escapeGlob = (s: string) => s.replace(/[*?[\]\\]/g, (c) => `\\${c}`);
