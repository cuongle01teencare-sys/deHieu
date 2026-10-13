'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Clock3 } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtClock, fmtCompact, fmtHM, fmtInt, fmtRate } from '@/lib/format';
import { SKIP_ORDER, SKIP_REASONS } from '@/lib/skip-reasons';
import { sortTenants, tenantVar } from '@/lib/tenants';
import type { IngestCounter, SkipReason } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useIngest } from '@/hooks/use-ingest';
import { useNow } from '@/hooks/use-now';
import { useIsMobile } from '@/hooks/use-media';
import { useConsoleData } from '../console-data';
import { Segmented } from '../ui/controls';
import { PageHeader, Section } from '../ui/layout';
import { Popover } from '../ui/menu';
import { ErrorState, SkeletonRows } from '../ui/states';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { TenantDot } from '../ui/tenant';
import { Hint } from '../ui/tooltip';
import { AgeSince, LiveStamp } from '../ui/values';
import { FlowChart, FlowVertical } from './flow';
import { buildFlow } from './model';

export function IngestPage() {
  const params = useSearchParams();
  const { snapshot } = useConsoleData();
  const { snap, error, updatedAt, rates, history } = useIngest();
  const now = useNow(1_000);
  const mobile = useIsMobile();
  const tenants = useMemo(() => sortTenants((snap?.items ?? []).map((c) => c.tenant)), [snap]);
  const [tenant, setTenant] = useState<string>(params.get('tenant') ?? 'all');

  /** Ngưỡng "không nhận dữ liệu": 5× intervalMs (≥ 30s); task stream 15 phút. */
  const staleMs = (c: IngestCounter) => {
    const t = snapshot?.tasks.find((x) => x.spec.kind === c.kind && x.state === 'RUNNING');
    if (c.kind.endsWith('.stream')) return 15 * 60_000;
    const iv = Number(t?.spec.params.intervalMs ?? 0);
    return Math.max(30_000, iv * 5);
  };
  const isRunning = (c: IngestCounter) => !!snapshot?.tasks.some((x) => x.spec.kind === c.kind && x.state === 'RUNNING');

  // kèo đang sống theo tenant (đếm chân)
  const activeByTenant = useMemo(() => {
    const m: Record<string, number> = {};
    const total = snapshot?.arbitrage.activeSignals ?? 0;
    for (const t of tenants) m[t] = total; // mỗi kèo có chân ở 2 tenant
    return m;
  }, [snapshot, tenants]);

  const model = useMemo(
    () => (snap ? buildFlow(tenant === 'all' ? null : tenant, snap.items, rates, snapshot, activeByTenant, now, staleMs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, rates, snapshot, tenant, activeByTenant],
  );

  const rows = (snap?.items ?? []).filter((c) => tenant === 'all' || c.tenant === tenant);

  return (
    <div>
      <PageHeader
        title="Luồng dữ liệu"
        description="Dữ liệu rơi ở chặng nào? Độ dày dải tỉ lệ với khối lượng — phần bị bỏ qua rơi xuống và mờ dần, lỗi màu đỏ."
        meta={
          <>
            <LiveStamp at={updatedAt} staleAfter={8_000} />
            {snap ? <span className="text-caption text-faint">cộng dồn từ {fmtHM(snap.since)}</span> : null}
          </>
        }
      />

      <div className="mb-6 overflow-x-auto scrollbar-none">
        <Segmented
          value={tenant}
          onChange={setTenant}
          options={[
            { value: 'all', label: 'Tất cả' },
            ...tenants.map((t) => ({
              value: t,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <TenantDot tenant={t} /> {t}
                </span>
              ),
            })),
          ]}
        />
      </div>

      {error && !snap ? <ErrorState message={error} /> : null}

      <section className="mb-12">
        {model ? (
          mobile ? (
            <FlowVertical model={model} />
          ) : (
            <FlowChart model={model} />
          )
        ) : (
          <div className="skeleton h-[300px] w-full opacity-40" />
        )}
      </section>

      <Section title="Theo tenant × kind" description="Bấm vào thanh lý do bỏ qua để xem giải thích">
        {snap ? (
          mobile ? (
            <MobileKindList rows={rows} rates={rates} staleMs={staleMs} isRunning={isRunning} now={now} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Kind</TH>
                  <TH numeric>Nhận</TH>
                  <TH numeric>/s</TH>
                  <TH numeric>Lỗi</TH>
                  <TH numeric>set</TH>
                  <TH numeric>remove</TH>
                  <TH numeric>Nhận cuối</TH>
                  <TH numeric>Đổi cuối</TH>
                  <TH className="w-[22%]">Lý do bỏ qua</TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((c) => {
                  const r = rates[`${c.tenant}|${c.kind}`];
                  const noData = isRunning(c) && (c.lastReceivedAt === null || now - c.lastReceivedAt > staleMs(c));
                  const rising = !!r?.parseRising;
                  return (
                    <TR key={`${c.tenant}|${c.kind}`} className={cn(rising && 'bg-critical-soft')}>
                      <TD>
                        <span className="flex items-center gap-2">
                          <TenantDot tenant={c.tenant} />
                          <span className="num text-fg">{c.kind}</span>
                          {rising ? (
                            <Hint content="parse_failed đang tăng — có thể tenant đổi API">
                              <AlertTriangle className="size-3.5 text-critical" />
                            </Hint>
                          ) : noData ? (
                            <Hint content="Task đang chạy nhưng không nhận được bản tin">
                              <Clock3 className="size-3.5 text-warn" />
                            </Hint>
                          ) : null}
                        </span>
                      </TD>
                      <TD numeric>{fmtCompact(c.received)}</TD>
                      <TD numeric className={cn(noData && 'text-warn')}>{fmtRate(r?.received)}</TD>
                      <TD numeric className={cn(c.failed + (c.skipped.parse_failed ?? 0) > 0 ? 'text-critical' : 'text-faint')}>
                        {fmtInt(c.failed + (c.skipped.parse_failed ?? 0))}
                      </TD>
                      <TD numeric>{fmtCompact(c.set)}</TD>
                      <TD numeric className="text-muted-fg">{fmtCompact(c.remove)}</TD>
                      <TD numeric>
                        <AgeSince at={c.lastReceivedAt} staleAfter={staleMs(c)} />
                      </TD>
                      <TD numeric>
                        <AgeSince at={c.lastChangeAt} />
                      </TD>
                      <TD>
                        <SkipBar counter={c} />
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )
        ) : (
          <SkeletonRows rows={5} cols={[18, 8, 6, 6, 8, 8, 8, 8, 22]} />
        )}
      </Section>

      <Section title="Tốc độ nhận" description="msg/s theo tenant · 2 phút gần nhất">
        <RateChart history={history} tenants={tenant === 'all' ? tenants : [tenant]} />
      </Section>
    </div>
  );
}

/** Thanh xếp chồng mảnh các lý do bỏ qua; bấm → popover giải thích. */
function SkipBar({ counter }: { counter: IngestCounter }) {
  const entries = SKIP_ORDER.map((k) => [k, counter.skipped[k] ?? 0] as [SkipReason, number]).filter(([, v]) => v > 0);
  const total = entries.reduce((n, [, v]) => n + v, 0);
  if (!total) return <span className="text-caption text-faint">—</span>;
  const shade = (k: SkipReason, i: number) => {
    const tone = SKIP_REASONS[k].tone;
    if (tone === 'critical') return 'var(--critical)';
    if (tone === 'warn') return 'var(--warn)';
    return `color-mix(in oklab, var(--fg-muted) ${70 - i * 14}%, transparent)`;
  };
  return (
    <Popover
      className="w-80"
      align="end"
      trigger={
        <button type="button" className="group flex w-full items-center gap-3" aria-label="Xem lý do bỏ qua">
          <span className="flex h-1.5 min-w-0 flex-1 gap-px overflow-hidden rounded-full">
            {entries.map(([k, v], i) => (
              <span key={k} className="h-full" style={{ width: `${(v / total) * 100}%`, minWidth: 2, background: shade(k, i) }} />
            ))}
          </span>
          <span className="num shrink-0 text-caption text-muted-fg group-hover:text-fg">{fmtCompact(total)}</span>
        </button>
      }
    >
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-body font-medium">Lý do bỏ qua</span>
        <span className="num text-caption text-faint">{counter.kind}</span>
      </div>
      <ul>
        {entries
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <li key={k} className="border-b border-line py-2 last:border-0">
              <div className="flex items-baseline gap-2">
                <span className={cn('text-body', SKIP_REASONS[k].tone === 'critical' ? 'text-critical' : 'text-fg')}>{SKIP_REASONS[k].label}</span>
                <span className="num text-micro text-faint">{k}</span>
                <span className="num ml-auto text-caption">{fmtCompact(v)}</span>
              </div>
              <p className="mt-0.5 text-caption text-muted-fg">{SKIP_REASONS[k].help}</p>
            </li>
          ))}
      </ul>
    </Popover>
  );
}

function MobileKindList({
  rows,
  rates,
  staleMs,
  isRunning,
  now,
}: {
  rows: IngestCounter[];
  rates: ReturnType<typeof useIngest>['rates'];
  staleMs: (c: IngestCounter) => number;
  isRunning: (c: IngestCounter) => boolean;
  now: number;
}) {
  return (
    <ul>
      {rows.map((c) => {
        const r = rates[`${c.tenant}|${c.kind}`];
        const noData = isRunning(c) && (c.lastReceivedAt === null || now - c.lastReceivedAt > staleMs(c));
        return (
          <li key={c.kind} className={cn('border-b border-line py-3 last:border-0', r?.parseRising && '-mx-4 bg-critical-soft px-4')}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <TenantDot tenant={c.tenant} />
                <span className="num truncate text-body text-fg">{c.kind}</span>
              </span>
              <span className={cn('num text-body', noData && 'text-warn')}>
                {fmtRate(r?.received)}
                <span className="text-faint">/s</span>
              </span>
            </div>
            <div className="num mt-1 flex justify-between text-caption text-muted-fg">
              <span>
                {fmtCompact(c.received)} nhận · <span className={cn(c.failed + (c.skipped.parse_failed ?? 0) && 'text-critical')}>{fmtInt(c.failed + (c.skipped.parse_failed ?? 0))} lỗi</span>
              </span>
              <AgeSince at={c.lastReceivedAt} staleAfter={staleMs(c)} />
            </div>
            <div className="mt-2.5">
              <SkipBar counter={c} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Biểu đồ đường không khung: nhãn trực tiếp ở cuối đường, lưới ngang nhạt. */
function RateChart({ history, tenants }: { history: { at: number; [k: string]: number }[]; tenants: string[] }) {
  if (history.length < 2)
    return <p className="py-6 text-caption text-faint">Đang thu thập mẫu…</p>;
  const last = history[history.length - 1]!;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <LineChart data={history} margin={{ top: 8, right: 132, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="at" tickFormatter={(v: number) => fmtClock(v)} tick={{ fill: 'var(--fg-faint)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={60} />
          <YAxis tick={{ fill: 'var(--fg-faint)', fontSize: 11, fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} width={36} />
          <Tooltip
            cursor={{ stroke: 'var(--line-strong)' }}
            contentStyle={{ background: 'var(--raised)', border: 0, borderRadius: 8, boxShadow: 'var(--shadow-pop)', fontSize: 12 }}
            labelFormatter={(v) => fmtClock(Number(v))}
            formatter={(v, name) => [`${fmtRate(Number(v))}/s`, String(name)]}
          />
          {tenants.map((t) => (
            <Line
              key={t}
              dataKey={t}
              stroke={tenantVar(t)}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              label={(p: { index?: number; x?: number | string; y?: number | string }) =>
                p.index === history.length - 1 ? (
                  <text key={t} x={Number(p.x) + 8} y={Number(p.y) + 4} fontSize={11} fill={tenantVar(t)} fontFamily="var(--font-mono)">
                    {t} {fmtRate(last[t])}
                  </text>
                ) : (
                  <g key={`${t}-${p.index}`} />
                )
              }
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

