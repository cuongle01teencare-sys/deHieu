/** Quyền của module admin. viewer (`*:read`) xem được; xác nhận sự cố cần quyền riêng. */
export const ADMIN_PERMISSIONS = {
  READ: 'admin:read', // snapshot, sự cố, audit, lịch sử odds, stream
  INCIDENTS_ACK: 'admin:incidents', // xác nhận (tắt nhắc lại) sự cố
} as const;
