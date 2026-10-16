import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import type { TraderConfigSync } from './trader-config.sync.js';
import type { ReconcileAlerts } from './reconcile-alerts.js';
import type {
  TradingAccountRepository,
  TradingHaltControl,
  TraderProfileRepository,
} from './trading.ports.js';

/**
 * Nút "Đã đối soát — gỡ khóa" của profile: người vận hành đã kiểm tra hai chân trên sàn (và tự xử lý
 * chân lẻ nếu có). Gỡ khóa "lệnh chưa rõ kết quả" trên CẢ HAI tài khoản của profile rồi gửi lại cấu
 * hình để worker chạy lại ngay. Khóa phiên hết hạn KHÔNG gỡ ở đây (phải đăng nhập lại).
 */
export class ReconcileAdmin {
  constructor(
    private readonly profiles: TraderProfileRepository,
    private readonly accounts: TradingAccountRepository,
    private readonly halts: TradingHaltControl,
    private readonly sync: Pick<TraderConfigSync, 'pushAll'>,
    /** Đóng sự cố "cần đối soát" của profile. */
    private readonly alerts: Pick<ReconcileAlerts, 'resolved'> | null = null,
  ) {}

  async resume(
    profileId: string,
  ): Promise<OperationStatus<{ cleared: string[] }>> {
    const profile = await this.profiles.get(profileId);
    if (!profile) return { status: 'NOT_FOUND' };
    const accounts = (
      await Promise.all([
        this.accounts.get(profile.csgoempireAccountId),
        this.accounts.get(profile.polymarketAccountId),
      ])
    ).filter((a) => a !== null);
    let cleared: string[];
    try {
      cleared = await this.halts.clearReconciliation(accounts);
    } catch (e) {
      const raw = e instanceof Error ? e.message.split(':')[0].trim() : '';
      return {
        status: 'FAILED',
        reason: /^[A-Z][A-Z_0-9]+$/.test(raw) ? raw : 'RECONCILE_FAILED',
      };
    }
    if (!cleared.length)
      return {
        status: 'FAILED',
        reason:
          'NO_RECONCILIATION_HALT: hai tài khoản của profile không có khóa đối soát nào',
      };
    // ép gửi lại: worker có thể đang tự giữ trạng thái đứng yên sau lệnh lệch chân
    await this.sync.pushAll(true);
    this.alerts?.resolved(profileId, cleared.length);
    return { status: 'SUCEED', data: { cleared } };
  }
}
