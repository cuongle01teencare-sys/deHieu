/** Quyền của module tasks. Vai trò nào có quyền nào do cấu hình auth quyết định. */
export const TASK_PERMISSIONS = {
  READ: 'tasks:read',
  MANAGE: 'tasks:manage', // start / stop
  COMMAND: 'tasks:command', // gửi lệnh vào task đang chạy
} as const;
