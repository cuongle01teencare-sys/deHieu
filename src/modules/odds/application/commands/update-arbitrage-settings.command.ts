import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type {
  ArbitrageSettings,
  ArbitrageSettingsStore,
} from '../arbitrage-settings.js';
import type { SweepSignalsHandler } from './sweep-signals.command.js';

export type UpdateArbitrageSettingsCommand = Partial<ArbitrageSettings>;

/**
 * Đổi cấu hình rồi đánh giá lại ngay các room đang có kèo, để thay đổi có hiệu lực tức thì
 * (vd tắt live → kèo live bị hủy với lý do phase_disabled).
 */
export class UpdateArbitrageSettingsHandler implements CommandHandler<
  UpdateArbitrageSettingsCommand,
  ArbitrageSettings
> {
  constructor(
    private readonly _store: ArbitrageSettingsStore,
    private readonly _sweep: SweepSignalsHandler,
  ) {}

  async execute(patch: UpdateArbitrageSettingsCommand) {
    const updated = await this._store.update(patch);
    await this._sweep.execute();
    return updated;
  }
}
