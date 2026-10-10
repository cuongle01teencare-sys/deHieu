import {
  SetMetadata,
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtension,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Permission } from '../domain/permission.js';
import type { Principal } from '../domain/principal.js';

export const PERMISSIONS_KEY = 'auth:permissions';
export const PUBLIC_KEY = 'auth:public';

/**
 * Endpoint cần những quyền này (không gắn với vai trò nào).
 * Vai trò nào có quyền là do cấu hình RolePermissionProvider quyết định.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    // tài liệu OpenAPI sinh từ cùng một khai báo quyền
    ApiBearerAuth(),
    ApiExtension('x-required-permissions', permissions),
    ApiUnauthorizedResponse({ description: 'Thiếu hoặc sai token' }),
    ApiForbiddenResponse({
      description: `Thiếu quyền: ${permissions.join(', ')}`,
    }),
  );

/** Endpoint không cần đăng nhập. Mặc định MỌI endpoint đều cần xác thực. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Lấy principal đã xác thực trong handler: `@CurrentPrincipal() p: Principal`. */
export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal | undefined =>
    ctx.switchToHttp().getRequest<{ principal?: Principal }>().principal,
);
