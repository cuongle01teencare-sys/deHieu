import type { AdminSnapshot, IngestCounter, SkipReason } from '@/lib/types';
import type { KindRate } from '@/hooks/use-ingest';

export interface FlowBranch {
  id: string;
  label: string;
  value: number;
  tone: 'muted' | 'warn' | 'critical';
  /** Chi tiết theo lý do (popover). */
  reasons?: { reason: SkipReason | 'failed'; value: number }[];
  /** Đang tăng (chỉ nhánh lỗi). */
  rising?: boolean;
}

export interface FlowStage {
  id: string;
  label: string;
  value: number;
  rate?: number | null;
  sub?: string;
  /** Phần đi tiếp sang chặng sau (0..1). */
  keep: number;
  branches: FlowBranch[];
}

export interface FlowSource {
  kind: string;
  received: number;
  rate: number | null;
  stale: boolean;
}

export interface FlowModel {
  tenant: string | null; // null = tất cả
  sources: FlowSource[];
  stages: FlowStage[];
}

const ERR: SkipReason[] = ['parse_failed'];

/** Dựng mô hình luồng cho một tenant (hoặc tất cả) từ bộ đếm ingest + snapshot. */
export function buildFlow(
  tenant: string | null,
  items: IngestCounter[],
  rates: Record<string, KindRate>,
  snapshot: AdminSnapshot | null,
  activeByTenant: Record<string, number>,
  now: number,
  staleMs: (c: IngestCounter) => number,
): FlowModel {
  const list = items.filter((c) => !tenant || c.tenant === tenant);
  const sum = (f: (c: IngestCounter) => number) => list.reduce((n, c) => n + f(c), 0);
  const rsum = (f: (r: KindRate) => number | null) => {
    let any = false;
    const v = list.reduce((n, c) => {
      const x = rates[`${c.tenant}|${c.kind}`];
      const y = x ? f(x) : null;
      if (y !== null) any = true;
      return n + (y ?? 0);
    }, 0);
    return any ? v : null;
  };

  const received = sum((c) => c.received);
  const set = sum((c) => c.set);
  const remove = sum((c) => c.remove);
  const failed = sum((c) => c.failed);
  const parse = sum((c) => c.skipped.parse_failed ?? 0);
  const reasons = new Map<SkipReason, number>();
  for (const c of list)
    for (const [k, v] of Object.entries(c.skipped)) if (!ERR.includes(k as SkipReason)) reasons.set(k as SkipReason, (reasons.get(k as SkipReason) ?? 0) + (v ?? 0));
  const skipped = [...reasons.values()].reduce((a, b) => a + b, 0);
  const items_ = set + remove + skipped + failed + parse || 1;
  const rising = list.some((c) => rates[`${c.tenant}|${c.kind}`]?.parseRising);

  const lanes = (snapshot?.lanes ?? []).filter((l) => !tenant || l.lane.startsWith(`${tenant}:`));
  const processed = lanes.reduce((n, l) => n + l.processed, 0);
  const coalesced = lanes.reduce((n, l) => n + l.coalesced, 0);
  const queued = lanes.reduce((n, l) => n + l.queued, 0);

  const by = snapshot?.arbitrage.rooms.byTenant ?? {};
  const tenants = tenant ? [tenant] : Object.keys(by);
  const lines = tenants.reduce((n, t) => n + (by[t]?.lines ?? 0), 0);
  const open = tenants.reduce((n, t) => n + (by[t]?.open ?? 0), 0);
  const suspended = tenants.reduce((n, t) => n + (by[t]?.suspended ?? 0), 0);
  const signals = tenant ? activeByTenant[tenant] ?? 0 : snapshot?.arbitrage.activeSignals ?? 0;

  return {
    tenant,
    sources: list.map((c) => ({
      kind: tenant ? c.kind : c.kind,
      received: c.received,
      rate: rates[`${c.tenant}|${c.kind}`]?.received ?? null,
      stale: c.lastReceivedAt === null || now - c.lastReceivedAt > staleMs(c),
    })),
    stages: [
      {
        id: 'received',
        label: 'Nhận',
        value: received,
        rate: rsum((r) => r.received),
        sub: 'bản tin',
        keep: (set + remove) / items_,
        branches: [
          {
            id: 'skipped',
            label: 'Bỏ qua',
            value: skipped,
            tone: 'muted',
            reasons: [...reasons.entries()].map(([reason, value]) => ({ reason, value })).sort((a, b) => b.value - a.value),
          },
          {
            id: 'errors',
            label: 'Lỗi',
            value: failed + parse,
            tone: 'critical',
            rising,
            reasons: [
              { reason: 'parse_failed' as const, value: parse },
              { reason: 'failed' as const, value: failed },
            ].filter((r) => r.value > 0),
          },
        ],
      },
      {
        id: 'changes',
        label: 'Thay đổi dòng kèo',
        value: set + remove,
        rate: rsum((r) => (r.set ?? 0) + (r.remove ?? 0)),
        sub: `set ${compact(set)} · remove ${compact(remove)}`,
        keep: processed + coalesced ? processed / (processed + coalesced) : 1,
        branches: [{ id: 'coalesced', label: 'Gộp bản cũ', value: coalesced, tone: 'muted' }],
      },
      {
        id: 'lanes',
        label: 'Làn xử lý',
        value: processed,
        sub: queued ? `${compact(queued)} đang chờ` : 'không tồn',
        keep: lines ? open / lines : 1,
        branches: [{ id: 'suspended', label: 'Tạm khóa', value: suspended, tone: 'warn' }],
      },
      {
        id: 'rooms',
        label: 'Room · dòng mở',
        value: open,
        sub: `${compact(lines)} dòng`,
        keep: open ? Math.min(1, signals / open) : 0,
        branches: [],
      },
      { id: 'signals', label: 'Kèo', value: signals, sub: 'đang sống', keep: 1, branches: [] },
    ],
  };
}

export const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : new Intl.NumberFormat('en-US').format(Math.round(n));
