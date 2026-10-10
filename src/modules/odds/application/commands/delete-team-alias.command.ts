import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TeamAliasRepository } from '../../domain/team-alias.repository.js';
import type { TeamNameResolver } from '../team-name.resolver.js';

export interface DeleteTeamAliasCommand {
  readonly id: string;
}

export class DeleteTeamAliasHandler implements CommandHandler<
  DeleteTeamAliasCommand,
  OperationStatus<true>
> {
  constructor(
    private readonly _repo: TeamAliasRepository,
    private readonly _resolver: TeamNameResolver,
  ) {}

  async execute({ id }: DeleteTeamAliasCommand) {
    const result = await this._repo.delete(id);
    if (result.status === 'SUCEED') await this._resolver.reload();
    return result;
  }
}
