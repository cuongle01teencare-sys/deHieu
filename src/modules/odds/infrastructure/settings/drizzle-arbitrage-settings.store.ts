import { eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../shared/infrastructure/database/transaction-context.js';
import {
  DEFAULT_ARBITRAGE_SETTINGS,
  type ArbitrageSettings,
  type ArbitrageSettingsStore,
} from '../../application/arbitrage-settings.js';
import { drizzleAppSettingsTable as t } from '../persistence/drizzle/drizzle-app-settings.schema.js';

const KEY = 'arbitrage';

/**
 * Cấu hình arbitrage lưu trong Postgres (bảng app_settings), giữ bản sao trong RAM
 * vì bộ đánh giá kèo đọc rất thường xuyên. Gọi load() một lần lúc khởi động.
 */
export class DrizzleArbitrageSettingsStore implements ArbitrageSettingsStore {
  private _settings: ArbitrageSettings = DEFAULT_ARBITRAGE_SETTINGS;

  constructor(private readonly _tx: TransactionContext) {}

  /** Đọc bản đã lưu; trường thiếu (bản cũ, thêm trường mới) lấy mặc định. */
  async load(): Promise<ArbitrageSettings> {
    const [row] = await this._tx.executor
      .select()
      .from(t)
      .where(eq(t.key, KEY));
    if (row)
      this._settings = {
        ...DEFAULT_ARBITRAGE_SETTINGS,
        ...(row.value as Partial<ArbitrageSettings>),
      };
    return this._settings;
  }

  get() {
    return Promise.resolve(this._settings);
  }

  async update(patch: Partial<ArbitrageSettings>) {
    const next = { ...this._settings, ...patch };
    await this._tx.executor
      .insert(t)
      .values({ key: KEY, value: next })
      .onConflictDoUpdate({
        target: t.key,
        set: { value: next, updatedAt: new Date() },
      });
    this._settings = next; // chỉ đổi trong RAM khi đã ghi bền thành công
    return next;
  }
}
