'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
  reload: () => Promise<void>;
}

/** GET định kỳ một endpoint của backend. refreshMs = 0 → chỉ lấy một lần. */
export function useApi<T>(path: string | null, refreshMs = 0): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    try {
      const d = await api<T>(path);
      if (mine !== seq.current) return;
      setData(d);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(path !== null);
    void reload();
    if (!refreshMs || !path) return;
    const t = setInterval(() => void reload(), refreshMs);
    return () => clearInterval(t);
  }, [path, refreshMs, reload]);

  return { data, error, loading, updatedAt, reload };
}
