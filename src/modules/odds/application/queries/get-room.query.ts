import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import { MatchKey } from '../../domain/match-key.js';
import type { OddsRoomStore } from '../odds-room.store.js';

export interface GetRoomQuery {
  readonly room: string; // room:cs2:alliance~sinners:game-winner
}

export interface RoomView {
  readonly room: string;
  readonly lines: Record<string, string>; // tenant → chuỗi kèo
}

export class GetRoomHandler implements QueryHandler<
  GetRoomQuery,
  RoomView | null
> {
  constructor(private readonly _rooms: OddsRoomStore) {}

  async execute({ room }: GetRoomQuery) {
    const key = MatchKey.parse(room);
    if (!key) return null;
    const r = await this._rooms.get(key);
    return {
      room,
      lines: Object.fromEntries([...r.lines].map(([t, l]) => [t, l.encode()])),
    };
  }
}
