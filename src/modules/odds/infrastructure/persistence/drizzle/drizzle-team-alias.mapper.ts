import { TeamAlias, type TeamAliasProps } from '../../../domain/team-alias.js';

export const drizzleTeamAliasMapper = {
  toDomain(row: TeamAliasProps) {
    return TeamAlias.rehydrate({ ...row });
  },
};
