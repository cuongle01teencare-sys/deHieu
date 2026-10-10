import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { UNIT_OF_WORK } from '../../application/unit-of-work.js';
import { PG_CLIENT, DRIZZLE } from './database.types.js';
import { DrizzleUnitOfWork } from './drizzle-unit-of-work.js';
import { TransactionContext } from './transaction-context.js';
import { Env } from '../config/env.schema.js';

@Global()
@Module({
  providers: [
    {
      provide: PG_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) =>
        postgres(cfg.get('DATABASE_URL'), {}),
    },
    {
      provide: DRIZZLE,
      inject: [PG_CLIENT],
      useFactory: (sql: Sql) => drizzle({ client: sql }),
    },
    TransactionContext,
    { provide: UNIT_OF_WORK, useClass: DrizzleUnitOfWork },
  ],
  exports: [DRIZZLE, TransactionContext, UNIT_OF_WORK],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_CLIENT) private readonly sql: Sql) {}
  async onApplicationShutdown() {
    await this.sql.end({ timeout: 5 });
  }
}
