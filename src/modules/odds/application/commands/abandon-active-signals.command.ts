import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { SignalHistoryRepository } from '../signal-history.repository.js';

export interface AbandonActiveSignalsCommand {
  readonly reason: string; // vd 'app_restart'
}

/** Lúc app khởi động: kèo còn 'active' trong DB từ lần chạy trước không còn ai theo dõi → đóng lại. */
export class AbandonActiveSignalsHandler implements CommandHandler<
  AbandonActiveSignalsCommand,
  number
> {
  constructor(private readonly _repo: SignalHistoryRepository) {}

  execute({ reason }: AbandonActiveSignalsCommand) {
    return this._repo.abandonActive(reason, new Date());
  }
}
