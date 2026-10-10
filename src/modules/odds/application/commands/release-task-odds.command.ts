import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { RawOddsTranslator } from '../raw-odds.translator.js';
import type { LaneDispatcher } from '../lane-dispatcher.js';
import { TranslatorRouter } from '../translator-router.js';

export interface ReleaseTaskOddsCommand {
  readonly taskId: string;
  readonly kind: string;
}

/**
 * Publisher chết hẳn / bị dừng → gỡ các dòng kèo nó từng cung cấp khỏi room.
 * Evaluator sẽ hủy các kèo dùng chân đó (lý do publisher_stopped).
 */
export class ReleaseTaskOddsHandler implements CommandHandler<ReleaseTaskOddsCommand> {
  private readonly _router: TranslatorRouter;

  constructor(
    translators: readonly RawOddsTranslator[],
    private readonly _lanes: LaneDispatcher,
  ) {
    this._router = new TranslatorRouter(translators);
  }

  async execute({ taskId, kind }: ReleaseTaskOddsCommand): Promise<void> {
    const translator = this._router.find(kind);
    if (!translator) return;
    const changes = await translator.release(taskId, kind);
    await this._lanes.submit(
      changes.map((c) =>
        c.type === 'remove'
          ? { ...c, reason: c.reason ?? ('publisher_stopped' as const) }
          : c,
      ),
    );
  }
}
