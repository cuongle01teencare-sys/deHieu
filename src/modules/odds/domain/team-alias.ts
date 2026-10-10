import {
  type AggregateRootNonDefaultProps,
  type VersioningTimestampedAggregateRootProps,
  VersioningTimestampedAggregateRoot,
} from '../../../shared/domain/aggregate-root.js';
import { DomainError } from '../../../shared/domain/domain-error.js';
import { normalizeTeamName } from './team-name.js';

export interface TeamAliasProps extends VersioningTimestampedAggregateRootProps {
  /** Tên đã chuẩn hóa, vd 'nip'. */
  readonly alias: string;
  /** Tên chuẩn mà alias trỏ tới, vd 'ninjasinpyjamas'. */
  readonly canonical: string;
}

export type NonDefaultTeamAliasProps =
  AggregateRootNonDefaultProps<TeamAliasProps>;

/** Bí danh tên đội — điền qua API. */
export class TeamAlias extends VersioningTimestampedAggregateRoot<TeamAliasProps> {
  private constructor(props: TeamAliasProps) {
    super(props);
  }

  static create(p: NonDefaultTeamAliasProps): TeamAlias {
    const alias = normalizeTeamName(p.alias);
    const canonical = normalizeTeamName(p.canonical);
    if (!alias || !canonical || alias === canonical)
      throw new DomainError(
        `TeamAlias không hợp lệ: ${p.alias} → ${p.canonical}`,
      );
    const now = new Date();
    return new TeamAlias({
      ...p,
      alias,
      canonical,
      createdAt: now,
      updatedAt: now,
      version: 0,
    });
  }

  static rehydrate(props: TeamAliasProps): TeamAlias {
    return new TeamAlias({ ...props });
  }
}
