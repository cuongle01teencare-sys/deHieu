'use client';

import { useSyncExternalStore } from 'react';

const sub = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/** Trạng thái mạng của trình duyệt (PWA offline). */
export const useOnline = (): boolean =>
  useSyncExternalStore(sub, () => navigator.onLine, () => true);
