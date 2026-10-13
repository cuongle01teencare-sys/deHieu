'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'arbops-theme';

const read = (): Theme =>
  document.documentElement.classList.contains('light') ? 'light' : 'dark';

const listeners = new Set<() => void>();

/** Áp theme lên <html> (class dark | light), nhớ trong trình duyệt. Dark mặc định. */
export function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.classList.remove('dark', 'light');
  el.classList.add(t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0e1116' : '#f7f6f3');
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
}

/** Script chạy trước khi vẽ để không nháy sai theme. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t!=='light')t='dark';document.documentElement.classList.remove('dark','light');document.documentElement.classList.add(t)}catch(e){}`;

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => 'dark' as Theme,
  );
  const toggle = useCallback(() => applyTheme(read() === 'dark' ? 'light' : 'dark'), []);
  return [theme, toggle];
}
