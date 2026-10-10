import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../application/unit-of-work.js';
import { TransactionContext } from './transaction-context.js';

@Injectable()
export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly tx: TransactionContext) {}

  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.tx.run(work);
  }
}
