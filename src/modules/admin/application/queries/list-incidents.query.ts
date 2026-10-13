import type { Page } from '../../../../shared/application/page.js';
import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { Incident } from '../../domain/incident.js';
import type {
  IncidentQuery,
  IncidentRepository,
} from '../incident.repository.js';
import type { IncidentTracker } from '../incident-tracker.js';

/** open=true → lấy từ bộ nhớ (luôn đúng hiện tại); còn lại → lịch sử trong DB. */
export class ListIncidentsHandler implements QueryHandler<
  IncidentQuery,
  Page<Incident>
> {
  constructor(
    private readonly _repo: IncidentRepository,
    private readonly _tracker: IncidentTracker,
  ) {}

  async execute(q: IncidentQuery): Promise<Page<Incident>> {
    if (q.open === true) {
      const open = this._tracker
        .open()
        .filter((i) => !q.kind || i.kind === q.kind);
      return {
        total: open.length,
        items: open.slice(q.offset, q.offset + q.limit),
      };
    }
    const [items, total] = await Promise.all([
      this._repo.list(q),
      this._repo.count(q),
    ]);
    return { total, items };
  }
}
