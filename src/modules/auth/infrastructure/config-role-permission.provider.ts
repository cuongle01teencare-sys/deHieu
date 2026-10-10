import type { RolePermissionProvider } from '../application/role-permission.provider.js';
import type { Permission } from '../domain/permission.js';

/**
 * Vai trò mặc định. Ghi đè/bổ sung bằng env ROLE_PERMISSIONS (JSON), vd:
 *   {"moderator":["team-aliases:*","arbitrage:read"]}
 * Muốn quản lý vai trò qua UI → thay bằng adapter đọc DB, cùng port.
 */
export const DEFAULT_ROLE_PERMISSIONS: Readonly<
  Record<string, readonly Permission[]>
> = {
  admin: ['*'],
  manager: [
    'tasks:*',
    'team-aliases:*',
    'arbitrage-settings:*',
    'consumers:*',
    'arbitrage:read',
  ],
  staff: ['tasks:read', 'team-aliases:*', 'consumers:read', 'arbitrage:read'],
  viewer: ['*:read'],
};

export class ConfigRolePermissionProvider implements RolePermissionProvider {
  private readonly _map: Record<string, readonly Permission[]>;

  constructor(overridesJson?: string) {
    const overrides = overridesJson
      ? (JSON.parse(overridesJson) as Record<string, Permission[]>)
      : {};
    this._map = { ...DEFAULT_ROLE_PERMISSIONS, ...overrides };
  }

  permissionsOf(role: string): Promise<readonly Permission[]> {
    return Promise.resolve(this._map[role] ?? []);
  }
}
