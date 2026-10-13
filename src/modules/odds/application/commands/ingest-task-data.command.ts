import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { TaskDataMessage } from '../../../tasks/application/task-protocol.js';
import type { LaneDispatcher } from '../lane-dispatcher.js';
import type { IngestStats } from '../ingest-stats.js';
import type { TranslatorRouter } from '../translator-router.js';

export type IngestTaskDataCommand = TaskDataMessage;

/**
 * Luồng chính: dữ liệu thô → ACL của tenant → ghi room → đánh giá kèo.
 * Ghi store KHÔNG đồng nghĩa phát sự kiện; chỉ evaluator mới phát khi đủ điều kiện.
 * Có `stats` thì đếm theo chặng (nhận / lỗi / thay đổi sinh ra) cho admin.
 */
export class IngestTaskDataHandler implements CommandHandler<IngestTaskDataCommand> {
  constructor(
    private readonly _router: TranslatorRouter,
    private readonly _lanes: LaneDispatcher,
    private readonly _stats?: IngestStats,
  ) {}

  async execute(msg: IngestTaskDataCommand): Promise<void> {
    const translator = this._router.find(msg.kind);
    if (!translator) return;
    const { applied } = await this._router.run(translator, async () => {
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
      return { applied: this._lanes.submit(changes) };
    });
    await applied;
  }
}
