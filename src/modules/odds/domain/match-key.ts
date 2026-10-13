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

  /**
   * `team` có đứng ở teams[0] khi ghép với `other` không — cùng quy tắc sắp với of().
   * Translator cần biết trước khi tạo key, vì market (vd mức chấp) quy theo teams[0].
   */
  static isFirst(team: string, other: string): boolean {
    return [team, other].sort()[0] === team;
  }

  /** room:cs2:alliance~sinners:game-winner */
  static parse(raw: string): MatchKey | null {
    const m = /^room:([^:]+):([^~:]+)~([^:]+):([^:]+)$/.exec(raw);
    if (!m) return null;
    return new MatchKey(m[1], [m[2], m[3]], m[4] as MarketType);
  }

  /** Id của trận (bỏ market): 'cs2:alliance~sinners'. Mọi room cùng trận có chung id này. */
  matchId(): string {
    return `${this.sport}:${this.teams[0]}~${this.teams[1]}`;
  }

  /** Cùng trận, market khác. */
  withMarket(market: MarketType): MatchKey {
    return new MatchKey(this.sport, this.teams, market);
  }

  /** 'cs2:alliance~sinners' → { sport, teams }; sai dạng → null. */
  static parseMatchId(
    raw: string,
  ): { sport: string; teams: readonly [string, string] } | null {
    const m = /^([^:~]+):([^~:]+)~([^:~]+)$/.exec(raw);
    return m && m[2] < m[3] ? { sport: m[1], teams: [m[2], m[3]] } : null;
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
