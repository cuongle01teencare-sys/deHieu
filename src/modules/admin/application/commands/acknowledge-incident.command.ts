import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { Incident } from '../../domain/incident.js';
import type { IncidentTracker } from '../incident-tracker.js';

export interface AcknowledgeIncidentCommand {
  readonly key: string;
  readonly by: string;
}

/** Xác nhận đã biết sự cố đang mở (sự cố vẫn mở tới khi hết thật). */
export class AcknowledgeIncidentHandler implements CommandHandler<
  AcknowledgeIncidentCommand,
  OperationStatus<Incident>
> {
  constructor(private readonly _tracker: IncidentTracker) {}

  execute({ key, by }: AcknowledgeIncidentCommand) {
    const r = this._tracker.acknowledge(key, by);
    return Promise.resolve<OperationStatus<Incident>>(
      r ? { status: 'SUCEED', data: r } : { status: 'NOT_FOUND' },
    );
  }
}
