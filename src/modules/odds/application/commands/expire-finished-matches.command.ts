import type { CommandHandler } from '../../../../shared/application/cqrs.js';
import type { LaneDispatcher } from '../lane-dispatcher.js';
import type { OddsRoomStore } from '../odds-room.store.js';
import type { OddsLineChange } from '../raw-odds.translator.js';

export interface ExpireFinishedMatchesCommand {
  /** Thời lượng tối đa của một trận (ms) tính từ startsAt. */
  readonly maxMatchDurationMs: number;
}

/**
 * Lưới an toàn: gỡ dòng kèo của trận chắc chắn đã kết thúc (now > startsAt + thời lượng tối đa).
 * Không dựa vào "lâu không cập nhật" vì prematch có thể đứng giá hàng giờ một cách hợp lệ.
 * Gỡ qua làn xử lý như mọi thay đổi khác → evaluator hủy kèo liên quan (match_expired),
 * tracker ghi chuyển trạng thái 'removed' kèm lý do.
 * Nếu tenant vẫn gửi cập nhật (giờ bắt đầu sai, trận hoãn) thì dòng tự xuất hiện lại.
 */
export class ExpireFinishedMatchesHandler implements CommandHandler<
  ExpireFinishedMatchesCommand,
  number
> {
  constructor(
    private readonly _rooms: OddsRoomStore,
    private readonly _lanes: LaneDispatcher,
    private readonly _now: () => number = Date.now,
  ) {}

  async execute(c: ExpireFinishedMatchesCommand): Promise<number> {
    const deadline = this._now() - c.maxMatchDurationMs;
    const changes: OddsLineChange[] = [];
    for (const room of await this._rooms.list())
      for (const [tenant, line] of room.lines)
        if (line.props.startsAt < deadline)
          changes.push({
            type: 'remove',
            key: room.key,
            tenant,
            phase: line.props.phase,
            reason: 'match_expired',
          });
    if (changes.length) await this._lanes.submit(changes);
    return changes.length;
  }
}
