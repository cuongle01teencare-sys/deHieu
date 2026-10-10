import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { TaskDataMessage } from '../../../tasks/application/task-protocol.js';
import type { RawOddsTranslator } from '../raw-odds.translator.js';
import type { LaneDispatcher } from '../lane-dispatcher.js';
import { TranslatorRouter } from '../translator-router.js';

export type IngestTaskDataCommand = TaskDataMessage;

/**
 * Luồng chính: dữ liệu thô → ACL của tenant → ghi room → đánh giá kèo.
 * Ghi store KHÔNG đồng nghĩa phát sự kiện; chỉ evaluator mới phát khi đủ điều kiện.
 */
export class IngestTaskDataHandler implements CommandHandler<IngestTaskDataCommand> {
  private readonly _router: TranslatorRouter;

  constructor(
    translators: readonly RawOddsTranslator[],
    private readonly _lanes: LaneDispatcher,
  ) {
    this._router = new TranslatorRouter(translators);
  }

  async execute(msg: IngestTaskDataCommand): Promise<void> {
    const translator = this._router.find(msg.kind);
    if (!translator) return;
    await this._lanes.submit(await translator.translate(msg));
  }
}
