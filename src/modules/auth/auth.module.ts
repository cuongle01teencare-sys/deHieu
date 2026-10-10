import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/infrastructure/config/env.schema.js';
import { AUTHENTICATOR } from './application/authenticator.js';
import {
  ROLE_PERMISSION_PROVIDER,
  type RolePermissionProvider,
} from './application/role-permission.provider.js';
import { AuthorizationService } from './application/authorization.service.js';
import { StaticTokenAuthenticator } from './infrastructure/static-token.authenticator.js';
import { ConfigRolePermissionProvider } from './infrastructure/config-role-permission.provider.js';
import { PermissionsGuard } from './presentation/permissions.guard.js';

/**
 * Xác thực + phân quyền theo QUYỀN (không theo vai trò cố định).
 * Đổi cách đăng nhập (JWT...) hoặc nguồn vai trò (DB...) = đổi adapter ở đây.
 */
@Global()
@Module({
  providers: [
    {
      provide: AUTHENTICATOR,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) =>
        new StaticTokenAuthenticator(cfg.get('API_TOKENS')),
    },
    {
      provide: ROLE_PERMISSION_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) =>
        new ConfigRolePermissionProvider(cfg.get('ROLE_PERMISSIONS')),
    },
    {
      provide: AuthorizationService,
      inject: [ROLE_PERMISSION_PROVIDER],
      useFactory: (roles: RolePermissionProvider) =>
        new AuthorizationService(roles),
    },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  // AUTHENTICATOR: cho kênh WebSocket (admin stream) dùng chung cách xác thực với REST.
  exports: [AuthorizationService, AUTHENTICATOR],
})
export class AuthModule {}
