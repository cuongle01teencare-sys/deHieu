import type { AdminSources } from './admin-sources.js';

export interface AdminMetrics {
  readonly at: number;
  readonly evaluator: Awaited<
    ReturnType<AdminSources['arbitrage']>
  >['evaluator'];
  readonly activeSignals: number;
  /** Tổng quan room (làm mới chậm hơn vì phải quét store). */
  readonly rooms: Awaited<ReturnType<AdminSources['arbitrage']>>['rooms'];
  readonly roomsAt: number;
  readonly lanes: Awaited<ReturnType<AdminSources['lanes']>>;
  readonly consumers: { total: number; connected: number; pending: number };
  readonly tasks: Readonly<Record<string, number>>; // state → số task
}

/**
 * Số liệu gộp cho stream (mỗi ~2s). Phần quét room tốn kém nên chỉ làm mới
 * mỗi `roomsRefreshMs`, các phần khác lấy mới mỗi lần.
 */
export class MetricsSampler {
  private _cache: {
    at: number;
    data: Awaited<ReturnType<AdminSources['arbitrage']>>;
  } | null = null;

  constructor(
    private readonly _src: AdminSources,
    private readonly _roomsRefreshMs = 10_000,
    private readonly _now: () => number = Date.now,
  ) {}

  async sample(): Promise<AdminMetrics> {
    const now = this._now();
    if (!this._cache || now - this._cache.at >= this._roomsRefreshMs)
      this._cache = { at: now, data: await this._src.arbitrage() };
    const [lanes, tasks] = await Promise.all([
      this._src.lanes(),
      this._src.tasks(),
    ]);
    const consumers = this._src.consumers();
    const byState: Record<string, number> = {};
    for (const t of tasks) byState[t.state] = (byState[t.state] ?? 0) + 1;
    return {
      at: now,
      evaluator: this._cache.data.evaluator,
      activeSignals: this._cache.data.activeSignals,
      rooms: this._cache.data.rooms,
      roomsAt: this._cache.at,
      lanes,
      consumers: {
        total: consumers.length,
        connected: consumers.filter((c) => c.connected).length,
        pending: consumers.reduce((n, c) => n + c.pending, 0),
      },
      tasks: byState,
    };
  }
}
