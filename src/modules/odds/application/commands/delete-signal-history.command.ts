import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { SignalStatus } from '../../domain/signal-history.js';
import type { SignalHistoryRepository } from '../signal-history.repository.js';

export interface PurgeSignalHistoryManualCommand {
  /** Trạng thái được xóa; bỏ trống = mọi trạng thái đã kết thúc. Kèo đang sống không bao giờ bị xóa. */
  readonly statuses?: readonly Exclude<SignalStatus, 'active'>[];
  /** Xóa kèo phát cũ hơn N ngày. */
  readonly olderThanDays?: number;
  /** Xóa toàn bộ (khớp trạng thái). Không dùng chung với olderThanDays. */
  readonly all?: boolean;
  /** Chỉ đếm. */
  readonly dryRun?: boolean;
}

export interface PurgeSignalHistoryManualResult {
  readonly before: number;
  readonly matched: number;
  readonly deleted: number;
}

const DAY = 86_400_000;
const BATCH = 5_000;

/**
 * Xóa tay lịch sử kèo: theo trạng thái, cũ hơn N ngày hoặc toàn bộ; xóa từng kèo.
 * Kèo còn sống (active) giữ nguyên để vòng đời của nó vẫn ghi đúng.
 */
export class DeleteSignalHistoryHandler {
  constructor(
    private readonly _repo: SignalHistoryRepository,
    private readonly _now: () => number = Date.now,
  ) {}

  async purge(
    c: PurgeSignalHistoryManualCommand,
  ): Promise<OperationStatus<PurgeSignalHistoryManualResult>> {
    const days = c.olderThanDays;
    if (c.all && days !== undefined)
      return {
        status: 'FAILED',
        reason:
          'PURGE_SCOPE_CONFLICT: chọn olderThanDays hoặc all, không chọn cả hai',
      };
    if (!c.all && days === undefined)
      return {
        status: 'FAILED',
        reason: 'PURGE_SCOPE_REQUIRED: chọn olderThanDays hoặc all = true',
      };
    if (days !== undefined && !(Number.isInteger(days) && days >= 1))
      return {
        status: 'FAILED',
        reason: 'PURGE_DAYS_INVALID: olderThanDays phải là số nguyên ≥ 1',
      };
    const now = this._now();
    const before = c.all ? now + 1 : now - days! * DAY;
    const f = { statuses: c.statuses, before: new Date(before) };
    const matched = await this._repo.countPurgeable(f);
    if (c.dryRun || !matched)
      return { status: 'SUCEED', data: { before, matched, deleted: 0 } };
    let deleted = 0;
    for (;;) {
      const n = await this._repo.purge(f, BATCH);
      deleted += n;
      if (n < BATCH) break;
    }
    return { status: 'SUCEED', data: { before, matched, deleted } };
  }

  async deleteOne(
    signalId: string,
  ): Promise<OperationStatus<{ deleted: true }>> {
    const r = await this._repo.deleteOne(signalId);
    if (r === 'NOT_FOUND') return { status: 'NOT_FOUND' };
    if (r === 'ACTIVE')
      return {
        status: 'FAILED',
        reason: 'SIGNAL_ACTIVE: kèo đang sống, chưa xóa được',
      };
    return { status: 'SUCEED', data: { deleted: true } };
  }
}
