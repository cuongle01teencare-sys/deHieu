import type { OpsEvent } from '../../../shared/application/ops-event-bus.js';
import type { OddsLineChange } from './raw-odds.translator.js';

/**
 * Nhớ trạng thái gần nhất của từng dòng kèo (room × tenant) để nhận ra CHUYỂN TRẠNG THÁI:
 * xuất hiện, open ↔ suspended, bị gỡ. Đổi giá thuần túy không phải chuyển trạng thái.
 * Sau khi app khởi động lại, mọi dòng được coi là "mới xuất hiện".
 */
export class OddsTransitionTracker {
  private readonly _status = new Map<string, string>();

  /** Trả về sự kiện cho một thay đổi: luôn có odds.changed, thêm odds.transition nếu đổi trạng thái. */
  observe(c: OddsLineChange, at: number): OpsEvent[] {
    const room = c.key.toString();
    const tenant = c.type === 'set' ? c.line.props.tenant : c.tenant;
    const id = `${room}|${tenant}`;
    const prev = this._status.get(id) ?? null;
    const events: OpsEvent[] = [];

    if (c.type === 'set') {
      const p = c.line.props;
      events.push({
        type: 'odds.changed',
        topic: `room:${room}`,
        at,
        data: {
          room,
          tenant,
          phase: p.phase,
          removed: false,
          odds: p.odds,
          status: p.status,
        },
      });
      if (prev !== p.status) {
        this._status.set(id, p.status);
        events.push({
          type: 'odds.transition',
          topic: 'odds',
          at,
          data: { room, tenant, phase: p.phase, from: prev, to: p.status },
        });
      }
      return events;
    }

    events.push({
      type: 'odds.changed',
      topic: `room:${room}`,
      at,
      data: {
        room,
        tenant,
        phase: c.phase,
        removed: true,
        ...(c.reason ? { reason: c.reason } : {}),
      },
    });
    if (prev !== null) {
      this._status.delete(id);
      events.push({
        type: 'odds.transition',
        topic: 'odds',
        at,
        data: {
          room,
          tenant,
          phase: c.phase,
          from: prev,
          to: 'removed',
          ...(c.reason ? { reason: c.reason } : {}),
        },
      });
    }
    return events;
  }
}
