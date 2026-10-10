import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TaskSupervisor } from '../task-supervisor.js';

export interface SendTaskCommandCommand {
  readonly taskId: string;
  readonly name: string;
  readonly data: unknown;
}

export class SendTaskCommandHandler implements CommandHandler<
  SendTaskCommandCommand,
  OperationStatus<true>
> {
  constructor(private readonly _supervisor: TaskSupervisor) {}

  execute({ taskId, name, data }: SendTaskCommandCommand) {
    return this._supervisor.command(taskId, name, data);
  }
}
