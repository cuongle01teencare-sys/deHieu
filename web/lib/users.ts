import 'server-only';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config';
import type { WebUser } from './types';

/** Người dùng web. apiToken là token của backend (API_TOKENS) — chỉ server Next.js giữ. */
interface UserRecord extends Omit<WebUser, 'permissions'> {
  permissions?: string[];
  passwordHash: string; // scrypt$<N>$<salt base64>$<key base64>
  apiToken: string;
}

const DEMO: UserRecord = {
  username: 'demo',
  name: 'Người dùng demo',
  role: 'Dữ liệu mẫu',
  // thiếu `tasks:command` để thấy trạng thái nút bị khóa theo quyền
  permissions: [
    '*:read', 'tasks:manage', 'team-aliases:*', 'arbitrage-settings:*', 'consumers:*', 'admin:incidents',
  ],
  passwordHash: '',
  apiToken: '',
};

/** Quyền mặc định theo vai trò (khớp bảng vai trò của backend). Ghi đè bằng `permissions` trong WEB_USERS. */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['*'],
  administrator: ['*'],
  manager: ['tasks:*', 'team-aliases:*', 'arbitrage-settings:*', 'consumers:*', 'arbitrage:read'],
  staff: ['tasks:read', 'team-aliases:*', 'consumers:read', 'arbitrage:read'],
  viewer: ['*:read'],
};

function load(): UserRecord[] {
  const raw = process.env.WEB_USERS?.trim();
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as UserRecord[];
    return Array.isArray(list) ? list.filter((u) => u.username && u.passwordHash) : [];
  } catch {
    console.error('[WEB_USERS] JSON không hợp lệ');
    return [];
  }
}

const users = load();

function verify(password: string, hash: string): boolean {
  const [algo, n, salt, key] = hash.split('$');
  if (algo !== 'scrypt' || !n || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Kiểm tra đăng nhập. Chế độ mẫu không có WEB_USERS → demo / demo. */
export function authenticate(username: string, password: string): WebUser | null {
  if (config.mock && users.length === 0)
    return username === 'demo' && password === 'demo' ? publicUser(DEMO) : null;
  const u = users.find((x) => x.username === username);
  // vẫn chạy scrypt khi không có user để thời gian phản hồi không lộ username tồn tại
  const ok = verify(password, u?.passwordHash ?? 'scrypt$16384$AAAA$AAAA');
  return u && ok ? publicUser(u) : null;
}

export function findUser(username: string): UserRecord | null {
  if (config.mock && users.length === 0) return username === 'demo' ? DEMO : null;
  return users.find((u) => u.username === username) ?? null;
}

export const publicUser = (u: Partial<WebUser> & { username: string }): WebUser => ({
  username: u.username,
  name: u.name || u.username,
  role: u.role || '',
  permissions:
    Array.isArray(u.permissions) && u.permissions.length
      ? u.permissions
      : (ROLE_PERMISSIONS[(u.role ?? '').toLowerCase()] ?? ['*']),
});
