import 'server-only';
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { config } from './config';
import { findUser, publicUser } from './users';
import type { WebUser } from './types';

export interface SessionData {
  username?: string;
}

const DEV_SECRET = 'dev-only-secret-for-mock-mode-please-change-me';

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (config.mock || process.env.NODE_ENV !== 'production') return DEV_SECRET;
  throw new Error('SESSION_SECRET phải có ít nhất 32 ký tự');
}

const options = (): SessionOptions => ({
  password: secret(),
  cookieName: 'arbops_session',
  ttl: 12 * 3600,
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  },
});

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options());
}

/** Người dùng hiện tại (đã kiểm tra còn trong WEB_USERS), hoặc null. */
export async function currentUser(): Promise<WebUser | null> {
  const s = await getSession();
  const u = s.username ? findUser(s.username) : null;
  return u ? publicUser(u) : null;
}
