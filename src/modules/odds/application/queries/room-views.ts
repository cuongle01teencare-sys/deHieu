import type { OddsLine } from '../../domain/odds-line.js';
import type { Phase } from '../../domain/phase.js';

/** Một dòng kèo đã parse để người đọc kiểm tra. */
export interface RoomLineView {
  readonly odds: readonly [number, number];
  readonly status: 'open' | 'suspended';
  readonly phase: Phase;
  readonly updatedAt: number;
  /** Bao lâu chưa cập nhật — số lớn bất thường = worker có thể đã ngừng đẩy. */
  readonly ageMs: number;
  readonly startsAt: number;
  readonly ref: Readonly<Record<string, string>>;
  /** Chuỗi gốc đang lưu trong Redis/Dragonfly. */
  readonly raw: string;
}

export const toLineView = (l: OddsLine, now: number): RoomLineView => ({
  odds: l.props.odds,
  status: l.props.status,
  phase: l.props.phase,
  updatedAt: l.props.updatedAt,
  ageMs: now - l.props.updatedAt,
  startsAt: l.props.startsAt,
  ref: l.props.ref,
  raw: l.encode(),
});
