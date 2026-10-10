import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { SignalHistoryEntry } from '../../domain/signal-history.js';
import type { SignalHistoryRepository } from '../signal-history.repository.js';

export interface GetSignalHistoryQuery {
  readonly signalId: string;
}

export class GetSignalHistoryHandler implements QueryHandler<
  GetSignalHistoryQuery,
  SignalHistoryEntry | null
> {
  constructor(private readonly _repo: SignalHistoryRepository) {}

  execute({ signalId }: GetSignalHistoryQuery) {
    return this._repo.get(signalId);
  }
}
