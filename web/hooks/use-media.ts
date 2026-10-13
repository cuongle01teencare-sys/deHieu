'use client';

import { useSyncExternalStore } from 'react';

function subscribe(query: string) {
  return (cb: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  };
}

/** Khớp media query (SSR trả `fallback`). */
export function useMedia(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}

/** < 768px: shell mobile (tab dưới, bottom sheet, danh sách thay bảng). */
export const useIsMobile = () => useMedia('(max-width: 767px)');
/** Thiết bị cảm ứng không có hover → tooltip chuyển thành chạm để xem. */
export const useNoHover = () => useMedia('(hover: none)');
