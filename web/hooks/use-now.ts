'use client';

import { useEffect, useState } from 'react';

/** Thời gian hiện tại, cập nhật mỗi `everyMs` (để hiển thị tuổi dữ liệu tự nhảy). */
export function useNow(everyMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
