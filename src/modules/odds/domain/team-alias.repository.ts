import type {
  DomainRepository,
  OperationStatus,
} from '../../../shared/domain/domain-repository.js';
import type { TeamAlias } from './team-alias.js';

export interface TeamAliasRepository extends DomainRepository<TeamAlias> {
  findAll(): Promise<OperationStatus<TeamAlias[]>>;
  delete(id: string): Promise<OperationStatus<true>>;
}

export const TEAM_ALIAS_REPOSITORY = Symbol('TEAM_ALIAS_REPOSITORY');
