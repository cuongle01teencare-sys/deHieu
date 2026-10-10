import type { OpsEventBus } from '../../../shared/application/ops-event-bus.js';
import type { OddsTransition } from '../domain/odds-transition.js';
import type { OddsTransitionRepository } from './odds-transition.repository.js';

export interface OddsTransitionRecorderOptions {
  readonly flushIntervalMs: number;
  readonly batchSize: number;
  /** Bộ đệm tối đa; đầy thì bỏ bản ghi cũ nhất. */
  readonly maxBuffer: number;
  readonly retentionMs: number;
  readonly cleanupIntervalMs: number;
}

export const DEFAULT_TRANSITION_RECORDER_OPTIONS: OddsTransitionRecorderOptions =
  {
    flushIntervalMs: 1_000,
    batchSize: 500,
    maxBuffer: 50_000,
    retentionMs: 7 * 24 * 3_600_000,
    cleanupIntervalMs: 3_600_000,
  };

/**
 * Nghe odds.transition trên bus, gom lô rồi ghi DB định kỳ (không chặn ingest).
 * Định kỳ dọn bản ghi quá hạn giữ.
 */
export class OddsTransitionRecorder {
  private _buffer: OddsTransition[] = [];
  private _dropped = 0;
  private _flushing = false;
  private _timers: ReturnType<typeof setInterval>[] = [];
  private _unsubscribe: (() => void) | null = null;

  constructor(
    private readonly _repo: OddsTransitionRepository,
    private readonly _ops: OpsEventBus,
    private readonly _onError: (e: unknown) => void,
    private readonly _opts: OddsTransitionRecorderOptions = DEFAULT_TRANSITION_RECORDER_OPTIONS,
    private readonly _now: () => number = Date.now,
  ) {}

  start(): void {
    this._unsubscribe = this._ops.subscribe((e) => {
      if (e.type !== 'odds.transition') return;
      if (this._buffer.length >= this._opts.maxBuffer) {
        this._buffer.shift();
        this._dropped++;
      }
      this._buffer.push({
        at: e.at,
        room: e.data.room,
        tenant: e.data.tenant,
        phase: e.data.phase,
        from: e.data.from,
        to: e.data.to,
        reason: e.data.reason ?? null,
      });
    });
    this._timers.push(
      setInterval(() => void this.flush(), this._opts.flushIntervalMs),
      setInterval(() => void this.cleanup(), this._opts.cleanupIntervalMs),
    );
  }

  async stop(): Promise<void> {
    this._unsubscribe?.();
    this._timers.forEach(clearInterval);
    this._timers = [];
    await this.flush();
  }

  stats() {
    return { buffered: this._buffer.length, dropped: this._dropped };
  }

  async flush(): Promise<void> {
    if (this._flushing) return;
    this._flushing = true;
    try {
      while (this._buffer.length) {
        const batch = this._buffer.slice(0, this._opts.batchSize);
        try {
          await this._repo.insertMany(batch);
          this._buffer.splice(0, batch.length);
        } catch (e: unknown) {
          this._onError(e);
          return; // giữ lại, thử ở lần sau
        }
      }
    } finally {
      this._flushing = false;
    }
  }

  async cleanup(): Promise<number> {
    try {
      return await this._repo.deleteOlderThan(
        new Date(this._now() - this._opts.retentionMs),
      );
    } catch (e: unknown) {
      this._onError(e);
      return 0;
    }
  }
}
