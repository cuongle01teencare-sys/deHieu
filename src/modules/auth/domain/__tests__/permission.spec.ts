import { hasAllPermissions, permissionMatches } from '../permission.js';

describe('permissionMatches', () => {
  it.each([
    ['*', 'tasks:manage', true],
    ['tasks:*', 'tasks:manage', true],
    ['*:read', 'tasks:read', true],
    ['*:read', 'tasks:manage', false],
    ['tasks:read', 'tasks:manage', false],
    ['team-aliases:write', 'team-aliases:write', true],
  ])('%s cấp cho %s → %s', (g, r, ok) => {
    expect(permissionMatches(g, r)).toBe(ok);
  });

  it('cần đủ mọi quyền yêu cầu', () => {
    expect(
      hasAllPermissions(['tasks:read'], ['tasks:read', 'tasks:manage']),
    ).toBe(false);
    expect(hasAllPermissions(['tasks:*'], ['tasks:read', 'tasks:manage'])).toBe(
      true,
    );
  });
});
