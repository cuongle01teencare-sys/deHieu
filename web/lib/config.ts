import 'server-only';

/** Cấu hình phía server (đọc env một chỗ). */
export const config = {
  mock: process.env.ARB_MOCK === 'true',
  backendUrl: (process.env.BACKEND_URL ?? '').replace(/\/+$/, ''),
  adminWsUrl: process.env.BACKEND_ADMIN_WS_URL ?? '',
  envLabel: process.env.NEXT_PUBLIC_ENV_LABEL ?? 'Production',
};
