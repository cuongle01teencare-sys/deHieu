/** Quyền của module trading. Vai trò nào có quyền nào do cấu hình auth quyết định. */
export const TRADING_PERMISSIONS = {
  /** Xem tài khoản (đã che bí mật), profile, lệnh giấy, cấu hình. */
  READ: 'trading:read',
  /** Thêm/sửa/xóa tài khoản, profile, cấu hình auto trade; xóa lệnh giấy. */
  MANAGE: 'trading:manage',
} as const;
