import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { SignalHistoryEntry } from '../../domain/signal-history.js';
import type {
  SignalHistoryQuery,
  SignalHistoryRepository,
} from '../signal-history.repository.js';

export type ListSignalHistoryQuery = SignalHistoryQuery;

export class ListSignalHistoryHandler implements QueryHandler<
  ListSignalHistoryQuery,
  SignalHistoryEntry[]
> {
  constructor(private readonly _repo: SignalHistoryRepository) {}

  execute(q: ListSignalHistoryQuery) {
    return this._repo.list(q);
  }
}
