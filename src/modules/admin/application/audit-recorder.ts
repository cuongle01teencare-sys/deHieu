import type { OpsEventBus } from '../../../shared/application/ops-event-bus.js';
import type { AuditEntry } from '../domain/audit-entry.js';
import type { AuditRepository } from './audit.repository.js';
import type { BackgroundQueue } from './background-queue.js';

/** Ghi audit (nền) và báo lên stream admin ngay. */
export class AuditRecorder {
  constructor(
    private readonly _repo: AuditRepository,
    private readonly _queue: BackgroundQueue,
    private readonly _ops: OpsEventBus,
  ) {}

  record(entry: AuditEntry): void {
    this._queue.push(() => this._repo.insert(entry));
    this._ops.publish({
      type: 'audit.recorded',
      topic: 'audit',
      at: entry.at,
      data: {
        principalId: entry.principalId,
        method: entry.method,
        route: entry.route,
        ok: entry.ok,
        status: entry.status,
      },
    });
  }
}
