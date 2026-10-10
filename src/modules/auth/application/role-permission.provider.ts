import type { Permission } from '../domain/permission.js';

/** Port: vai trò → danh sách quyền. Thêm vai trò mới = thêm cấu hình, không sửa code. */
export interface RolePermissionProvider {
  permissionsOf(role: string): Promise<readonly Permission[]>;
}

export const ROLE_PERMISSION_PROVIDER = Symbol('ROLE_PERMISSION_PROVIDER');
