import { hasAllPermissions, type Permission } from '../domain/permission.js';
import type { Principal } from '../domain/principal.js';
import type { RolePermissionProvider } from './role-permission.provider.js';

/** Application service: principal có đủ quyền yêu cầu không (gộp quyền của mọi vai trò). */
export class AuthorizationService {
  constructor(private readonly _roles: RolePermissionProvider) {}

  async permissionsOf(principal: Principal): Promise<Permission[]> {
    const lists = await Promise.all(
      principal.roles.map((r) => this._roles.permissionsOf(r)),
    );
    return [...new Set(lists.flat())];
  }

  async can(
    principal: Principal,
    required: readonly Permission[],
  ): Promise<boolean> {
    if (required.length === 0) return true;
    return hasAllPermissions(await this.permissionsOf(principal), required);
  }
}
