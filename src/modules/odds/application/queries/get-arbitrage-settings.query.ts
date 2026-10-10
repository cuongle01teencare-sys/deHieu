import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type {
  ArbitrageSettings,
  ArbitrageSettingsStore,
} from '../arbitrage-settings.js';

export type GetArbitrageSettingsQuery = Record<string, never>;

export class GetArbitrageSettingsHandler implements QueryHandler<
  GetArbitrageSettingsQuery,
  ArbitrageSettings
> {
  constructor(private readonly _store: ArbitrageSettingsStore) {}

  execute() {
    return this._store.get();
  }
}
