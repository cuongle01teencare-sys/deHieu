import { DomainError } from '../../../shared/domain/domain-error.js';
import type { MarketType } from './market-type.js';

export type Side = 0 | 1;

/**
 * Định danh room: môn + cặp đội (đã chuẩn hóa, sắp alphabet) + market.
 * Sắp theo alphabet nên home/away của từng tenant không còn quan trọng.
 */
export class MatchKey {
  private constructor(
    public readonly sport: string,
    public readonly teams: readonly [string, string],
    public readonly market: MarketType,
  ) {}

  static of(p: {
    sport: string;
    teamX: string;
    teamY: string;
    market: MarketType;
  }): MatchKey {
    if (!p.teamX || !p.teamY || p.teamX === p.teamY)
      throw new DomainError(
        `MatchKey: cặp đội không hợp lệ (${p.teamX}, ${p.teamY})`,
      );
    const teams = [p.teamX, p.teamY].sort() as [string, string];
    return new MatchKey(p.sport, teams, p.market);
  }

  /** room:cs2:alliance~sinners:game-winner */
  static parse(raw: string): MatchKey | null {
    const m = /^room:([^:]+):([^~:]+)~([^:]+):([^:]+)$/.exec(raw);
    if (!m) return null;
    return new MatchKey(m[1], [m[2], m[3]], m[4] as MarketType);
  }

  sideOf(team: string): Side | null {
    if (team === this.teams[0]) return 0;
    if (team === this.teams[1]) return 1;
    return null;
  }

  toString(): string {
    return `room:${this.sport}:${this.teams[0]}~${this.teams[1]}:${this.market}`;
  }
}
