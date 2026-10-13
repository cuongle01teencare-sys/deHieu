/** Một bảng chịu chính sách giữ lại. `purge` xóa tối đa `limit` bản ghi cũ hơn `before`. */
export interface RetentionTarget {
  readonly name: string;
  readonly retentionDays: number;
  purge(before: Date, limit: number): Promise<number>;
}

export interface RetentionTargetReport {
  readonly name: string;
  readonly retentionDays: number;
  /** Mốc: bản ghi cũ hơn thời điểm này bị xóa. */
  readonly before: number;
  readonly deleted: number;
  /** true = chạm giới hạn số lô, còn bản ghi cũ — lần chạy sau dọn tiếp. */
  readonly incomplete: boolean;
  readonly error: string | null;
}

export interface RetentionReport {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly targets: readonly RetentionTargetReport[];
}

export interface RetentionJobOptions {
  /** Số bản ghi mỗi lô (mỗi câu DELETE). */
  readonly batchSize: number;
  /** Số lô tối đa mỗi bảng mỗi lần chạy (tránh chạy quá lâu). */
  readonly maxBatches: number;
}

export const DEFAULT_RETENTION_OPTIONS: RetentionJobOptions = {
  batchSize: 5_000,
  maxBatches: 200,
};

/**
 * Dọn dữ liệu quá hạn giữ, từng bảng, theo lô nhỏ để không khóa bảng lâu.
 * Một bảng lỗi không chặn bảng khác. Giữ báo cáo lần chạy gần nhất cho admin.
 */
export class RetentionJob {
  private _last: RetentionReport | null = null;
  private _running = false;

  constructor(
    private readonly _targets: readonly RetentionTarget[],
    private readonly _opts: RetentionJobOptions = DEFAULT_RETENTION_OPTIONS,
    private readonly _now: () => number = Date.now,
  ) {}

  last(): RetentionReport | null {
    return this._last;
  }

  /** Cấu hình hiện tại (để hiển thị cả khi job chưa chạy lần nào). */
  policy(): { name: string; retentionDays: number }[] {
    return this._targets.map((t) => ({
      name: t.name,
      retentionDays: t.retentionDays,
    }));
  }

  /** Chạy một lượt; lượt trước chưa xong thì bỏ qua (trả về null). */
  async run(): Promise<RetentionReport | null> {
    if (this._running) return null;
    this._running = true;
    const startedAt = this._now();
    try {
      const targets: RetentionTargetReport[] = [];
      for (const t of this._targets) {
        const before = startedAt - t.retentionDays * 86_400_000;
        let deleted = 0;
        let batches = 0;
        let incomplete = false;
        let error: string | null = null;
        try {
          for (;;) {
            const n = await t.purge(new Date(before), this._opts.batchSize);
            deleted += n;
            if (n < this._opts.batchSize) break;
            if (++batches >= this._opts.maxBatches) {
              incomplete = true;
              break;
            }
          }
        } catch (e: unknown) {
          error = e instanceof Error ? e.message : String(e);
        }
        targets.push({
          name: t.name,
          retentionDays: t.retentionDays,
          before,
          deleted,
          incomplete,
          error,
        });
      }
      this._last = { startedAt, finishedAt: this._now(), targets };
      return this._last;
    } finally {
      this._running = false;
    }
  }
}
