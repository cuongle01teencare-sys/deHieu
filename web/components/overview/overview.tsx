'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronDown, Siren } from 'lucide-react';
import { fmtCompact, fmtInt, fmtPct, fmtRate } from '@/lib/format';
import { sortTenants } from '@/lib/tenants';
import type { TaskState } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useConsoleData } from '../console-data';
import { IncidentList } from '../incidents/incident-list';
import { PageHeader, Section } from '../ui/layout';
import { SegmentBar, Sparkline, Stat, StatStrip } from '../ui/stats';
import { ErrorState, SkeletonRows } from '../ui/states';
import { DotLabel, StatusDot, TASK_STATE_TONE, type Tone } from '../ui/status';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { Tenant } from '../ui/tenant';
import { Age, LiveStamp } from '../ui/values';
import { tenantVar } from '@/lib/tenants';

const STATE_ORDER: TaskState[] = ['RUNNING', 'RESTARTING', 'FAILED', 'STARTING', 'INITIALIZING', 'READY', 'CREATED', 'STOPPING', 'STOPPED'];
const STALE_MS = 30_000;
const PARSE_WARN = 0.01;

export function Overview() {
  const { snapshot, snapshotError, snapshotAt, reloadSnapshot, metrics, tenants } = useConsoleData();
  const [showLanes, setShowLanes] = useState(false);
  const router = useRouter();

  const arb = snapshot?.arbitrage;
  const rooms = metrics?.rooms ?? arb?.rooms;
  const evaluator = metrics?.evaluator ?? arb?.evaluator;
  const activeSignals = metrics?.activeSignals ?? arb?.activeSignals;
  const consumers = metrics?.consumers ?? (snapshot && {
    total: snapshot.consumers.length,
    connected: snapshot.consumers.filter((c) => c.connected).length,
    pending: snapshot.consumers.reduce((n, c) => n + c.pending, 0),
  });
  const lanes = metrics?.lanes ?? snapshot?.lanes ?? [];

  // lịch sử ngắn cho sparkline của kèo đang sống
  const sigHist = useRef<number[]>([]);
  const [, force] = useState(0);
  useEffect(() => {
    if (activeSignals === undefined) return;
    sigHist.current = [...sigHist.current, activeSignals].slice(-20);
    force((x) => x + 1);
  }, [activeSignals, snapshotAt]);

  const byState = useMemo(() => {
    const m = new Map<TaskState, number>();
    for (const t of snapshot?.tasks ?? []) m.set(t.state, (m.get(t.state) ?? 0) + 1);
    return m;
  }, [snapshot]);
  const problemTasks = (snapshot?.tasks ?? []).filter((t) => ['FAILED', 'RESTARTING'].includes(t.state));

  const incidents = snapshot?.incidents ?? [];
  const critical = incidents.filter((i) => i.severity === 'critical' && !i.acknowledgedAt);

  if (!snapshot && snapshotError) return <ErrorState message={snapshotError} onRetry={reloadSnapshot} />;

  return (
    <div className="flex min-w-0 flex-col">
      <PageHeader title="Tổng quan" description="Dữ liệu vào → ghép room → kèo ra. Mọi số liệu cập nhật trực tiếp." meta={<LiveStamp at={snapshotAt} />} />

      {critical.length ? (
        <Link
          href="/su-co"
          className="order-first -mx-4 mb-6 flex items-center gap-3 border-y border-critical/20 bg-critical-soft px-4 py-2.5 text-body text-critical md:order-none md:mx-0 md:mb-8 md:rounded-[6px] md:border md:px-4"
        >
          <Siren className="size-4 shrink-0 stroke-[1.5]" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{critical.length} sự cố nghiêm trọng</span>
            <span className="text-critical/80"> · {critical[0]!.title}</span>
          </span>
          <ArrowRight className="size-4 shrink-0" />
        </Link>
      ) : null}

      {/* Dải chỉ số */}
      <div className="order-2 mb-12 md:order-none">
        {rooms && evaluator && consumers ? (
          <StatStrip>
            <Stat size="lg" label="Kèo đang sống" value={fmtInt(activeSignals ?? 0)} spark={sigHist.current} tone={activeSignals ? 'ok' : undefined} />
            <Stat label="Room · đã ghép ≥2 tenant" value={fmtInt(rooms.total)} sub={`/ ${fmtInt(rooms.matched)}`} />
            <Stat label="Có tổ hợp" value={fmtInt(rooms.withCombos)} />
            <Stat label={`Vượt ngưỡng ${fmtPct(rooms.minMargin, 0)}`} value={fmtInt(rooms.aboveMinMargin)} />
            <Stat
              label="Evaluator · phát / làm mới / hủy"
              value={fmtCompact(evaluator.issued)}
              sub={`${fmtCompact(evaluator.refreshed)} · ${fmtCompact(evaluator.cancelled)}`}
            />
            <Stat
              label="Consumer · chờ ack"
              value={`${consumers.connected}/${consumers.total}`}
              sub={`${fmtInt(consumers.pending)}`}
              tone={consumers.connected < consumers.total ? 'warn' : undefined}
            />
          </StatStrip>
        ) : (
          <div className="flex gap-10">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="skeleton h-6 w-16" />
                <div className="skeleton h-2.5 w-24 opacity-60" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sự cố đang mở — tiêu điểm */}
      <Section
        className="order-1 md:order-none"
        title="Sự cố đang mở"
        description={incidents.length ? `${incidents.length} sự cố · sắp theo mức độ` : undefined}
        actions={
          <Link href="/su-co" className="text-caption text-muted-fg hover:text-fg">
            Lịch sử
          </Link>
        }
      >
        {snapshot ? <IncidentList incidents={incidents} onAcked={reloadSnapshot} /> : <SkeletonRows rows={3} cols={[50, 20, 10]} />}
      </Section>

      <div className="order-3 grid grid-cols-1 gap-x-16 md:order-none xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
        {/* Sức khỏe tenant */}
        <Section title="Sức khỏe tenant" description="Tốc độ tính từ hai lần lấy bộ đếm gần nhất">
          {rooms ? (
            <>
              <div className="hidden md:block">
                <Table>
                  <THead>
                    <tr>
                      <TH>Tenant</TH>
                      <TH numeric>Mở / tạm khóa</TH>
                      <TH numeric>Mới nhất</TH>
                      <TH numeric>msg/s</TH>
                      <TH numeric>Parse lỗi</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {sortTenants(Object.keys(rooms.byTenant)).map((t) => {
                      const b = rooms.byTenant[t]!;
                      const r = tenants[t];
                      const failRate = r?.rate != null ? r.rate * r.parseFailRatio : null;
                      const bad = (r?.parseFailRatio ?? 0) > PARSE_WARN;
                      return (
                        <TR key={t} interactive onClick={() => router.push(`/ingest?tenant=${t}`)}>
                          <TD>
                            <Tenant tenant={t} />
                          </TD>
                          <TD numeric>
                            {fmtInt(b.open)} <span className="text-faint">/ {fmtInt(b.suspended)}</span>
                          </TD>
                          <TD numeric>
                            <Age ms={b.newestAgeMs} staleAfter={STALE_MS} />
                          </TD>
                          <TD numeric>
                            <span className="inline-flex items-center justify-end gap-3">
                              <Sparkline values={r?.history ?? []} className="h-4 w-14" color={tenantVar(t)} />
                              {fmtRate(r?.rate)}
                            </span>
                          </TD>
                          <TD numeric className={cn(bad && 'text-critical')}>
                            {failRate == null ? '—' : `${fmtRate(failRate)}/s`}
                            <span className="ml-2 text-caption text-faint">{r ? fmtPct(r.parseFailRatio, 1) : ''}</span>
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              {/* mobile: hàng gọn */}
              <ul className="md:hidden">
                {sortTenants(Object.keys(rooms.byTenant)).map((t) => {
                  const b = rooms.byTenant[t]!;
                  const r = tenants[t];
                  const bad = (r?.parseFailRatio ?? 0) > PARSE_WARN;
                  return (
                    <li key={t}>
                      <Link href={`/ingest?tenant=${t}`} className="flex min-h-14 items-center gap-3 border-b border-line py-3 last:border-0">
                        <div className="min-w-0 flex-1">
                          <Tenant tenant={t} />
                          <div className="num mt-1 text-caption text-muted-fg">
                            {fmtInt(b.open)} mở · {fmtInt(b.suspended)} khóa {bad ? <span className="text-critical">· parse lỗi {fmtPct(r!.parseFailRatio)}</span> : null}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="num text-body">{fmtRate(r?.rate)}<span className="text-faint">/s</span></div>
                          <Age ms={b.newestAgeMs} staleAfter={STALE_MS} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <SkeletonRows rows={2} />
          )}
        </Section>

        {/* Publisher theo trạng thái */}
        <Section
          title="Publisher"
          description={`${snapshot?.tasks.length ?? 0} task · ${snapshot?.nodes.filter((n) => n.connected).length ?? 0}/${snapshot?.nodes.length ?? 0} node kết nối`}
          actions={
            <Link href="/publisher" className="text-caption text-muted-fg hover:text-fg">
              Quản lý
            </Link>
          }
        >
          <SegmentBar
            className="mt-1"
            segments={STATE_ORDER.map((s) => ({ key: s, label: s, value: byState.get(s) ?? 0, tone: TASK_STATE_TONE[s] as Tone }))}
          />
          {problemTasks.length ? (
            <ul className="mt-5">
              {problemTasks.map((t) => (
                <li key={t.spec.taskId}>
                  <Link href={`/publisher?task=${encodeURIComponent(t.spec.taskId)}`} className="flex h-11 items-center gap-3 border-b border-line text-body last:border-0 hover:text-fg">
                    <DotLabel tone={TASK_STATE_TONE[t.state]}>
                      <span className="num text-fg">{t.spec.taskId}</span>
                    </DotLabel>
                    <span className="min-w-0 flex-1 truncate text-caption text-muted-fg">{t.lastError}</span>
                    <span className="num text-caption text-muted-fg">{t.state}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      </div>

      {/* Làn xử lý — thu gọn mặc định */}
      <div className="order-4 md:order-none">
        <button
          type="button"
          onClick={() => setShowLanes((v) => !v)}
          className="inline-flex h-9 items-center gap-1.5 text-body text-muted-fg hover:text-fg"
          aria-expanded={showLanes}
        >
          <ChevronDown className={cn('size-4 transition-transform duration-150', showLanes && 'rotate-180')} />
          {showLanes ? 'Ẩn làn xử lý' : 'Hiện làn xử lý'}
          <span className="num text-caption text-faint">{lanes.length}</span>
        </button>
        {showLanes ? (
          <div className="mt-3 animate-fade-in">
            <Table>
              <THead>
                <tr>
                  <TH>Làn (tenant × kênh)</TH>
                  <TH numeric>Đang chờ</TH>
                  <TH numeric>Đã xử lý</TH>
                  <TH numeric>Gộp</TH>
                  <TH numeric>Xử lý cuối</TH>
                  <TH>Trạng thái</TH>
                </tr>
              </THead>
              <tbody>
                {lanes.map((l) => {
                  const [t = '', phase = ''] = l.lane.split(':');
                  return (
                    <TR key={l.lane}>
                      <TD>
                        <span className="flex items-center gap-2">
                          <Tenant tenant={t} /> <span className="text-caption text-muted-fg">{phase}</span>
                        </span>
                      </TD>
                      <TD numeric className={cn(l.queued >= 1000 ? 'text-critical' : l.queued > 100 && 'text-warn')}>
                        {fmtInt(l.queued)}
                      </TD>
                      <TD numeric>{fmtCompact(l.processed)}</TD>
                      <TD numeric className="text-muted-fg">{fmtCompact(l.coalesced)}</TD>
                      <TD numeric>
                        <Age ms={l.lastProcessedAt ? Date.now() - l.lastProcessedAt : null} staleAfter={60_000} />
                      </TD>
                      <TD>
                        <DotLabel tone={l.busy ? 'warn' : 'ok'} className="text-caption text-muted-fg">
                          {l.busy ? 'Bận' : 'Rảnh'}
                        </DotLabel>
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
