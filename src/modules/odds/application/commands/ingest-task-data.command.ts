import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { TaskDataMessage } from '../../../tasks/application/task-protocol.js';
import type { RawOddsTranslator } from '../raw-odds.translator.js';
import type { LaneDispatcher } from '../lane-dispatcher.js';
import type { IngestStats } from '../ingest-stats.js';
import { TranslatorRouter } from '../translator-router.js';

export type IngestTaskDataCommand = TaskDataMessage;

/**
 * Luồng chính: dữ liệu thô → ACL của tenant → ghi room → đánh giá kèo.
 * Ghi store KHÔNG đồng nghĩa phát sự kiện; chỉ evaluator mới phát khi đủ điều kiện.
 * Có `stats` thì đếm theo chặng (nhận / lỗi / thay đổi sinh ra) cho admin.
 */
export class IngestTaskDataHandler implements CommandHandler<IngestTaskDataCommand> {
  private readonly _router: TranslatorRouter;

  constructor(
    translators: readonly RawOddsTranslator[],
    private readonly _lanes: LaneDispatcher,
    private readonly _stats?: IngestStats,
  ) {
    this._router = new TranslatorRouter(translators);
  }

  async execute(msg: IngestTaskDataCommand): Promise<void> {
    const translator = this._router.find(msg.kind);
    if (!translator) return;
    const tenant = translator.tenant;
    this._stats?.received(tenant, msg.kind);
    let changes;
    try {
      changes = await translator.translate(msg);
    } catch (e) {
      this._stats?.failed(tenant, msg.kind);
      throw e;
    }
    this._stats?.emitted(tenant, msg.kind, changes);
    await this._lanes.submit(changes);
  }
}
