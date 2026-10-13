'use client';

import { useMemo, useState } from 'react';
import { History, ScrollText } from 'lucide-react';
import type { AuditEntry, ListResult, OddsTransition } from '@/lib/types';
import { fmtClock, fmtOdds, fmtStamp } from '@/lib/format';
import { marketLabel } from '@/lib/markets';
import { CANCEL_REASONS } from '@/lib/skip-reasons';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useIsMobile } from '@/hooks/use-media';
import { DrawerSection } from '../room-drawer';
import { RoomDrawer } from '../room-drawer';
import { SearchInput, Segmented, Select } from '../ui/controls';
import { KV, PageHeader } from '../ui/layout';
import { Panel } from '../ui/panel';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { DotLabel, StatusDot } from '../ui/status';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { Tenant } from '../ui/tenant';
import { JsonBlock, Mono } from '../ui/code';
import { Teams } from '../domain';

const RANGES = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
type Range = keyof typeof RANGES;
const RangeControl = ({ value, onChange }: { value: Range; onChange: (r: Range) => void }) => (
  <Segmented value={value} onChange={onChange} options={(Object.keys(RANGES) as Range[]).map((k) => ({ value: k, label: k }))} />
);

/* ------------------------------------------------------------------ Audit */

export function AuditPage() {
  const mobile = useIsMobile();
  const [who, setWho] = useState('');
  const [method, setMethod] = useState('');
  const [route, setRoute] = useState('');
  const [range, setRange] = useState<Range>('7d');
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const from = useMemo(() => Date.now() - RANGES[range], [range]);
  const qs = new URLSearchParams({ from: String(from), limit: '200' });
  if (who) qs.set('principalId', who);
  if (method) qs.set('method', method);
  if (route) qs.set('route', route);
  const { data, error, reload } = useApi<ListResult<AuditEntry>>(`admin/audit?${qs}`, 30_000);
  const people = useMemo(() => [...new Set((data?.items ?? []).map((a) => a.principalId))].sort(), [data]);

  return (
    <div>
      <PageHeader title="Audit" description="Mọi thao tác ghi (POST / PATCH / DELETE): ai, route nào, kết quả. Bí mật đã được che." />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SearchInput value={route} onChange={setRoute} placeholder="Lọc route…" className="w-full md:w-56" />
        <Select value={who} onChange={(e) => setWho(e.target.value)} className="w-36" aria-label="Người thực hiện">
          <option value="">Mọi người</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-32" aria-label="Method">
          <option value="">Mọi method</option>
          {['POST', 'PATCH', 'PUT', 'DELETE'].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Select>
        <RangeControl value={range} onChange={setRange} />
      </div>
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {!data && !error ? <SkeletonRows rows={10} cols={[12, 10, 8, 40, 10]} /> : null}
      {data && !data.items.length ? <Empty icon={ScrollText}>Không có thao tác nào khớp bộ lọc.</Empty> : null}
      {data?.items.length ? (
        mobile ? (
          <ul>
            {data.items.map((a) => (
              <li key={a.id} onClick={() => setOpen(a)} className="cursor-pointer border-b border-line py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="num min-w-0 truncate text-body text-fg">
                    <span className="text-muted-fg">{a.method}</span> {a.route}
                  </span>
                  <StatusDot tone={a.ok ? 'ok' : 'critical'} label={String(a.status)} />
                </div>
                <div className="num mt-0.5 text-caption text-muted-fg">
                  {a.principalId} · {fmtStamp(a.at)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Thời điểm</TH>
                <TH>Ai</TH>
                <TH>Method</TH>
                <TH>Route</TH>
                <TH>Kết quả</TH>
                <TH numeric>Thời gian</TH>
              </tr>
            </THead>
            <tbody>
              {data.items.map((a) => (
                <TR key={a.id} interactive onClick={() => setOpen(a)} highlight={open?.id === a.id}>
                  <TD className="num text-caption text-muted-fg">{fmtStamp(a.at)}</TD>
                  <TD className="text-fg">{a.principalId}</TD>
                  <TD className="num text-caption text-muted-fg">{a.method}</TD>
                  <TD className="num max-w-[360px] truncate text-caption text-fg">
                    {a.route}
                    {Object.keys(a.params).length ? <span className="text-faint"> {Object.values(a.params).join(' ')}</span> : null}
                  </TD>
                  <TD>
                    <DotLabel tone={a.ok ? 'ok' : 'critical'} className="num text-caption">
                      <span className={cn(a.ok ? 'text-muted-fg' : 'text-critical')}>{a.status}</span>
                    </DotLabel>
                  </TD>
                  <TD numeric className="text-caption text-muted-fg">{a.durationMs}ms</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )
      ) : null}
      <Panel open={!!open} onOpenChange={(v) => !v && setOpen(null)} eyebrow={open ? fmtStamp(open.at) : null} title={open ? <span className="num text-[15px]">{open.method} {open.route}</span> : ''}>
        {open ? (
          <div>
            <DrawerSection title="Yêu cầu">
              <KV
                items={[
                  ['Người thực hiện', open.principalId],
                  ['Kết quả', <DotLabel key="r" tone={open.ok ? 'ok' : 'critical'}><span className="num">{open.status}</span></DotLabel>],
                  ['Thời gian xử lý', <span key="d" className="num">{open.durationMs}ms</span>],
                ]}
              />
            </DrawerSection>
            <DrawerSection title="Tham số">
              <JsonBlock value={open.params} title="params" defaultOpen />
            </DrawerSection>
            <DrawerSection title="Body">
              {open.body ? <JsonBlock value={open.body} title="body" defaultOpen /> : <p className="text-body text-muted-fg">Không có body.</p>}
            </DrawerSection>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ Lịch sử odds */

const TO_LABEL: Record<string, string> = { open: 'Mở', suspended: 'Tạm khóa', removed: 'Bị gỡ' };

export function OddsHistoryPage() {
  const mobile = useIsMobile();
  const [q, setQ] = useState('');
  const [tenant, setTenant] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState<Range>('24h');
  const [room, setRoom] = useState<string | null>(null);
  const from = useMemo(() => Date.now() - RANGES[range], [range]);
  const qs = new URLSearchParams({ from: String(from), limit: '300' });
  if (tenant) qs.set('tenant', tenant);
  if (to) qs.set('to', to);
  const { data, error, reload } = useApi<ListResult<OddsTransition>>(`admin/odds-transitions?${qs}`, 30_000);
  const items = (data?.items ?? []).filter((t) => !q || t.room.includes(q.toLowerCase()));

  const parse = (r: string) => {
    const parts = r.replace(/^room:/, '').split(':');
    const [a = '', b = ''] = (parts[1] ?? '').split('~');
    return { teams: [a, b] as [string, string], market: parts[2] ?? '' };
  };
  const tone = (t: OddsTransition) => (t.to === 'removed' ? 'critical' : t.to === 'suspended' ? 'warn' : t.from === null ? 'accent' : 'ok');

  return (
    <div>
      <PageHeader title="Lịch sử odds" description="Dòng kèo xuất hiện, mở ↔ tạm khóa, bị gỡ (kèm lý do). Giữ 7 ngày." />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Lọc room / đội…" className="w-full md:w-60" />
        <Select value={tenant} onChange={(e) => setTenant(e.target.value)} className="w-36" aria-label="Tenant">
          <option value="">Mọi tenant</option>
          <option value="sptpub">sptpub</option>
          <option value="polymarket">polymarket</option>
        </Select>
        <Select value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="Chuyển sang">
          <option value="">Mọi chuyển đổi</option>
          <option value="open">→ Mở</option>
          <option value="suspended">→ Tạm khóa</option>
          <option value="removed">→ Bị gỡ</option>
        </Select>
        <RangeControl value={range} onChange={setRange} />
        <span className="num ml-auto text-caption text-faint">{data ? `${items.length} dòng` : ''}</span>
      </div>
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {!data && !error ? <SkeletonRows rows={10} cols={[8, 34, 12, 16, 16]} /> : null}
      {data && !items.length ? <Empty icon={History}>Không có chuyển trạng thái nào khớp bộ lọc.</Empty> : null}
      {items.length ? (
        mobile ? (
          <ul>
            {items.slice(0, 150).map((t) => {
              const p = parse(t.room);
              return (
                <li key={t.id} onClick={() => setRoom(t.room)} className="flex cursor-pointer items-start gap-3 border-b border-line py-3">
                  <StatusDot tone={tone(t)} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <Teams teams={p.teams} className="text-body" />
                    <div className="mt-0.5 text-caption text-muted-fg">
                      {marketLabel(p.market)} · {t.tenant} · {t.from ? `${TO_LABEL[t.from]} → ` : 'Xuất hiện → '}
                      {TO_LABEL[t.to]}
                    </div>
                  </div>
                  <span className="num text-caption text-faint">{fmtClock(t.at)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Thời điểm</TH>
                <TH>Room</TH>
                <TH>Tenant</TH>
                <TH>Chuyển đổi</TH>
                <TH>Lý do</TH>
                <TH numeric>Odds</TH>
              </tr>
            </THead>
            <tbody>
              {items.slice(0, 300).map((t) => {
                const p = parse(t.room);
                return (
                  <TR key={t.id} interactive onClick={() => setRoom(t.room)}>
                    <TD className="num text-caption text-muted-fg">{fmtStamp(t.at)}</TD>
                    <TD className="max-w-[320px]">
                      <Teams teams={p.teams} />
                      <div className="text-caption text-muted-fg">{marketLabel(p.market)}</div>
                    </TD>
                    <TD>
                      <Tenant tenant={t.tenant} />
                    </TD>
                    <TD>
                      <DotLabel tone={tone(t)} className="text-body">
                        {t.from ? `${TO_LABEL[t.from]} → ${TO_LABEL[t.to]}` : `Xuất hiện`}
                      </DotLabel>
                    </TD>
                    <TD className="text-caption text-muted-fg">
                      {t.reason ? (
                        <>
                          {CANCEL_REASONS[t.reason] ?? t.reason} <Mono>{t.reason}</Mono>
                        </>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD numeric className="text-caption">
                      {t.odds ? `${fmtOdds(t.odds[0])} / ${fmtOdds(t.odds[1])}` : <span className="text-faint">—</span>}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )
      ) : null}
      <RoomDrawer room={room} onClose={() => setRoom(null)} />
    </div>
  );
}
