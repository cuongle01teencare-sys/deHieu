import { eq } from 'drizzle-orm';
import type { OperationStatus } from '../../../../../shared/domain/domain-repository.js';
import type { TransactionContext } from '../../../../../shared/infrastructure/database/transaction-context.js';
import type { TeamAlias } from '../../../domain/team-alias.js';
import type { TeamAliasRepository } from '../../../domain/team-alias.repository.js';
import { drizzleTeamAliasesTable as t } from './drizzle-team-alias.schema.js';
import { drizzleTeamAliasMapper } from './drizzle-team-alias.mapper.js';

const fail = (op: string, e: unknown) => ({
  status: 'FAILED' as const,
  reason: `[DrizzleTeamAliasRepository] ${op}: ${e instanceof Error ? e.message : JSON.stringify(e)}`,
});

export class DrizzleTeamAliasRepository implements TeamAliasRepository {
  constructor(private readonly _tx: TransactionContext) {}

  async findById(id: string): Promise<OperationStatus<TeamAlias>> {
    try {
      const [row] = await this._tx.executor
        .select()
        .from(t)
        .where(eq(t.id, id));
      return row
        ? { status: 'SUCEED', data: drizzleTeamAliasMapper.toDomain(row) }
        : { status: 'NOT_FOUND' };
    } catch (e: unknown) {
      return fail('findById', e);
    }
  }

  async findAll(): Promise<OperationStatus<TeamAlias[]>> {
    try {
      const rows = await this._tx.executor.select().from(t);
      return {
        status: 'SUCEED',
        data: rows.map((r) => drizzleTeamAliasMapper.toDomain(r)),
      };
    } catch (e: unknown) {
      return fail('findAll', e);
    }
  }

  async save(alias: TeamAlias): Promise<OperationStatus<TeamAlias>> {
    try {
      const snap = alias.toSnapShot();
      const [row] = await this._tx.executor
        .insert(t)
        .values(snap)
        .onConflictDoUpdate({
          target: t.alias,
          set: { canonical: snap.canonical, updatedAt: new Date() },
        })
        .returning();
      return row
        ? { status: 'SUCEED', data: drizzleTeamAliasMapper.toDomain(row) }
        : { status: 'FAILED', reason: 'no row returned' };
    } catch (e: unknown) {
      return fail('save', e);
    }
  }

  async delete(id: string): Promise<OperationStatus<true>> {
    try {
      const rows = await this._tx.executor
        .delete(t)
        .where(eq(t.id, id))
        .returning();
      return rows.length
        ? { status: 'SUCEED', data: true }
        : { status: 'NOT_FOUND' };
    } catch (e: unknown) {
      return fail('delete', e);
    }
  }
}
