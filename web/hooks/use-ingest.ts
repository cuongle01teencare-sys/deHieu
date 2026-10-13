'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { IngestCounter, IngestSnapshot, SkipReason } from '@/lib/types';
import { useConsoleData } from '@/components/console-data';

export interface KindRate {
  received: number | null;
  set: number | null;
  remove: number | null;
  failed: number | null;
  parseFailed: number | null;
  /** Tốc độ parse_failed tăng so với lần trước (để đánh dấu "đang tăng"). */
  parseRising: boolean;
}

export interface IngestState {
  snap: IngestSnapshot | null;
  error: string | null;
  updatedAt: number | null;
  /** key = `${tenant}|${kind}` */
  rates: Record<string, KindRate>;
  /** Lịch sử tốc độ nhận theo tenant (mẫu ~2s), tối đa 60 mẫu. */
  history: { at: number; [tenant: string]: number }[];
}

const keyOf = (c: IngestCounter) => `${c.tenant}|${c.kind}`;
const pf = (c: IngestCounter) => c.skipped.parse_failed ?? 0;

/** Bộ đếm ingest (stream metrics nếu có, không thì thăm dò 2s) + tốc độ tính từ hai mẫu liên tiếp. */
export function useIngest(): IngestState {
  const { metrics, status } = useConsoleData();
  const [state, setState] = useState<IngestState>({ snap: null, error: null, updatedAt: null, rates: {}, history: [] });
  const prev = useRef<IngestSnapshot | null>(null);
  const prevRates = useRef<Record<string, KindRate>>({});

  const accept = (s: IngestSnapshot) => {
    const p = prev.current;
    // bỏ mẫu quá sát nhau (StrictMode gọi hai lần) để tốc độ không bị 0 giả
    if (p && s.at - p.at < 500) return;
    prev.current = s;
    const dt = p ? (s.at - p.at) / 1000 : 0;
    const rates: Record<string, KindRate> = {};
    const perTenant: Record<string, number> = {};
    for (const c of s.items) {
      const b = p?.items.find((x) => keyOf(x) === keyOf(c));
      const r = (a: number, z: number | undefined) => (b && dt > 0 && z !== undefined ? Math.max(0, (a - z) / dt) : null);
      const parseFailed = r(pf(c), b ? pf(b) : undefined);
      const old = prevRates.current[keyOf(c)];
      rates[keyOf(c)] = {
        received: r(c.received, b?.received),
        set: r(c.set, b?.set),
        remove: r(c.remove, b?.remove),
        failed: r(c.failed, b?.failed),
        parseFailed,
        parseRising: parseFailed !== null && parseFailed > 0.05 && (old?.parseFailed ?? 0) <= parseFailed,
      };
      perTenant[c.tenant] = (perTenant[c.tenant] ?? 0) + (rates[keyOf(c)]!.received ?? 0);
    }
    prevRates.current = rates;
    setState((st) => ({
      snap: s,
      error: null,
      updatedAt: Date.now(),
      rates,
      history: p ? [...st.history, { at: s.at, ...perTenant }].slice(-60) : st.history,
    }));
  };

  // stream: frame metrics có ingest
  useEffect(() => {
    if (metrics?.ingest) accept(metrics.ingest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  // không có stream → thăm dò
  useEffect(() => {
    if (status === 'stream') return;
    let alive = true;
    const load = () =>
      api<IngestSnapshot>('arbitrage/ingest')
        .then((s) => alive && accept(s))
        .catch((e) => alive && setState((st) => ({ ...st, error: e instanceof Error ? e.message : String(e) })));
    void load();
    const t = setInterval(load, 2_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return state;
}

export const sumSkipped = (c: IngestCounter, exclude: SkipReason[] = []) =>
  Object.entries(c.skipped).reduce((n, [k, v]) => (exclude.includes(k as SkipReason) ? n : n + (v ?? 0)), 0);
