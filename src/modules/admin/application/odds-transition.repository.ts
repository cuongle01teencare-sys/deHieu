import type { OddsTransition } from '../domain/odds-transition.js';

export interface OddsTransitionQuery {
  readonly room?: string;
  readonly tenant?: string;
  readonly to?: string;
  readonly from?: Date;
  readonly until?: Date;
  readonly limit: number;
  readonly offset: number;
}

export interface OddsTransitionRepository {
  insertMany(entries: readonly OddsTransition[]): Promise<void>;
  list(q: OddsTransitionQuery): Promise<OddsTransition[]>;
  /** Dọn bản ghi cũ hơn mốc (giới hạn thời gian giữ). Trả về số dòng đã xóa. */
  deleteOlderThan(before: Date): Promise<number>;
}

export const ODDS_TRANSITION_REPOSITORY = Symbol('ODDS_TRANSITION_REPOSITORY');
