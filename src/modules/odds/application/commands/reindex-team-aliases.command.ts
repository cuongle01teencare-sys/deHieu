import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { LaneDispatcher } from '../lane-dispatcher.js';
import type { TranslatorRouter } from '../translator-router.js';

export class ReindexTeamAliasesHandler implements CommandHandler<void> {
  constructor(
    private readonly _router: TranslatorRouter,
    private readonly _lanes: LaneDispatcher,
    private readonly _maxMatchDurationMs: number,
    private readonly _now: () => number = Date.now,
  ) {}

  async execute(): Promise<void> {
    await Promise.all(
      this._router.all().map(async (translator) => {
        const { applied } = await this._router.run(translator, () =>
          Promise.resolve({
            applied: this._lanes.submit(
              (translator.reindexTeams?.() ?? []).filter(
                (change) =>
                  change.type === 'remove' ||
                  change.line.props.startsAt >=
                    this._now() - this._maxMatchDurationMs,
              ),
            ),
          }),
        );
        await applied;
      }),
    );
  }
}
