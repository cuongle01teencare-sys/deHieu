import 'server-only';
import { config } from './config';
import { findUser } from './users';
import { mockRequest } from './mock';

export interface BackendResponse {
  status: number;
  body: unknown;
}

/** Chỉ cho phép chuyển tiếp các nhóm API này (không mở toàn bộ backend qua web). */
const ALLOWED = /^(arbitrage|admin|tasks|consumers|notify|team-aliases|trading)(\/|$)/;

export const isAllowedPath = (path: string): boolean =>
  ALLOWED.test(path) && !path.includes('..');

/**
 * Gọi backend thay mặt người dùng web: gắn token API của người đó (server-side).
 * Chế độ mẫu → trả dữ liệu mẫu.
 */
export async function callBackend(
  username: string,
  method: string,
  path: string,
  search = '',
  body?: unknown,
): Promise<BackendResponse> {
  if (config.mock) return mockRequest(method, path, search, body);
  const user = findUser(username);
  if (!user?.apiToken) return { status: 401, body: { message: 'Không có token API' } };
  if (!config.backendUrl) return { status: 500, body: { message: 'Thiếu BACKEND_URL' } };

  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${config.backendUrl}/${encoded}${search}`, {
    method,
    headers: {
      authorization: `Bearer ${user.apiToken}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text.slice(0, 500) };
  }
  return { status: res.status, body: parsed };
}
