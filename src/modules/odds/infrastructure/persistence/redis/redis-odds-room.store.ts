import type { Redis } from 'ioredis';
import type { OddsRoomStore } from '../../../application/odds-room.store.js';
import { MatchKey } from '../../../domain/match-key.js';
import { OddsLine } from '../../../domain/odds-line.js';
import { OddsRoom } from '../../../domain/odds-room.js';

/**
 * Room = 1 Hash: key `room:{sport}:{a}~{b}:{market}`, field = tenant, value = chuỗi kèo.
 * Không TTL; Hash rỗng tự biến mất khi field cuối bị HDEL.
 */
export class RedisOddsRoomStore implements OddsRoomStore {
  constructor(private readonly _redis: Redis) {}

  async setLine(key: MatchKey, line: OddsLine): Promise<void> {
    await this._redis.hset(key.toString(), line.props.tenant, line.encode());
  }

  async removeLine(key: MatchKey, tenant: string): Promise<void> {
    await this._redis.hdel(key.toString(), tenant);
  }

  async get(key: MatchKey): Promise<OddsRoom> {
    return this._toRoom(key, await this._redis.hgetall(key.toString()));
  }

  /** SCAN (không chặn server như KEYS) rồi HGETALL theo lô bằng pipeline. */
  async list(): Promise<OddsRoom[]> {
    const ids = new Set<string>();
    let cursor = '0';
    do {
      const [next, batch] = await this._redis.scan(
        cursor,
        'MATCH',
        'room:*',
        'COUNT',
        1000,
      );
      cursor = next;
      batch.forEach((id) => ids.add(id));
    } while (cursor !== '0');

    const keys = [...ids]
      .map((id) => MatchKey.parse(id))
      .filter((k): k is MatchKey => k !== null);
    const rooms: OddsRoom[] = [];
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500);
      const pipe = this._redis.pipeline();
      chunk.forEach((k) => pipe.hgetall(k.toString()));
      const res = (await pipe.exec()) ?? [];
      chunk.forEach((k, j) => {
        const [err, raw] = res[j] ?? [];
        if (!err && raw)
          rooms.push(this._toRoom(k, raw as Record<string, string>));
      });
    }
    return rooms;
  }

  private _toRoom(key: MatchKey, raw: Record<string, string>): OddsRoom {
    const lines = new Map<string, OddsLine>();
    for (const [tenant, value] of Object.entries(raw)) {
      const line = OddsLine.decode(tenant, value);
      if (line) lines.set(tenant, line);
    }
    return new OddsRoom(key, lines);
  }
}
