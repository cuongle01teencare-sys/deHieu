'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, SearchX } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import type { MatchDetail, MatchMarketRow } from '@/lib/types';
import { MARKET_GROUPS, marketGroup, marketLabel, marketOrder, SPORT_LABEL } from '@/lib/markets';
import { sortTenants } from '@/lib/tenants';
import { fmtPct, fmtStamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useIsMobile } from '@/hooks/use-media';
import { useConsoleData } from '../console-data';
import { RoomDrawer } from '../room-drawer';
import { PhasePill, SportIcon, StartsAt } from '../domain';
import { Eyebrow } from '../ui/layout';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Pill, StatusDot } from '../ui/status';
import { Tenant, TenantDot } from '../ui/tenant';
import { Age, LiveStamp, Margin, OddsCell } from '../ui/values';
import { Hint } from '../ui/tooltip';

const STALE_MS = 30_000;

/** Odds tốt nhất mỗi phía trên các tenant đang mở. */
function bestOdds(row: MatchMarketRow): [number, number] {
  const open = Object.values(row.lines).filter((l) => l.status === 'open');
  const src = open.length ? open : Object.values(row.lines);
  return [Math.max(0, ...src.map((l) => l.odds[0])), Math.max(0, ...src.map((l) => l.odds[1]))];
}

function grouped(markets: MatchMarketRow[]) {
  return MARKET_GROUPS.map((g) => ({
    ...g,
    rows: markets.filter((m) => marketGroup(m.market) === g.id).sort((a, b) => marketOrder(a.market) - marketOrder(b.market)),
  })).filter((g) => g.rows.length);
}

export function MatchDetailPage({ id }: { id: string }) {
  const params = useSearchParams();
  const mobile = useIsMobile();
  const { data, error, reload, updatedAt } = useApi<MatchDetail>(`arbitrage/matches/${encodeURIComponent(id)}`, 3_000);
  const { onEvent } = useConsoleData();
  const [room, setRoom] = useState<string | null>(null);
  const highlight = params.get('market');

  useEffect(() => onEvent((e) => e.topic === `match:${id}` && void reload()), [onEvent, reload, id]);

  if (error && !data)
    return error.includes('404') || error.toLowerCase().includes('not found') ? (
      <Empty icon={SearchX}>Không tìm thấy trận <span className="num text-fg">{id}</span> — có thể đã kết thúc và bị gỡ.</Empty>
    ) : (
      <ErrorState message={error} onRetry={reload} />
    );
  if (!data) return <DetailSkeleton />;

  const tenants = sortTenants(data.tenants);
  const groups = grouped(data.markets);
  const matched = data.markets.filter((m) => Object.keys(m.lines).length >= 2);
  const best = matched.reduce<number | null>((b, r) => (r.bestMargin !== null && (b === null || r.bestMargin > b) ? r.bestMargin : b), null);
  const live = data.phases.includes('live');
  const coverage = Object.fromEntries(tenants.map((t) => [t, data.markets.filter((m) => m.lines[t]).length]));

  return (
    <div>
      {/* Tiêu đề: thuần chữ, không hộp */}
      <header className="mb-10 md:mb-12">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-caption text-muted-fg">
          <span className="inline-flex items-center gap-1.5">
            <SportIcon sport={data.sport} /> {SPORT_LABEL[data.sport] ?? data.sport}
          </span>
          <span className="text-faint">·</span>
          <PhasePill phase={live ? 'live' : 'prematch'} />
          <Hint content={fmtStamp(data.startsAt)}>
            <span>
              <StartsAt at={data.startsAt} />
            </span>
          </Hint>
          <span className="ml-auto hidden md:inline">
            <LiveStamp at={updatedAt} staleAfter={10_000} />
          </span>
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-fg [overflow-wrap:anywhere] md:text-[34px]">
          {data.teams[0]} <span className="font-normal text-faint">vs</span> {data.teams[1]}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-body text-muted-fg">
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {tenants.map((t) => (
              <Tenant key={t} tenant={t} count={coverage[t]} />
            ))}
          </span>
          <span className="hidden h-3 w-px bg-line md:block" />
          <span>
            <span className="num text-fg">{matched.length}</span>/<span className="num">{data.markets.length}</span> market đã ghép
          </span>
          <span>
            Tốt nhất <Margin value={best} min={data.minMargin} className="font-medium" />
          </span>
          <span className="text-faint">ngưỡng {fmtPct(data.minMargin, 0)}</span>
        </div>
      </header>

      {mobile ? (
        <MobileMatrix groups={groups} tenants={tenants} minMargin={data.minMargin} onOpen={setRoom} highlight={highlight} />
      ) : (
        <Matrix groups={groups} tenants={tenants} minMargin={data.minMargin} onOpen={setRoom} highlight={highlight} active={room} />
      )}

      <RoomDrawer room={room} onClose={() => setRoom(null)} />
    </div>
  );
}

type Groups = ReturnType<typeof grouped>;

/** Ma trận market × tenant: bảng mở, nhóm bằng tiêu đề phụ chữ hoa nhỏ. */
function Matrix({
  groups,
  tenants,
  minMargin,
  onOpen,
  highlight,
  active,
}: {
  groups: Groups;
  tenants: string[];
  minMargin: number;
  onOpen: (room: string) => void;
  highlight: string | null;
  active: string | null;
}) {
  const hlRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    hlRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);
  return (
    <div className="-mx-1 overflow-x-auto px-1 lg:overflow-visible">
      <table className="w-full min-w-[760px] border-separate border-spacing-0">
        <thead className="lg:[&_th]:sticky lg:[&_th]:top-14 [&_th]:z-[2] [&_th]:bg-bg">
          <tr>
            <th className="h-10 w-[30%] border-b border-line pb-2 text-left align-bottom text-caption font-normal text-muted-fg">Market</th>
            {tenants.map((t) => (
              <th key={t} className="h-10 border-b border-line px-4 pb-2 text-right align-bottom font-normal">
                <span className="inline-flex items-center gap-1.5 text-caption text-fg">
                  <TenantDot tenant={t} />
                  <span className="num">{t}</span>
                </span>
              </th>
            ))}
            <th className="h-10 w-20 border-b border-line px-4 pb-2 text-right align-bottom text-caption font-normal text-muted-fg">Tổ hợp</th>
            <th className="h-10 w-28 border-b border-line pb-2 pl-4 text-right align-bottom text-caption font-normal text-muted-fg">Margin</th>
            <th className="h-10 w-20 border-b border-line pb-2 align-bottom" />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.id}>
              <tr>
                <td colSpan={tenants.length + 4} className="pb-2 pt-8">
                  <Eyebrow>{g.label}</Eyebrow>
                </td>
              </tr>
              {g.rows.map((row) => {
                const best = bestOdds(row);
                const signals = row.activeSignals ?? (row.aboveMinMargin ? 1 : 0);
                const hl = highlight === row.market;
                return (
                  <tr
                    key={row.market}
                    ref={hl ? hlRef : undefined}
                    tabIndex={0}
                    onClick={() => onOpen(row.room)}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(row.room)}
                    className={cn(
                      'group/row cursor-pointer transition-colors duration-150 [&>td]:border-b [&>td]:border-line hover:bg-hover/50 focus-visible:bg-hover/50 focus-visible:outline-none',
                      (hl || active === row.room) && 'bg-accent-soft hover:bg-accent-soft',
                    )}
                  >
                    <td className="py-3 pr-4 align-middle">
                      <div className="text-body font-medium text-fg">{marketLabel(row.market)}</div>
                      <div className="mt-0.5 flex min-w-0 gap-2 text-caption text-muted-fg">
                        <span className="truncate">{row.picks[0]}</span>
                        <span className="text-faint">/</span>
                        <span className="truncate">{row.picks[1]}</span>
                      </div>
                    </td>
                    {tenants.map((t) => {
                      const l = row.lines[t];
                      return (
                        <td key={t} className="px-4 py-3 text-right align-middle">
                          {l ? (
                            <OddsCell
                              odds={l.odds}
                              status={l.status}
                              ageMs={l.ageMs}
                              staleAfter={STALE_MS}
                              best={[tenants.length > 1 && l.odds[0] === best[0], tenants.length > 1 && l.odds[1] === best[1]]}
                            />
                          ) : (
                            <span className="num pr-[3.6rem] text-faint">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="num px-4 py-3 text-right align-middle text-caption text-muted-fg">{row.combos || <span className="text-faint">—</span>}</td>
                    <td className="py-3 pl-4 text-right align-middle">
                      <Margin value={Object.keys(row.lines).length >= 2 ? row.bestMargin : null} min={minMargin} />
                    </td>
                    <td className="py-3 pl-3 text-right align-middle">
                      {signals > 0 ? <Pill tone="ok">có kèo</Pill> : null}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-caption text-faint">
        Gạch chân = odds tốt nhất mỗi phía · <StatusDot tone="ok" className="mx-1 align-middle" /> mở · <StatusDot tone="warn" className="mx-1 align-middle" /> tạm khóa · đồng hồ = dữ liệu cũ hơn 30s. Bấm một hàng để xem room.
      </p>
    </div>
  );
}

/** Mobile: mỗi market một mục (không viền), nhóm thu gọn được; một hàng mỗi tenant. */
function MobileMatrix({
  groups,
  tenants,
  minMargin,
  onOpen,
  highlight,
}: {
  groups: Groups;
  tenants: string[];
  minMargin: number;
  onOpen: (room: string) => void;
  highlight: string | null;
}) {
  return (
    <div className="flex flex-col">
      {groups.map((g) => (
        <Collapsible.Root key={g.id} defaultOpen className="border-t border-line first:border-t-0">
          <Collapsible.Trigger className="group flex h-12 w-full items-center justify-between">
            <Eyebrow>{g.label}</Eyebrow>
            <span className="flex items-center gap-2 text-caption text-faint">
              {g.rows.length}
              <ChevronDown className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
            </span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            {g.rows.map((row) => {
              const best = bestOdds(row);
              const signals = row.activeSignals ?? 0;
              return (
                <button
                  type="button"
                  key={row.market}
                  onClick={() => onOpen(row.room)}
                  className={cn('block w-full border-b border-line pb-4 pt-1 text-left last:border-b-0', highlight === row.market && '-mx-4 w-[calc(100%+2rem)] bg-accent-soft px-4')}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-medium text-fg">{marketLabel(row.market)}</span>
                  </div>
                  <div className="mt-0.5 grid grid-cols-[1fr_auto] gap-x-3 text-caption text-muted-fg">
                    <span className="truncate">
                      {row.picks[0]} <span className="text-faint">/</span> {row.picks[1]}
                    </span>
                  </div>
                  <div className="mt-2">
                    {tenants.map((t) => {
                      const l = row.lines[t];
                      return (
                        <div key={t} className="flex h-10 items-center justify-between gap-3">
                          <Tenant tenant={t} muted={!l} />
                          {l ? (
                            <span className="flex items-center gap-3">
                              <OddsCell odds={l.odds} status={l.status} best={[l.odds[0] === best[0] && tenants.length > 1, l.odds[1] === best[1] && tenants.length > 1]} layout="mobile" />
                              <Age ms={l.ageMs} staleAfter={STALE_MS} className="w-8 justify-end text-micro" />
                            </span>
                          ) : (
                            <span className="num pr-12 text-faint">—</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-caption text-muted-fg">Margin tốt nhất</span>
                    <span className="flex items-center gap-2">
                      {signals ? <Pill tone="ok">có kèo</Pill> : null}
                      <Margin value={Object.keys(row.lines).length >= 2 ? row.bestMargin : null} min={minMargin} className="font-medium" />
                    </span>
                  </div>
                </button>
              );
            })}
          </Collapsible.Content>
        </Collapsible.Root>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div>
      <div className="skeleton mb-4 h-3 w-48" />
      <div className="skeleton mb-5 h-8 w-80" />
      <div className="skeleton mb-12 h-3 w-96 opacity-60" />
      <SkeletonRows rows={9} cols={[28, 20, 20, 8, 10]} />
    </div>
  );
}

