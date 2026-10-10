import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../../../../shared/infrastructure/database/database.types.js';
import type { HealthProbe } from '../../application/health.js';

export class PostgresHealthProbe implements HealthProbe {
  readonly name = 'postgres';

  constructor(private readonly _db: DbExecutor) {}

  async check(): Promise<void> {
    await this._db.execute(sql`select 1`);
  }
}
