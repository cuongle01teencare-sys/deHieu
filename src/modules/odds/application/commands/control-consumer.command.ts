import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { ConsumerControl } from '../consumer-control.js';

export interface ControlConsumerCommand {
  readonly consumerId: string;
  readonly action: 'pause' | 'resume';
}

export class ControlConsumerHandler implements CommandHandler<
  ControlConsumerCommand,
  OperationStatus<true>
> {
  constructor(private readonly _consumers: ConsumerControl) {}

  execute({
    consumerId,
    action,
  }: ControlConsumerCommand): Promise<OperationStatus<true>> {
    return Promise.resolve(
      this._consumers.control(consumerId, action)
        ? { status: 'SUCEED', data: true }
        : { status: 'NOT_FOUND' },
    );
  }
}
