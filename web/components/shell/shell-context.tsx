'use client';

import { createContext, useCallback, useContext } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/permissions';
import type { WebUser } from '@/lib/types';
import { useOnline } from '@/hooks/use-online';

export interface ShellValue {
  user: WebUser;
  envLabel: string;
}

export const ShellCtx = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const v = useContext(ShellCtx);
  if (!v) throw new Error('useShell phải nằm trong <AppShell>');
  return v;
}

/** Có quyền không. */
export function useCan(permission: string): boolean {
  return hasPermission(useShell().user.permissions, permission);
}

/**
 * Lý do một thao tác đang bị khóa (null = được phép): offline hoặc thiếu quyền.
 * Truyền thẳng vào `disabledReason` của Button / MenuItem.
 */
export function useGuard(permission: string | null): string | null {
  const online = useOnline();
  const { user } = useShell();
  if (!online) return 'Mất kết nối — thao tác tạm khóa';
  if (permission && !hasPermission(user.permissions, permission)) return `Thiếu quyền ${permission}`;
  return null;
}

/** Gọi API ghi + toast kết quả. Trả về dữ liệu, hoặc null khi lỗi. */
export function useMutate() {
  return useCallback(
    async <T,>(path: string, init: { method: string; body?: unknown }, success?: string): Promise<T | null> => {
      try {
        const r = await api<T>(path, {
          method: init.method,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        if (success) toast.success(success);
        return r;
      } catch (e) {
        const msg = e instanceof ApiError && e.status === 403 ? `Không có quyền: ${e.message}` : e instanceof Error ? e.message : String(e);
        toast.error('Thao tác không thành công', { description: msg });
        return null;
      }
    },
    [],
  );
}
