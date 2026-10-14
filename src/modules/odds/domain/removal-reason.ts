/**
 * Vì sao một kèo bị hủy. Bot giao dịch và lịch sử kèo dùng giá trị này.
 *  - below_threshold     : lợi nhuận tụt dưới ngưỡng tối thiểu
 *  - better_opportunity  : đã có kèo tốt hơn, phát kèo mới thay thế
 *  - margin_decreased    : kèo không còn tốt như trước, phát kèo mới với margin thấp hơn
 *  - leg_suspended       : một chân đang bị khóa odds
 *  - leg_removed         : odds của một chân bị gỡ (trận/market bị gỡ hoặc kết thúc)
 *  - start_time_mismatch : giờ bắt đầu giữa hai bên lệch quá ngưỡng
 *  - publisher_stopped   : publisher cung cấp một chân đã chết hẳn / bị dừng
 *  - phase_disabled      : kênh (live/prematch) của kèo đang bị tắt
 *  - match_expired       : đã quá giờ bắt đầu + thời lượng tối đa của trận → trận coi như đã xong
 *  - missing_from_listing: market không còn trong danh sách của tenant (vắng nhiều vòng quét liên tiếp)
 */
export const CANCEL_REASONS = [
  'below_threshold',
  'better_opportunity',
  'margin_decreased',
  'leg_suspended',
  'leg_removed',
  'start_time_mismatch',
  'publisher_stopped',
  'phase_disabled',
  'match_expired',
  'missing_from_listing',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

/** Lý do gỡ odds khỏi room, do ACL/use case cung cấp khi biết rõ hơn "leg_removed". */
export type RemovalReason = Extract<
  CancelReason,
  'leg_removed' | 'publisher_stopped' | 'match_expired' | 'missing_from_listing'
>;
