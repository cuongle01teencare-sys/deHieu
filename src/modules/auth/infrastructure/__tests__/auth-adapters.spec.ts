import { AuthorizationService } from '../../application/authorization.service.js';
import { ConfigRolePermissionProvider } from '../config-role-permission.provider.js';
import { StaticTokenAuthenticator } from '../static-token.authenticator.js';

describe('StaticTokenAuthenticator', () => {
  const auth = new StaticTokenAuthenticator(
    'tok-admin:alice:admin, tok-mix:bob:staff|viewer',
  );

  it('nhận đúng Bearer token', async () => {
    expect(
      await auth.authenticate({ authorization: 'Bearer tok-mix' }),
    ).toEqual({
      id: 'bob',
      roles: ['staff', 'viewer'],
    });
  });

  it('từ chối token sai hoặc thiếu', async () => {
    expect(
      await auth.authenticate({ authorization: 'Bearer nope' }),
    ).toBeNull();
    expect(await auth.authenticate({})).toBeNull();
  });
});

describe('AuthorizationService + ConfigRolePermissionProvider', () => {
  const svc = new AuthorizationService(
    new ConfigRolePermissionProvider('{"moderator":["team-aliases:*"]}'),
  );

  it('admin có mọi quyền, viewer chỉ đọc', async () => {
    expect(await svc.can({ id: 'a', roles: ['admin'] }, ['tasks:manage'])).toBe(
      true,
    );
    expect(await svc.can({ id: 'v', roles: ['viewer'] }, ['tasks:read'])).toBe(
      true,
    );
    expect(
      await svc.can({ id: 'v', roles: ['viewer'] }, ['tasks:manage']),
    ).toBe(false);
  });

  it('vai trò mới thêm bằng cấu hình, không sửa code', async () => {
    expect(
      await svc.can({ id: 'm', roles: ['moderator'] }, ['team-aliases:write']),
    ).toBe(true);
    expect(
      await svc.can({ id: 'm', roles: ['moderator'] }, ['tasks:read']),
    ).toBe(false);
  });

  it('vai trò không xác định → không có quyền', async () => {
    expect(
      await svc.can({ id: 'x', roles: ['ghost'] }, ['arbitrage:read']),
    ).toBe(false);
  });
});
