import type { OpsEventBus } from '../../../shared/application/ops-event-bus.js';
import type { IncidentTracker } from './incident-tracker.js';

/**
 * Bot dừng chờ đối soát hai chân (lệnh thật lệch chân / không rõ kết quả) → mở sự cố NGHIÊM TRỌNG
 * `trading.reconcile:{profileId}` (hiện ở mục Sự cố, báo qua kênh cảnh báo). Gỡ khóa đối soát → đóng.
 */
export class TradingReconcileIncidentRelay {
  constructor(
    private readonly _ops: OpsEventBus,
    private readonly _incidents: IncidentTracker,
  ) {}

  /** Trả về hàm hủy đăng ký. */
  start(): () => void {
    return this._ops.subscribe((e) => {
      if (e.type === 'trading.session_restored')
        return this._incidents.clear(
          `trading.session:${e.data.browserProfile}`,
        );
      if (e.type === 'trading.session_lost')
        return this._incidents.raise(
          `trading.session:${e.data.browserProfile}`,
          {
            kind: 'trading.session',
            severity: 'critical',
            title: `Cần đăng nhập lại csgoempire (hồ sơ ${e.data.browserProfile})`,
            message: `App tự lấy phiên hỏng ${e.data.attempts} lần liên tiếp: ${e.data.error}. Profile dùng tài khoản này đang đứng yên — mở Auto trade → Tài khoản → Mở Chromium & đăng nhập.`,
            details: { ...e.data },
          },
        );
      if (e.type === 'trading.reconciled')
        return this._incidents.clear(`trading.reconcile:${e.data.profileId}`);
      if (e.type !== 'trading.reconcile_required') return;
      const d = e.data;
      this._incidents.raise(`trading.reconcile:${d.profileId}`, {
        kind: 'trading.reconcile',
        severity: 'critical',
        title: `Cần đối soát lệnh thật — profile ${d.profileName} đã dừng`,
        message: `${d.summary}. Kiểm tra hai chân trên csgoempire (My bets) và Polymarket (Activity), xử lý chân lẻ nếu có, rồi bấm "Đã đối soát — gỡ khóa" ở trang Auto trade → Profile.`,
        details: { ...d },
      });
    });
  }
}
