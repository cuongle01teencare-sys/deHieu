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
  Incident[]
> {
  constructor(
    private readonly _repo: IncidentRepository,
    private readonly _tracker: IncidentTracker,
  ) {}

  execute(q: IncidentQuery): Promise<Incident[]> {
    if (q.open === true)
      return Promise.resolve(
        this._tracker
          .open()
          .filter((i) => !q.kind || i.kind === q.kind)
          .slice(q.offset, q.offset + q.limit),
      );
    return this._repo.list(q);
  }
}
