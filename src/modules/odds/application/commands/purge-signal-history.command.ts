import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { SignalHistoryRepository } from '../signal-history.repository.js';

export interface PurgeSignalHistoryCommand {
  readonly before: Date;
  readonly limit: number;
}

/** Chính sách giữ lại: xóa một lô kèo đã kết thúc phát trước `before`. */
export class PurgeSignalHistoryHandler implements CommandHandler<
  PurgeSignalHistoryCommand,
  number
> {
  constructor(private readonly _repo: SignalHistoryRepository) {}

  execute(c: PurgeSignalHistoryCommand): Promise<number> {
    return this._repo.purgeOlderThan(c.before, c.limit);
  }
}
