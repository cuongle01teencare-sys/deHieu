import type { OddsRoomStore } from '../../../application/odds-room.store.js';
import { MatchKey } from '../../../domain/match-key.js';
import type { OddsLine } from '../../../domain/odds-line.js';
import { OddsRoom } from '../../../domain/odds-room.js';

/** Dev/test: thay cho Redis mà không đụng domain/use case. */
export class InMemoryOddsRoomStore implements OddsRoomStore {
  private readonly _rooms = new Map<string, Map<string, OddsLine>>();

  setLine(key: MatchKey, line: OddsLine) {
    const id = key.toString();
    const room = this._rooms.get(id) ?? new Map<string, OddsLine>();
    room.set(line.props.tenant, line);
    this._rooms.set(id, room);
    return Promise.resolve();
  }

  removeLine(key: MatchKey, tenant: string) {
    const room = this._rooms.get(key.toString());
    room?.delete(tenant);
    if (room?.size === 0) this._rooms.delete(key.toString());
    return Promise.resolve();
  }

  get(key: MatchKey) {
    return Promise.resolve(
      new OddsRoom(key, new Map(this._rooms.get(key.toString()) ?? [])),
    );
  }

  list() {
    const rooms: OddsRoom[] = [];
    for (const [id, lines] of this._rooms) {
      const key = MatchKey.parse(id);
      if (key) rooms.push(new OddsRoom(key, new Map(lines)));
    }
    return Promise.resolve(rooms);
  }

  clear() {
    const rooms = this._rooms.size;
    let lines = 0;
    for (const r of this._rooms.values()) lines += r.size;
    this._rooms.clear();
    return Promise.resolve({ rooms, lines });
  }
}
