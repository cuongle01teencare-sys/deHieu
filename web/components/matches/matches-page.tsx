'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, SearchX, SlidersHorizontal } from 'lucide-react';
import type { ListResult, MatchListItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { matchHref } from '@/lib/match-links';
import { useApi } from '@/hooks/use-api';
import { useIsMobile } from '@/hooks/use-media';
import { PhasePill, SportIcon, StartsAt, Teams } from '../domain';
import { FilterChip, SearchInput, Segmented, Select, Switch } from '../ui/controls';
import { PageHeader } from '../ui/layout';
import { Sheet } from '../ui/panel';
import { Button } from '../ui/button';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { Coverage } from '../ui/tenant';
import { LiveStamp, Margin } from '../ui/values';

interface Filters {
  q: string;
  sport: string;
  tenant: string;
  phase: '' | 'live' | 'prematch';
  matched: boolean;
}

export function MatchesPage() {
  const router = useRouter();
  const mobile = useIsMobile();
  const [f, setF] = useState<Filters>({ q: '', sport: '', tenant: '', phase: '', matched: false });
  const [sheet, setSheet] = useState(false);
  const qs = new URLSearchParams();
  if (f.q) qs.set('q', f.q.toLowerCase());
  if (f.sport) qs.set('sport', f.sport);
  if (f.tenant) qs.set('tenant', f.tenant);
  if (f.phase) qs.set('phase', f.phase);
  if (f.matched) qs.set('matched', 'true');
  qs.set('limit', '200');
  const { data, error, loading, reload, updatedAt } = useApi<ListResult<MatchListItem>>(`arbitrage/matches?${qs}`, 5_000);
  const minMargin = 0.02;
  const tenants = useMemo(() => [...new Set((data?.items ?? []).flatMap((m) => m.tenants))].sort(), [data]);
  const activeFilters = [f.sport, f.tenant, f.phase, f.matched ? '1' : ''].filter(Boolean).length;
  const open = (m: MatchListItem) => router.push(matchHref(m.match));

  const controls = (
    <>
      <Select value={f.sport} onChange={(e) => setF({ ...f, sport: e.target.value })} className="md:w-32" aria-label="Môn">
        <option value="">Mọi môn</option>
        <option value="cs2">CS2</option>
        <option value="lol">LoL</option>
      </Select>
      <Select value={f.tenant} onChange={(e) => setF({ ...f, tenant: e.target.value })} className="md:w-36" aria-label="Tenant">
        <option value="">Mọi tenant</option>
        {(tenants.length ? tenants : ['polymarket', 'sptpub']).map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
      <Segmented
        value={f.phase}
        onChange={(v) => setF({ ...f, phase: v })}
        options={[
          { value: '', label: 'Tất cả' },
          { value: 'live', label: 'Live' },
          { value: 'prematch', label: 'Trước trận' },
        ]}
      />
      <label className="flex h-8 items-center gap-2 text-body text-muted-fg">
        <Switch checked={f.matched} onCheckedChange={(v) => setF({ ...f, matched: v })} label="Chỉ trận đã ghép" />
        Chỉ trận đã ghép
      </label>
    </>
  );

  return (
    <div>
      <PageHeader title="Trận đấu" description="Mỗi trận gom mọi market của cùng cặp đội. Độ phủ = số market mỗi tenant đang có." meta={<LiveStamp at={updatedAt} />} />

      {/* bộ lọc: một hàng trên desktop; mobile = ô tìm + chip dính mở sheet */}
      <div className="sticky top-14 z-20 -mx-4 mb-4 flex items-center gap-2 bg-bg/90 px-4 py-2 backdrop-blur md:static md:mx-0 md:mb-6 md:flex-wrap md:gap-3 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <SearchInput value={f.q} onChange={(q) => setF({ ...f, q })} placeholder="Tìm đội…" className="flex-1 md:w-64 md:flex-none" />
        {mobile ? (
          <FilterChip active={activeFilters > 0} onClick={() => setSheet(true)}>
            <SlidersHorizontal className="size-3.5" /> Lọc{activeFilters ? ` · ${activeFilters}` : ''}
          </FilterChip>
        ) : (
          controls
        )}
        <span className="num ml-auto hidden text-caption text-faint md:inline">{data ? `${data.total} trận` : ''}</span>
      </div>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Lọc trận"
        footer={
          <>
            <Button variant="primary" onClick={() => setSheet(false)}>
              Xem {data?.total ?? ''} trận
            </Button>
            <Button variant="ghost" onClick={() => setF({ q: f.q, sport: '', tenant: '', phase: '', matched: false })}>
              Xóa bộ lọc
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 pt-2 [&_select]:h-11">{controls}</div>
      </Sheet>

      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {loading && !data ? <SkeletonRows rows={8} cols={[30, 12, 10, 22, 8, 10]} /> : null}
      {data && !data.items.length ? (
        <Empty icon={SearchX} action={<Button variant="ghost" size="sm" onClick={() => setF({ q: '', sport: '', tenant: '', phase: '', matched: false })}>Xóa bộ lọc</Button>}>
          Không có trận khớp bộ lọc.
        </Empty>
      ) : null}

      {data && data.items.length ? (
        mobile ? (
          <ul>
            {data.items.map((m) => (
              <li key={m.match}>
                <Link href={matchHref(m.match)} className="flex min-h-16 items-center gap-3 border-b border-line py-3 active:bg-hover/50">
                  <SportIcon sport={m.sport} />
                  <div className="min-w-0 flex-1">
                    <Teams teams={m.teams} className="text-[15px]" />
                    <div className="mt-1 flex items-center gap-2">
                      {m.phases.includes('live') ? <PhasePill phase="live" /> : null}
                      <StartsAt at={m.startsAt} />
                    </div>
                    <Coverage coverage={m.coverage} className="mt-1.5" />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Margin value={m.bestMargin} min={minMargin} size="lg" />
                    <span className="num text-micro text-faint">
                      {m.matchedMarkets}/{m.markets} ghép
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Trận</TH>
                <TH>Bắt đầu</TH>
                <TH>Kênh</TH>
                <TH>Độ phủ</TH>
                <TH numeric>Ghép / market</TH>
                <TH numeric>Margin tốt nhất</TH>
                <TH className="w-6" />
              </tr>
            </THead>
            <tbody>
              {data.items.map((m) => (
                <TR key={m.match} interactive tabIndex={0} onClick={() => open(m)} onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && open(m)}>
                  <TD className="max-w-[340px]">
                    <Link href={matchHref(m.match)} onClick={(e) => e.stopPropagation()} className="flex min-w-0 items-center gap-3 hover:text-accent-text">
                      <SportIcon sport={m.sport} />
                      <Teams teams={m.teams} />
                    </Link>
                  </TD>
                  <TD>
                    <StartsAt at={m.startsAt} />
                  </TD>
                  <TD>
                    <PhasePill phase={m.phases.includes('live') ? 'live' : 'prematch'} />
                  </TD>
                  <TD>
                    <Coverage coverage={m.coverage} />
                  </TD>
                  <TD numeric>
                    <span className={cn(m.matchedMarkets === 0 && 'text-faint')}>{m.matchedMarkets}</span>
                    <span className="text-faint"> / {m.markets}</span>
                  </TD>
                  <TD numeric>
                    <Margin value={m.bestMargin} min={minMargin} />
                  </TD>
                  <TD>
                    <ChevronRight className="size-4 text-faint opacity-0 transition-opacity group-hover/row:opacity-100" />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )
      ) : null}
    </div>
  );
}
