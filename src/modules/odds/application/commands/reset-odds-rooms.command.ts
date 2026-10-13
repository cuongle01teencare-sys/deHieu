import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { OpsEventBus } from '../../../../shared/application/ops-event-bus.js';
import type { OddsRoomStore } from '../odds-room.store.js';

export interface ResetOddsRoomsCommand {
  /** Ghi vào sự kiện để admin biết vì sao, vd 'reset_on_start'. */
  readonly reason: string;
}

/**
 * Xóa sạch room. Dùng lúc khởi động: bảng định tuyến của translator nằm trong RAM nên đã mất,
 * mọi dòng kèo còn trong Redis không còn ai cập nhật hay gỡ được (mồ côi).
 * Kèo đang sống cũng đã bị đóng ('abandoned') nên không cần hủy từng kèo.
 * Publisher gửi lại snapshot / danh sách thì room được dựng lại.
 */
export class ResetOddsRoomsHandler implements CommandHandler<
  ResetOddsRoomsCommand,
  { rooms: number; lines: number }
> {
  constructor(
    private readonly _rooms: OddsRoomStore,
    private readonly _ops?: OpsEventBus,
    private readonly _now: () => number = Date.now,
  ) {}

  async execute(c: ResetOddsRoomsCommand) {
    const r = await this._rooms.clear();
    this._ops?.publish({
      type: 'odds.reset',
      topic: 'odds',
      at: this._now(),
      data: { ...r, reason: c.reason },
    });
    return r;
  }
}
