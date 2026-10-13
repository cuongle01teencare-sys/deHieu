import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TeamAliasRepository } from '../../domain/team-alias.repository.js';
import type { TeamNameResolver } from '../team-name.resolver.js';
import type { ReindexTeamAliasesHandler } from './reindex-team-aliases.command.js';

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
    private readonly _reindex: ReindexTeamAliasesHandler,
  ) {}

  async execute({ id }: DeleteTeamAliasCommand) {
    const result = await this._repo.delete(id);
    if (result.status === 'SUCEED') {
      await this._resolver.reload();
      await this._reindex.execute();
    }
    return result;
  }
}
