import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE, type DbExecutor } from './database.types.js';

@Injectable()
export class TransactionContext {
  private readonly als = new AsyncLocalStorage<DbExecutor>();

  constructor(@Inject(DRIZZLE) private readonly db: DbExecutor) {}

  /** Trả về transaction hiện tại nếu có, nếu không thì trả về db thường. */
  get executor(): DbExecutor {
    return this.als.getStore() ?? this.db;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return work(); // đã ở trong transaction thì dùng lại
    return this.db.transaction((tx) => this.als.run(tx, work));
  }
}
