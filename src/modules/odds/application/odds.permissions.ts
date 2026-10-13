/** Quyền của module odds. Vai trò nào có quyền nào do cấu hình auth quyết định. */
export const ODDS_PERMISSIONS = {
  ARBITRAGE_READ: 'arbitrage:read', // kèo đang sống, room
  SETTINGS_READ: 'arbitrage-settings:read',
  SETTINGS_WRITE: 'arbitrage-settings:write',
  TEAM_ALIASES_READ: 'team-aliases:read',
  TEAM_ALIASES_WRITE: 'team-aliases:write',
  CONSUMERS_READ: 'consumers:read',
  CONSUMERS_CONTROL: 'consumers:control',
  /** Thêm/sửa/xóa kênh thông báo (Discord, Telegram, Slack) và hạng kèo. */
  CONSUMERS_MANAGE: 'consumers:manage',
} as const;
