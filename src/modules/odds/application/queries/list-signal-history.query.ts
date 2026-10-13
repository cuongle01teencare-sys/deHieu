import type { Page } from '../../../../shared/application/page.js';
import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { SignalHistoryEntry } from '../../domain/signal-history.js';
import type {
  SignalHistoryQuery,
  SignalHistoryRepository,
} from '../signal-history.repository.js';

export type ListSignalHistoryQuery = SignalHistoryQuery;

export class ListSignalHistoryHandler implements QueryHandler<
  ListSignalHistoryQuery,
  Page<SignalHistoryEntry>
> {
  constructor(private readonly _repo: SignalHistoryRepository) {}

  async execute(q: ListSignalHistoryQuery): Promise<Page<SignalHistoryEntry>> {
    const [items, total] = await Promise.all([
      this._repo.list(q),
      this._repo.count(q),
    ]);
    return { total, items };
  }
}
