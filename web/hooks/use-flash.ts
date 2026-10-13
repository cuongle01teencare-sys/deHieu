'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Trả về một khóa đổi mỗi khi `value` thay đổi (bỏ qua lần đầu) — gắn làm `key` cho phần tử
 * có class `animate-flash` để nền sáng nhẹ rồi tắt dần.
 */
export function useFlash(value: unknown): number {
  const prev = useRef(value);
  const [n, setN] = useState(0);
  const sig = JSON.stringify(value);
  useEffect(() => {
    if (JSON.stringify(prev.current) !== sig) {
      prev.current = value;
      setN((x) => x + 1);
    }
  }, [sig, value]);
  return n;
}
