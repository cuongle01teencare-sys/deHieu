import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type { TeamAlias } from '../../domain/team-alias.js';
import type { TeamAliasRepository } from '../../domain/team-alias.repository.js';

export type ListTeamAliasesQuery = Record<string, never>;

export class ListTeamAliasesHandler implements QueryHandler<
  ListTeamAliasesQuery,
  OperationStatus<TeamAlias[]>
> {
  constructor(private readonly _repo: TeamAliasRepository) {}

  execute() {
    return this._repo.findAll();
  }
}
