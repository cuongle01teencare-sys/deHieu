import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import type { OneClickBoard, OneClickCandidate } from './one-click-board.js';
import type { TraderConfigSync } from './trader-config.sync.js';

/** Trang On click: xem kèo chờ người vào lệnh của một profile, bấm vào lệnh. */
export class OneClickAdmin {
  constructor(
    private readonly _board: OneClickBoard,
    private readonly _sync: TraderConfigSync,
  ) {}

  list(profileId: string): OneClickCandidate[] {
    return this._board.list(profileId);
  }

  /**
   * Nhờ task trader của profile vào lệnh kèo này ngay: trader đọc lại sổ lệnh, áp bảng tiền,
   * số lệnh mỗi hạng, hạn mức trận như bot; lệnh ghi kèm người vào. Kết quả hiện ở Lệnh giấy.
   */
  async enter(
    profileId: string,
    signalId: string,
    by: string,
    /** Tiền mục tiêu người nhập (bỏ trống = theo hạng của profile). */
    targetStake?: number,
  ): Promise<OperationStatus<{ sent: true }>> {
    if (!this._board.get(profileId, signalId)) return { status: 'NOT_FOUND' };
    const r = await this._sync.sendToProfile(profileId, 'manual_enter', {
      signalId,
      by,
      ...(targetStake !== undefined ? { targetStake } : {}),
    });
    if (r === 'NO_TASK')
      return {
        status: 'FAILED',
        reason: 'NO_TRADER_TASK: profile chưa có task trader đang chạy',
      };
    if (r === 'REJECTED')
      return {
        status: 'FAILED',
        reason:
          'TRADER_REJECTED: trader không nhận lệnh (kèo đã hết hoặc đang xử lý), thử lại',
      };
    return { status: 'SUCEED', data: { sent: true } };
  }
}
