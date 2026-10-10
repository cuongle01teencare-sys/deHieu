import type { MatchKey } from '../domain/match-key.js';
import type { OddsLine } from '../domain/odds-line.js';
import type { OddsRoom } from '../domain/odds-room.js';

/** Port: nơi giữ room (Redis/Dragonfly Hash, in-memory...). */
export interface OddsRoomStore {
  setLine(key: MatchKey, line: OddsLine): Promise<void>;
  removeLine(key: MatchKey, tenant: string): Promise<void>;
  get(key: MatchKey): Promise<OddsRoom>;
  /** Mọi room hiện có — dùng cho quan sát/kiểm chứng (số room cỡ trăm–nghìn). */
  list(): Promise<OddsRoom[]>;
}

export const ODDS_ROOM_STORE = Symbol('ODDS_ROOM_STORE');
