import type { Redis } from 'ioredis';
import type { OddsRoomStore } from '../../../application/odds-room.store.js';
import type { MatchKey } from '../../../domain/match-key.js';
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
    const raw = await this._redis.hgetall(key.toString());
    const lines = new Map<string, OddsLine>();
    for (const [tenant, value] of Object.entries(raw)) {
      const line = OddsLine.decode(tenant, value);
      if (line) lines.set(tenant, line);
    }
    return new OddsRoom(key, lines);
  }
}
