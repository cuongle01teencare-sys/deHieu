import type { OpsEventBus } from '../../../shared/application/ops-event-bus.js';
import type { IncidentTracker } from './incident-tracker.js';

/**
 * Vòng đối chiếu danh sách market của tenant báo "gỡ hàng loạt bất thường" → mở sự cố
 * `odds.mass_removal:{tenant}:{taskId}`; vòng bình thường kế tiếp → đóng.
 * Translator đã giữ lại (không gỡ) trong lúc bất thường, tối đa vài vòng.
 */
export class ReconcileIncidentRelay {
  constructor(
    private readonly _ops: OpsEventBus,
    private readonly _incidents: IncidentTracker,
  ) {}

  /** Trả về hàm hủy đăng ký. */
  start(): () => void {
    return this._ops.subscribe((e) => {
      if (e.type !== 'odds.reconciled') return;
      const d = e.data;
      const key = `odds.mass_removal:${d.tenant}:${d.taskId}`;
      if (!d.massive) return this._incidents.clear(key);
      const pct = Math.round(d.ratio * 100);
      this._incidents.raise(key, {
        kind: 'odds.mass_removal',
        severity: 'warning',
        title: `${d.tenant}: ${pct}% market biến mất khỏi danh sách`,
        message:
          d.held > 0
            ? `${d.held}/${d.known} market vắng mặt nhiều vòng liên tiếp (task ${d.taskId}). Đang GIỮ LẠI chưa gỡ — có thể API trả thiếu. Kiểm tra task/API; nếu market đã đóng thật, chúng sẽ tự được gỡ sau vài vòng.`
            : `Đã gỡ ${d.removed}/${d.known} market vắng mặt (task ${d.taskId}) sau khi hết thời gian giữ lại.`,
        details: { ...d },
      });
    });
  }
}
