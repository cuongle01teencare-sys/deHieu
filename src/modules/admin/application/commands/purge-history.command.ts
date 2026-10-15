import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { AuditRepository } from '../audit.repository.js';
import type { OddsTransitionRepository } from '../odds-transition.repository.js';

/** Bảng có thể xóa tay: audit log, lịch sử trạng thái dòng odds. */
export const PURGE_TARGETS = ['audit', 'odds-transitions'] as const;
export type PurgeTarget = (typeof PURGE_TARGETS)[number];

export interface PurgeHistoryCommand {
  readonly target: PurgeTarget;
  /** Xóa bản ghi cũ hơn N ngày (vd 7, 30). */
  readonly olderThanDays?: number;
  /** Xóa toàn bộ. Không dùng chung với olderThanDays. */
  readonly all?: boolean;
  /** Chỉ đếm, không xóa. */
  readonly dryRun?: boolean;
}

export interface PurgeHistoryResult {
  readonly target: PurgeTarget;
  /** Mốc: bản ghi trước thời điểm này bị xóa (ms). */
  readonly before: number;
  readonly matched: number;
  readonly deleted: number;
}

const DAY = 86_400_000;
/** Số dòng mỗi câu DELETE của audit (không khóa bảng lâu). */
const AUDIT_BATCH = 5_000;

/**
 * Xóa tay audit / lịch sử odds: cũ hơn N ngày hoặc toàn bộ. Bắt buộc chọn rõ một trong hai
 * để không lỡ tay xóa sạch. Chạy song song với chính sách giữ lại tự động (RetentionJob).
 * Lưu ý: chính yêu cầu xóa audit cũng được ghi lại vào audit (sau khi xóa xong).
 */
export class PurgeHistoryHandler implements CommandHandler<
  PurgeHistoryCommand,
  OperationStatus<PurgeHistoryResult>
> {
  constructor(
    private readonly _audit: AuditRepository,
    private readonly _transitions: OddsTransitionRepository,
    private readonly _now: () => number = Date.now,
  ) {}

  async execute(
    c: PurgeHistoryCommand,
  ): Promise<OperationStatus<PurgeHistoryResult>> {
    const days = c.olderThanDays;
    if (c.all && days !== undefined)
      return fail(
        'PURGE_SCOPE_CONFLICT: chọn olderThanDays hoặc all, không chọn cả hai',
      );
    if (!c.all && days === undefined)
      return fail('PURGE_SCOPE_REQUIRED: chọn olderThanDays hoặc all = true');
    if (days !== undefined && !(Number.isInteger(days) && days >= 1))
      return fail('PURGE_DAYS_INVALID: olderThanDays phải là số nguyên ≥ 1');

    const now = this._now();
    // toàn bộ = mọi bản ghi tới thời điểm hiện tại (bản ghi mới ghi sau đó vẫn giữ)
    const before = c.all ? now + 1 : now - days! * DAY;
    const at = new Date(before);
    const matched = await this._count(c.target, at);
    if (c.dryRun || !matched)
      return ok({ target: c.target, before, matched, deleted: 0 });

    let deleted = 0;
    if (c.target === 'audit') {
      for (;;) {
        const n = await this._audit.purgeOlderThan(at, AUDIT_BATCH);
        deleted += n;
        if (n < AUDIT_BATCH) break;
      }
    } else deleted = await this._transitions.deleteOlderThan(at);
    return ok({ target: c.target, before, matched, deleted });
  }

  private _count(target: PurgeTarget, before: Date): Promise<number> {
    const before1 = new Date(before.getTime() - 1); // repo lọc ≤, xóa lọc <
    return target === 'audit'
      ? this._audit.count({ to: before1, limit: 1, offset: 0 })
      : this._transitions.count({ until: before1, limit: 1, offset: 0 });
  }
}

const ok = <T>(data: T) => ({ status: 'SUCEED' as const, data });
const fail = (reason: string) => ({ status: 'FAILED' as const, reason });
