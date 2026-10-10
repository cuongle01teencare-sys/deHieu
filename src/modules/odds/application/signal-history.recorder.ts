import type { EventPublisher } from '../../../shared/application/event-publisher.js';
import type { DomainEvent } from '../../../shared/domain/domain-event.js';
import {
  ArbitrageSignalCancelled,
  ArbitrageSignalIssued,
  ArbitrageSignalRefreshed,
} from '../domain/events/arbitrage-signal.events.js';
import type { SignalHistoryRepository } from './signal-history.repository.js';

type Job = () => Promise<void>;

/**
 * Ghi lịch sử kèo vào DB ở NỀN: publish() chỉ xếp việc vào hàng đợi rồi trả về ngay,
 * nên DB chậm/lỗi không làm trễ việc gửi kèo cho consumer.
 * Hàng đợi có giới hạn; vượt giới hạn thì bỏ việc cũ nhất và báo lỗi.
 */
export class SignalHistoryRecorder implements EventPublisher {
  private readonly _queue: Job[] = [];
  private _running = false;
  private _dropped = 0;

  constructor(
    private readonly _repo: SignalHistoryRepository,
    private readonly _onError: (e: unknown) => void = () => undefined,
    private readonly _maxQueue = 10_000,
  ) {}

  publish(events: readonly DomainEvent[]): Promise<void> {
    for (const e of events) {
      const job = this._toJob(e);
      if (job) this._push(job);
    }
    return Promise.resolve();
  }

  /** Chờ ghi hết (dùng khi tắt app hoặc trong test). */
  async flush(): Promise<void> {
    while (this._running || this._queue.length)
      await new Promise((r) => setTimeout(r, 5));
  }

  stats() {
    return { queued: this._queue.length, dropped: this._dropped };
  }

  private _toJob(e: DomainEvent): Job | null {
    const at = e.occurredAt;
    if (e instanceof ArbitrageSignalIssued) {
      const s = e.signal;
      return async () => {
        await this._repo.insert({
          signalId: s.signalId,
          room: s.room,
          sport: s.sport,
          market: s.market,
          phase: s.phase,
          comboId: s.comboId,
          teams: s.teams,
          margin: s.margin,
          legs: s.legs,
          issuedAt: new Date(s.issuedAt),
          expiresAt: new Date(s.expiresAt),
          refreshCount: 0,
          lastRefreshedAt: null,
          status: 'active',
          statusReason: null,
          closedAt: null,
          supersededBy: null,
        });
        if (e.supersedes)
          await this._repo.close(
            e.supersedes,
            'superseded',
            null,
            at,
            s.signalId,
          );
      };
    }
    if (e instanceof ArbitrageSignalRefreshed)
      return () =>
        this._repo.markRefreshed(
          e.signal.signalId,
          new Date(e.signal.expiresAt),
          at,
        );
    if (e instanceof ArbitrageSignalCancelled)
      return () => this._repo.close(e.signalId, 'cancelled', e.reason, at);
    return null;
  }

  private _push(job: Job) {
    if (this._queue.length >= this._maxQueue) {
      this._queue.shift();
      this._dropped++;
      this._onError(
        new Error(`hàng đợi lịch sử kèo đầy, đã bỏ ${this._dropped} việc`),
      );
    }
    this._queue.push(job);
    if (!this._running) void this._drain();
  }

  private async _drain() {
    this._running = true;
    try {
      for (let job = this._queue.shift(); job; job = this._queue.shift()) {
        try {
          await job();
        } catch (e: unknown) {
          this._onError(e);
        }
      }
    } finally {
      this._running = false;
    }
  }
}
