'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Zap, History } from 'lucide-react';
import { api } from '@/lib/api';
import type { ArbitrageSignal, ListResult, SignalHistoryItem, SignalStatus } from '@/lib/types';
import { fmtAge, fmtClock, fmtStamp } from '@/lib/format';
import { marketLabel } from '@/lib/markets';
import { CANCEL_REASONS } from '@/lib/skip-reasons';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useIsMobile } from '@/hooks/use-media';
import { useConsoleData } from '../console-data';
import { RoomDrawer, DrawerSection } from '../room-drawer';
import { SignalLegs } from '../signal-legs';
import { PhasePill, Teams } from '../domain';
import { Segmented, Select } from '../ui/controls';
import { KV, PageHeader } from '../ui/layout';
import { Panel } from '../ui/panel';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Pill, type Tone } from '../ui/status';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { LiveStamp, Margin } from '../ui/values';
import { JsonBlock, Mono } from '../ui/code';
import { Button } from '../ui/button';

type FeedItem = ArbitrageSignal & { gone?: { at: number; reason: string | null } };
const FADE_MS = 6_000;

export function SignalsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') === 'history' ? 'history' : 'live';
  return (
    <div>
      <PageHeader
        title="Kèo"
        description="Kèo arbitrage đang phát cho bot. Kèo bị hủy mờ dần kèm lý do."
        actions={
          <Segmented
            value={tab}
            onChange={(v) => router.replace(v === 'live' ? '/keo' : '/keo?tab=history')}
            options={[
              { value: 'live', label: 'Trực tiếp' },
              { value: 'history', label: 'Lịch sử' },
            ]}
          />
        }
      />
      {tab === 'live' ? <LiveFeed /> : <HistoryTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ trực tiếp */

function LiveFeed() {
  const { onEvent, snapshot } = useConsoleData();
  const minMargin = snapshot?.settings.minMargin ?? 0.02;
  const [items, setItems] = useState<FeedItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const reasons = useRef(new Map<string, string>());
  const seen = useRef(new Set<string>());

  const merge = (fresh: ArbitrageSignal[]) => {
    const now = Date.now();
    setItems((old) => {
      const ids = new Set(fresh.map((s) => s.signalId));
      const gone = old
        .filter((o) => !ids.has(o.signalId))
        .map((o) => o.gone ? o : { ...o, gone: { at: now, reason: reasons.current.get(o.signalId) ?? null } })
        .filter((o) => now - o.gone!.at < FADE_MS);
      return [...fresh, ...gone].sort((a, b) => b.issuedAt - a.issuedAt);
    });
    setUpdatedAt(now);
  };

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<ArbitrageSignal[]>('arbitrage/signals')
        .then((s) => {
          if (!alive) return;
          setError(null);
          merge(s);
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const t = setInterval(load, 2_000);
    const off = onEvent((e) => {
      if (e.type === 'signal.cancelled') reasons.current.set(String(e.data.signalId), String(e.data.reason ?? ''));
      if (e.topic === 'signals') void load();
    });
    return () => {
      alive = false;
      clearInterval(t);
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEvent]);

  const live = items.filter((i) => !i.gone);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-caption text-muted-fg">
          <span className="num text-fg">{live.length}</span> kèo đang sống · ngưỡng {(minMargin * 100).toFixed(0)}%
        </span>
        <LiveStamp at={updatedAt} staleAfter={8_000} />
      </div>
      {error && !items.length ? <ErrorState message={error} /> : null}
      {!updatedAt && !error ? <SkeletonRows rows={4} cols={[10, 40, 30]} /> : null}
      {updatedAt && !items.length ? (
        <Empty icon={Zap}>Chưa có kèo nào vượt ngưỡng. Kèo mới sẽ xuất hiện ở đầu danh sách.</Empty>
      ) : null}
      <ul>
        {items.map((s) => {
          const isNew = !seen.current.has(s.signalId);
          seen.current.add(s.signalId);
          return <FeedRow key={s.signalId} s={s} isNew={isNew} minMargin={minMargin} onOpen={() => setRoom(s.room)} />;
        })}
      </ul>
      <RoomDrawer room={room} onClose={() => setRoom(null)} />
    </div>
  );
}

function FeedRow({ s, isNew, minMargin, onOpen }: { s: FeedItem; isNew: boolean; minMargin: number; onOpen: () => void }) {
  const now = useNow(1_000);
  const total = s.expiresAt - s.issuedAt || 1;
  const left = Math.max(0, s.expiresAt - now);
  const gone = !!s.gone;
  return (
    <li
      onClick={onOpen}
      className={cn(
        'relative cursor-pointer border-b border-line py-4 transition-opacity duration-700 hover:bg-hover/40 md:py-3.5',
        isNew && 'animate-flash',
        gone && 'pointer-events-none opacity-35',
      )}
    >
      <div className="flex items-start gap-4 md:items-center md:gap-6">
        <div className="w-[86px] shrink-0 md:w-24">
          <Margin value={s.margin} min={minMargin} size="xl" className={cn(gone && 'text-muted-fg line-through decoration-1')} />
          <div className="num mt-1 text-micro text-muted-fg md:hidden">{gone ? '' : `còn ${fmtAge(left)}`}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-3">
            <Teams teams={s.teams} className="text-body" />
            {s.phase === 'live' ? <PhasePill phase="live" /> : null}
          </div>
          <div className="mt-0.5 truncate text-caption text-muted-fg">
            {marketLabel(s.market)} <span className="num hidden text-faint md:inline">· {s.market}</span>
          </div>
          {gone ? <div className="mt-0.5 text-caption text-muted-fg md:hidden">{s.gone!.reason ? CANCEL_REASONS[s.gone!.reason] ?? s.gone!.reason : 'Đã hủy'}</div> : null}
        </div>
        <SignalLegs legs={s.legs} className="hidden min-w-0 flex-[1.3] md:flex" />
        <div className="hidden w-24 shrink-0 text-right md:block">
          {gone ? (
            <span className="text-caption text-muted-fg">{s.gone!.reason ? CANCEL_REASONS[s.gone!.reason] ?? s.gone!.reason : 'Đã hủy'}</span>
          ) : (
            <span className="num text-caption text-muted-fg">còn {fmtAge(left)}</span>
          )}
        </div>
      </div>
      <SignalLegs legs={s.legs} className="mt-3 md:hidden" stacked />
      {/* thời hạn: vạch mảnh co dần */}
      {!gone ? (
        <div className="absolute inset-x-0 bottom-[-1px] h-px">
          <div className="h-px bg-ok/70 transition-[width] duration-1000 ease-linear" style={{ width: `${(left / total) * 100}%` }} />
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ lịch sử */

const STATUS: Record<SignalStatus, { label: string; tone: Tone }> = {
  active: { label: 'Đang sống', tone: 'ok' },
  superseded: { label: 'Bị ghi đè', tone: 'info' },
  cancelled: { label: 'Đã hủy', tone: 'muted' },
  abandoned: { label: 'Bỏ dở', tone: 'warn' },
};

const RANGES = { '1h': 3_600_000, '6h': 6 * 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 } as const;

function HistoryTab() {
  const mobile = useIsMobile();
  const [status, setStatus] = useState<'' | SignalStatus>('');
  const [phase, setPhase] = useState('');
  const [range, setRange] = useState<keyof typeof RANGES>('24h');
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<SignalHistoryItem | null>(null);
  const from = useMemo(() => Date.now() - RANGES[range], [range]);
  const qs = new URLSearchParams({ limit: String(limit), from: String(from) });
  if (status) qs.set('status', status);
  if (phase) qs.set('phase', phase);
  const { data, error, reload } = useApi<ListResult<SignalHistoryItem>>(`arbitrage/history?${qs}`, 15_000);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value as SignalStatus)} className="w-40" aria-label="Trạng thái">
          <option value="">Mọi trạng thái</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select value={phase} onChange={(e) => setPhase(e.target.value)} className="w-36" aria-label="Kênh">
          <option value="">Mọi kênh</option>
          <option value="live">Live</option>
          <option value="prematch">Trước trận</option>
        </Select>
        <Segmented value={range} onChange={setRange} options={Object.keys(RANGES).map((k) => ({ value: k as keyof typeof RANGES, label: k }))} />
        <span className="num ml-auto text-caption text-faint">{data ? `${data.total} kèo` : ''}</span>
      </div>

      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {!data && !error ? <SkeletonRows rows={8} cols={[8, 30, 10, 12, 30]} /> : null}
      {data && !data.items.length ? <Empty icon={History}>Không có kèo nào trong khoảng thời gian này.</Empty> : null}

      {data?.items.length ? (
        mobile ? (
          <ul>
            {data.items.map((s) => (
              <li key={s.signalId} onClick={() => setOpen(s)} className="cursor-pointer border-b border-line py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <Teams teams={s.teams} className="text-body" />
                  <Margin value={s.margin} min={0.02} className="font-medium" />
                </div>
                <div className="mt-1 flex items-center justify-between text-caption text-muted-fg">
                  <span>
                    {marketLabel(s.market)} · <span className="num">{fmtClock(s.issuedAt)}</span>
                  </span>
                  <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Phát lúc</TH>
                <TH>Trận · market</TH>
                <TH numeric>Margin</TH>
                <TH>Trạng thái</TH>
                <TH>Lý do</TH>
                <TH>Hai chân</TH>
              </tr>
            </THead>
            <tbody>
              {data.items.map((s) => (
                <TR key={s.signalId} interactive onClick={() => setOpen(s)} highlight={open?.signalId === s.signalId}>
                  <TD className="num text-caption text-muted-fg">{fmtClock(s.issuedAt)}</TD>
                  <TD className="max-w-[280px]">
                    <Teams teams={s.teams} />
                    <div className="text-caption text-muted-fg">{marketLabel(s.market)}</div>
                  </TD>
                  <TD numeric>
                    <Margin value={s.margin} min={0.02} />
                  </TD>
                  <TD>
                    <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill>
                  </TD>
                  <TD className="text-caption text-muted-fg">{s.statusReason ? CANCEL_REASONS[s.statusReason] ?? s.statusReason : s.supersededBy ? 'Kèo mới hơn' : '—'}</TD>
                  <TD>
                    <SignalLegs legs={s.legs} className="text-caption" />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )
      ) : null}
      {data && data.total > data.items.length ? (
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" onClick={() => setLimit((l) => l + 50)}>
            Xem thêm
          </Button>
        </div>
      ) : null}

      <Panel open={!!open} onOpenChange={(v) => !v && setOpen(null)} eyebrow={open ? <Mono copy>{open.signalId}</Mono> : null} title={open ? <Teams teams={open.teams} strong={false} /> : ''}>
        {open ? (
          <div>
            <div className="mb-6 flex items-center gap-4">
              <Margin value={open.margin} min={0.02} size="xl" />
              <Pill tone={STATUS[open.status].tone}>{STATUS[open.status].label}</Pill>
            </div>
            <DrawerSection title="Hai chân">
              <SignalLegs legs={open.legs} stacked />
            </DrawerSection>
            <DrawerSection title="Vòng đời">
              <KV
                items={[
                  ['Market', `${marketLabel(open.market)} (${open.market})`],
                  ['Kênh', open.phase === 'live' ? 'Live' : 'Trước trận'],
                  ['Phát lúc', <span key="i" className="num">{fmtStamp(open.issuedAt)}</span>],
                  ['Kết thúc', open.endedAt ? <span key="e" className="num">{fmtStamp(open.endedAt)}</span> : '—'],
                  ['Lý do', open.statusReason ? `${CANCEL_REASONS[open.statusReason] ?? ''} (${open.statusReason})` : '—'],
                  ['Ghi đè bởi', open.supersededBy ? <Mono key="s">{open.supersededBy}</Mono> : '—'],
                  ['Tổ hợp', <Mono key="c">{open.comboId}</Mono>],
                  ['Room', <Mono key="r" copy>{open.room}</Mono>],
                ]}
              />
            </DrawerSection>
            <JsonBlock value={open} />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
