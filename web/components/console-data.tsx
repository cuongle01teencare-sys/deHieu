'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from '@/lib/api';
import type { AdminMetrics, AdminSnapshot, IngestSnapshot, OpsEvent } from '@/lib/types';

export type StreamStatus = 'connecting' | 'stream' | 'polling' | 'reconnecting';

export interface TenantRate {
  /** message/s, tính từ hai lần lấy bộ đếm gần nhất. */
  rate: number | null;
  /** Tối đa 12 mẫu gần nhất (cho sparkline). */
  history: number[];
  received: number;
  set: number;
  remove: number;
  parseFailed: number;
  /** parse_failed / received trong khoảng gần nhất (cộng dồn nếu chưa đủ mẫu). */
  parseFailRatio: number;
  lastReceivedAt: number | null;
}

interface ConsoleData {
  snapshot: AdminSnapshot | null;
  snapshotError: string | null;
  snapshotAt: number | null;
  reloadSnapshot: () => void;
  metrics: AdminMetrics | null;
  status: StreamStatus;
  lastFrameAt: number | null;
  tenants: Record<string, TenantRate>;
  /** Đăng ký nghe sự kiện stream; trả về hàm hủy. */
  onEvent: (cb: (e: OpsEvent) => void) => () => void;
}

const Ctx = createContext<ConsoleData | null>(null);

export function useConsoleData(): ConsoleData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConsoleData phải nằm trong <ConsoleDataProvider>');
  return v;
}

const TOPICS = ['alerts', 'tasks', 'nodes', 'consumers', 'signals', 'metrics'];
/** Sự kiện thuộc các topic này làm snapshot cũ đi → xin lại. */
const SNAPSHOT_TOPICS = new Set(['alerts', 'tasks', 'nodes', 'consumers']);
const HISTORY = 12;
const CACHE_KEY = 'arbops-snapshot';

/** Gom bộ đếm ingest theo tenant (cộng mọi kind). */
function sumByTenant(s: IngestSnapshot) {
  const by: Record<string, { received: number; set: number; remove: number; parseFailed: number; last: number | null }> = {};
  for (const c of s.items) {
    const t = (by[c.tenant] ??= { received: 0, set: 0, remove: 0, parseFailed: 0, last: null });
    t.received += c.received;
    t.set += c.set;
    t.remove += c.remove;
    t.parseFailed += c.skipped.parse_failed ?? 0;
    if (c.lastReceivedAt && (!t.last || c.lastReceivedAt > t.last)) t.last = c.lastReceivedAt;
  }
  return by;
}

export function ConsoleDataProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const [tenants, setTenants] = useState<Record<string, TenantRate>>({});

  const listeners = useRef(new Set<(e: OpsEvent) => void>());
  const prevIngest = useRef<IngestSnapshot | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const acceptSnapshot = useCallback((s: AdminSnapshot) => {
    setSnapshot(s);
    setSnapshotAt(Date.now());
    setSnapshotError(null);
    // bản chụp cuối cho PWA offline (hiển thị kèm nhãn dữ liệu cũ)
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), s }));
    } catch {
      /* đầy bộ nhớ / private mode */
    }
  }, []);

  // mở app khi offline → dùng bản chụp cuối
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw) as { at: number; s: AdminSnapshot };
      setSnapshot((cur) => cur ?? c.s);
      setSnapshotAt((cur) => cur ?? c.at);
    } catch {
      /* bỏ qua */
    }
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      acceptSnapshot(await api<AdminSnapshot>('admin/snapshot'));
    } catch (e) {
      setSnapshotError(e instanceof Error ? e.message : String(e));
    }
  }, [acceptSnapshot]);

  const acceptIngest = useCallback((s: IngestSnapshot) => {
    const prev = prevIngest.current;
    // bỏ mẫu quá sát nhau → tốc độ không bị 0 giả
    if (prev && s.at - prev.at < 500) return;
    prevIngest.current = s;
    const now = sumByTenant(s);
    const before = prev ? sumByTenant(prev) : null;
    const dt = prev ? (s.at - prev.at) / 1000 : 0;
    setTenants((old) => {
      const next: Record<string, TenantRate> = {};
      for (const [tenant, c] of Object.entries(now)) {
        const b = before?.[tenant];
        const rate = b && dt > 0 ? Math.max(0, (c.received - b.received) / dt) : null;
        const dRecv = b ? c.received - b.received : c.received;
        const dFail = b ? c.parseFailed - b.parseFailed : c.parseFailed;
        const history = [...(old[tenant]?.history ?? []), ...(rate !== null ? [rate] : [])].slice(-HISTORY);
        next[tenant] = {
          rate,
          history,
          received: c.received,
          set: c.set,
          remove: c.remove,
          parseFailed: c.parseFailed,
          parseFailRatio:
            dRecv > 0 ? dFail / dRecv : c.received > 0 ? c.parseFailed / c.received : 0,
          lastReceivedAt: c.last,
        };
      }
      return next;
    });
  }, []);

  const emit = useCallback((e: OpsEvent) => {
    for (const cb of listeners.current) cb(e);
  }, []);

  // ---- stream (vé một lần) với dự phòng polling
  useEffect(() => {
    let stopped = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimers: ReturnType<typeof setInterval>[] = [];

    const stopPolling = () => {
      pollTimers.forEach(clearInterval);
      pollTimers = [];
    };
    const startPolling = () => {
      if (pollTimers.length) return;
      void fetchSnapshot();
      const ingest = () =>
        api<IngestSnapshot>('arbitrage/ingest')
          .then((s) => {
            acceptIngest(s);
            setLastFrameAt(Date.now());
          })
          .catch(() => undefined);
      void ingest();
      pollTimers = [setInterval(() => void fetchSnapshot(), 5_000), setInterval(ingest, 2_000)];
    };

    const connect = async () => {
      if (stopped) return;
      let ticket: { mode: 'polling' } | { mode: 'stream'; ticket: string; url: string };
      try {
        const r = await fetch('/api/ws-ticket', { method: 'POST' });
        if (r.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        ticket = await r.json();
      } catch {
        if (stopped) return;
        setStatus('reconnecting');
        startPolling();
        retryTimer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** retry++));
        return;
      }
      if (stopped) return;
      if (ticket.mode === 'polling') {
        setStatus('polling');
        startPolling();
        return;
      }

      const ws = new WebSocket(ticket.url);
      wsRef.current = ws;
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: 'hello', ticket: ticket.ticket, topics: TOPICS }));
      ws.onmessage = (m) => {
        let f: { type: string; data?: unknown; event?: OpsEvent; reason?: string };
        try {
          f = JSON.parse(String(m.data));
        } catch {
          return;
        }
        setLastFrameAt(Date.now());
        if (f.type === 'welcome') {
          retry = 0;
          setStatus('stream');
          stopPolling();
        } else if (f.type === 'snapshot') acceptSnapshot(f.data as AdminSnapshot);
        else if (f.type === 'metrics') {
          const mt = f.data as AdminMetrics;
          setMetrics(mt);
          if (mt.ingest) acceptIngest(mt.ingest);
        } else if (f.type === 'event' && f.event) {
          emit(f.event);
          if (SNAPSHOT_TOPICS.has(f.event.topic)) {
            // gộp nhiều sự kiện liên tiếp thành một lần xin lại snapshot
            if (resyncTimer.current) clearTimeout(resyncTimer.current);
            resyncTimer.current = setTimeout(() => {
              if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'resync' }));
            }, 400);
          }
        }
      };
      ws.onclose = () => {
        wsRef.current = null;
        if (stopped) return;
        setStatus('reconnecting');
        startPolling();
        retryTimer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** retry++));
      };
    };

    void connect();
    return () => {
      stopped = true;
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
      if (resyncTimer.current) clearTimeout(resyncTimer.current);
      wsRef.current?.close();
    };
  }, [acceptIngest, acceptSnapshot, emit, fetchSnapshot]);

  const reloadSnapshot = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'resync' }));
    else void fetchSnapshot();
  }, [fetchSnapshot]);

  const onEvent = useCallback((cb: (e: OpsEvent) => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);

  const value = useMemo<ConsoleData>(
    () => ({
      snapshot,
      snapshotError,
      snapshotAt,
      reloadSnapshot,
      metrics,
      status,
      lastFrameAt,
      tenants,
      onEvent,
    }),
    [snapshot, snapshotError, snapshotAt, reloadSnapshot, metrics, status, lastFrameAt, tenants, onEvent],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
