import type {
  StakeTierSource,
  TraderProfileRepository,
  TraderTaskGateway,
  TradingAccountRepository,
  TradingSettingsStore,
} from './trading.ports.js';
import {
  buildTraderConfig,
  type TraderRuntimeConfig,
} from './trader-config.js';

/**
 * Giữ cấu hình của mọi task trader đang chạy khớp với database:
 * - task mới chạy / vừa khởi động lại hỏi cấu hình (kênh 'config_request') → gửi ngay;
 * - admin sửa tài khoản / profile / cấu hình → gửi lại cho mọi task;
 * - định kỳ đối chiếu (bắt cả thay đổi hạng kèo ở module odds) → chỉ gửi khi khác bản đã gửi.
 */
export class TraderConfigSync {
  /** taskId → JSON cấu hình đã gửi thành công. */
  private readonly _sent = new Map<string, string>();

  constructor(
    private readonly _accounts: TradingAccountRepository,
    private readonly _profiles: TraderProfileRepository,
    private readonly _settings: TradingSettingsStore,
    private readonly _tiers: StakeTierSource,
    private readonly _gateway: TraderTaskGateway,
    private readonly _onError: (e: unknown) => void = () => undefined,
  ) {}

  async configFor(profileId: string): Promise<TraderRuntimeConfig> {
    const [profile, accounts, tiers, settings] = await Promise.all([
      this._profiles.get(profileId),
      this._accounts.list(),
      this._tiers.listTiers(),
      this._settings.get(),
    ]);
    return buildTraderConfig({ profileId, profile, accounts, tiers, settings });
  }

  /** Task hỏi cấu hình: luôn gửi (task vừa khởi động chưa có gì). */
  async answer(taskId: string, profileId: string): Promise<void> {
    await this._push(taskId, await this.configFor(profileId), true);
  }

  /**
   * Task trader quên dấu "đã xử lý" và xét lại mọi kèo còn sống (sau khi xóa toàn bộ lệnh).
   * Không truyền profileId = mọi task. Trả số task đã nhận lệnh.
   */
  async resetSeen(profileId?: string): Promise<number> {
    const running = (await this._gateway.listRunning()).filter(
      (r) => !profileId || r.profileId === profileId,
    );
    let n = 0;
    for (const r of running) {
      try {
        if (await this._gateway.command(r.taskId, 'reset_seen')) n++;
      } catch (e) {
        this._onError(e);
      }
    }
    return n;
  }

  /** Gửi cho mọi task đang chạy; `force` = gửi cả khi không đổi. Trả số task đã nhận bản mới. */
  async pushAll(force = false): Promise<number> {
    const running = await this._gateway.listRunning();
    const alive = new Set(running.map((r) => r.taskId));
    for (const id of this._sent.keys())
      if (!alive.has(id)) this._sent.delete(id);
    let n = 0;
    for (const r of running) {
      try {
        if (
          await this._push(r.taskId, await this.configFor(r.profileId), force)
        )
          n++;
      } catch (e) {
        this._onError(e);
      }
    }
    return n;
  }

  private async _push(
    taskId: string,
    config: TraderRuntimeConfig,
    force: boolean,
  ): Promise<boolean> {
    const json = JSON.stringify(config);
    if (!force && this._sent.get(taskId) === json) return false;
    if (!(await this._gateway.push(taskId, config))) return false;
    this._sent.set(taskId, json);
    return true;
  }
}
