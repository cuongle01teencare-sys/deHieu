import { randomUUID } from 'node:crypto';
import type { OpsEventBus } from '../../../shared/application/ops-event-bus.js';
import type { Incident, IncidentSignal } from '../domain/incident.js';
import type { AlertNotifier } from './alert-notifier.js';
import type { BackgroundQueue } from './background-queue.js';
import type { IncidentRepository } from './incident.repository.js';

export interface IncidentTrackerOptions {
  /** Sự cố cùng key mở lại trong khoảng này sau lần báo trước → ghi nhận nhưng KHÔNG báo lại (chống spam khi chập chờn). */
  readonly renotifyCooldownMs: number;
}

/**
 * Mở / giữ / đóng sự cố theo key. Gọi raise() mỗi lần kiểm tra thấy lỗi, clear() khi hết:
 * chỉ lần chuyển trạng thái mới ghi DB, phát sự kiện và báo ra ngoài.
 */
export class IncidentTracker {
  private readonly _open = new Map<string, Incident>();
  /** key → lần gần nhất đã báo "opened" (để áp cooldown). */
  private readonly _lastNotified = new Map<string, number>();
  /** key của sự cố đang mở mà đã được báo ra ngoài (để báo "resolved" tương ứng). */
  private readonly _notified = new Set<string>();

  constructor(
    private readonly _repo: IncidentRepository,
    private readonly _notifier: AlertNotifier,
    private readonly _ops: OpsEventBus,
    private readonly _queue: BackgroundQueue,
    private readonly _opts: IncidentTrackerOptions = {
      renotifyCooldownMs: 5 * 60_000,
    },
    private readonly _now: () => number = Date.now,
  ) {}

  /** Đóng sự cố còn mở từ lần chạy trước. */
  init(): Promise<number> {
    return this._repo.closeAllOpen(this._now(), 'app_restart');
  }

  open(): Incident[] {
    return [...this._open.values()].sort((a, b) => b.openedAt - a.openedAt);
  }

  isOpen(key: string): boolean {
    return this._open.has(key);
  }

  openKeys(): string[] {
    return [...this._open.keys()];
  }

  raise(key: string, s: IncidentSignal): void {
    const now = this._now();
    const current = this._open.get(key);
    if (current) {
      const changed =
        current.severity !== s.severity || current.message !== s.message;
      const next: Incident = {
        ...current,
        severity: s.severity,
        title: s.title,
        message: s.message,
        details: s.details ?? current.details,
        lastSeenAt: now,
      };
      this._open.set(key, next);
      if (changed) this._persist(next);
      return;
    }

    const incident: Incident = {
      id: randomUUID(),
      key,
      kind: s.kind,
      severity: s.severity,
      title: s.title,
      message: s.message,
      details: s.details ?? {},
      openedAt: now,
      lastSeenAt: now,
      resolvedAt: null,
      resolution: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
    };
    this._open.set(key, incident);
    this._persist(incident);
    this._publish('incident.opened', incident);

    const last = this._lastNotified.get(key);
    if (last === undefined || now - last >= this._opts.renotifyCooldownMs) {
      this._lastNotified.set(key, now);
      this._notified.add(key);
      void this._notifier.notify('opened', incident);
    }
  }

  clear(key: string, resolution = 'recovered'): void {
    const current = this._open.get(key);
    if (!current) return;
    const resolved: Incident = {
      ...current,
      resolvedAt: this._now(),
      resolution,
    };
    this._open.delete(key);
    this._persist(resolved);
    this._publish('incident.resolved', resolved);
    if (this._notified.delete(key))
      void this._notifier.notify('resolved', resolved);
  }

  /** Người vận hành đã biết: ghi nhận, sự cố vẫn mở tới khi hết thật. */
  acknowledge(key: string, by: string): Incident | null {
    const current = this._open.get(key);
    if (!current) return null;
    const acked: Incident = {
      ...current,
      acknowledgedAt: this._now(),
      acknowledgedBy: by,
    };
    this._open.set(key, acked);
    this._persist(acked);
    this._publish('incident.acknowledged', acked, by);
    return acked;
  }

  private _persist(incident: Incident) {
    this._queue.push(() => this._repo.save(incident));
  }

  private _publish(
    type: 'incident.opened' | 'incident.resolved' | 'incident.acknowledged',
    i: Incident,
    by?: string,
  ) {
    this._ops.publish({
      type,
      topic: 'alerts',
      at: this._now(),
      data: {
        key: i.key,
        kind: i.kind,
        severity: i.severity,
        title: i.title,
        message: i.message,
        ...(by ? { by } : {}),
      },
    });
  }
}
