/** Gọi backend qua BFF (/api/backend/*) từ trình duyệt. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/backend/${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login';
  }
  const body = (await res.json().catch(() => null)) as T & { message?: string };
  if (!res.ok) throw new ApiError(res.status, body?.message ?? `HTTP ${res.status}`);
  return body;
}
