import { randomUUID } from 'node:crypto';
import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import { TeamAlias } from '../../domain/team-alias.js';
import type { TeamAliasRepository } from '../../domain/team-alias.repository.js';
import type { TeamNameResolver } from '../team-name.resolver.js';

export interface CreateTeamAliasCommand {
  readonly alias: string;
  readonly canonical: string;
}

export class CreateTeamAliasHandler implements CommandHandler<
  CreateTeamAliasCommand,
  OperationStatus<TeamAlias>
> {
  constructor(
    private readonly _repo: TeamAliasRepository,
    private readonly _resolver: TeamNameResolver,
  ) {}

  async execute(cmd: CreateTeamAliasCommand) {
    const result = await this._repo.save(
      TeamAlias.create({ id: randomUUID(), ...cmd }),
    );
    if (result.status === 'SUCEED') await this._resolver.reload();
    return result;
  }
}
