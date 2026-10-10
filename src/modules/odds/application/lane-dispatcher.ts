import type { OddsLineApplier } from './odds-line-applier.js';
import type { OddsLineChange } from './raw-odds.translator.js';

export interface LaneStats {
  /** '<tenant>:<phase>', vd 'sptpub:live'. */
  readonly lane: string;
  /** Số thay đổi đang chờ xử lý. */
  readonly queued: number;
  readonly processed: number;
  /** Số cập nhật bị gộp (bỏ bản cũ vì đã có bản mới hơn cho cùng room + tenant). */
  readonly coalesced: number;
  readonly busy: boolean;
  readonly lastProcessedAt: number | null;
}

interface Lane {
  pending: Map<string, OddsLineChange>;
  waiters: (() => void)[];
  busy: boolean;
  processed: number;
  coalesced: number;
  lastProcessedAt: number | null;
}

/**
 * Application service: mỗi (tenant × phase) một làn xử lý độc lập.
 *  - Các làn chạy song song (xen kẽ ở mỗi lượt I/O), làn này dồn không chặn làn khác.
 *  - Trong một làn, khi đang bận, các cập nhật cùng room + tenant được gộp: chỉ giữ bản mới nhất.
 *    Nhờ vậy live bắn giá dày cũng không tạo hàng đợi dài, và không dìm prematch.
 */
export class LaneDispatcher {
  private readonly _lanes = new Map<string, Lane>();

  constructor(
    private readonly _applier: OddsLineApplier,
    private readonly _onError: (lane: string, e: unknown) => void = () =>
      undefined,
  ) {}

  /** Đưa thay đổi vào đúng làn. Promise xong khi lượt xử lý chứa các thay đổi này hoàn tất. */
  submit(changes: readonly OddsLineChange[]): Promise<void> {
    const byLane = new Map<string, OddsLineChange[]>();
    for (const c of changes) {
      const phase = c.type === 'set' ? c.line.props.phase : c.phase;
      const tenant = c.type === 'set' ? c.line.props.tenant : c.tenant;
      const id = `${tenant}:${phase}`;
      byLane.set(id, [...(byLane.get(id) ?? []), c]);
    }
    return Promise.all(
      [...byLane].map(([id, list]) => this._enqueue(id, list)),
    ).then(() => undefined);
  }

  stats(): LaneStats[] {
    return [...this._lanes].map(([lane, l]) => ({
      lane,
      queued: l.pending.size,
      processed: l.processed,
      coalesced: l.coalesced,
      busy: l.busy,
      lastProcessedAt: l.lastProcessedAt,
    }));
  }

  private _enqueue(id: string, changes: OddsLineChange[]): Promise<void> {
    const lane = this._lanes.get(id) ?? {
      pending: new Map<string, OddsLineChange>(),
      waiters: [],
      busy: false,
      processed: 0,
      coalesced: 0,
      lastProcessedAt: null,
    };
    this._lanes.set(id, lane);

    for (const c of changes) {
      const tenant = c.type === 'set' ? c.line.props.tenant : c.tenant;
      const k = `${c.key.toString()}|${tenant}`;
      if (lane.pending.has(k)) lane.coalesced++;
      lane.pending.delete(k); // giữ thứ tự theo bản mới nhất
      lane.pending.set(k, c);
    }

    const done = new Promise<void>((resolve) => lane.waiters.push(resolve));
    if (!lane.busy) void this._drain(id, lane);
    return done;
  }

  private async _drain(id: string, lane: Lane): Promise<void> {
    lane.busy = true;
    try {
      while (lane.pending.size > 0) {
        const batch = [...lane.pending.values()];
        const waiters = lane.waiters;
        lane.pending = new Map();
        lane.waiters = [];
        try {
          await this._applier.apply(batch);
        } catch (e: unknown) {
          this._onError(id, e);
        }
        lane.processed += batch.length;
        lane.lastProcessedAt = Date.now();
        waiters.forEach((w) => w());
      }
    } finally {
      lane.busy = false;
    }
  }
}
