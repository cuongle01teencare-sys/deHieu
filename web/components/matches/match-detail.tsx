'use client';

import { Fragment, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, SearchX } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import type { MatchDetail, MatchMarketRow } from '@/lib/types';
import { MARKET_GROUPS, marketGroup, marketLabel, marketOrder, SPORT_LABEL } from '@/lib/markets';
import { sortTenants } from '@/lib/tenants';
import { matchHref, matchPhases } from '@/lib/match-links';
import { fmtPct, fmtStamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useIsMobile } from '@/hooks/use-media';
import { useConsoleData } from '../console-data';
import { RoomDrawer } from '../room-drawer';
import { PhasePill, SportIcon, StartsAt } from '../domain';
import { Eyebrow } from '../ui/layout';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Pill } from '../ui/status';
import { Tenant, TenantDot } from '../ui/tenant';
import { Age, LiveStamp, Margin, OddsCell } from '../ui/values';
import { Hint } from '../ui/tooltip';
import { CopyButton } from '../ui/code';
import { TenantSourceLinks } from './tenant-source-links';

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
  const router = useRouter();
  const mobile = useIsMobile();
  const { data, error, reload, updatedAt } = useApi<MatchDetail>(`arbitrage/matches/${encodeURIComponent(id)}`, 3_000);
  const { onEvent } = useConsoleData();
  const highlight = params.get('market');
  const room = data?.markets.find((row) => row.market === highlight)?.room ?? null;
  const selectRoom = (room: string | null) => {
    const query = new URLSearchParams(params);
    const market = data?.markets.find((row) => row.room === room)?.market;
    if (market) query.set('market', market);
    else query.delete('market');
    router.push(`${matchHref(id)}${query.size ? `?${query}` : ''}`, { scroll: false });
  };

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
  const phases = matchPhases(data.markets);
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
          {phases.map((phase) => <PhasePill key={phase} phase={phase} />)}
          <Hint content={fmtStamp(data.startsAt)}>
            <span>
              <StartsAt at={data.startsAt} />
            </span>
          </Hint>
          <span className="ml-auto hidden md:inline">
            <LiveStamp at={updatedAt} staleAfter={10_000} />
          </span>
          <CopyButton text={typeof window === 'undefined' ? matchHref(id) : new URL(matchHref(id), window.location.origin).href} label="Sao chép URL trận" />
        </div>
        <h1 className="text-[26px] font-semibold leading-tight text-fg [overflow-wrap:anywhere] md:text-[34px]">
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
      <div className="-mt-6 mb-8 border-t border-line pt-3">
        <TenantSourceLinks markets={data.markets} tenants={tenants} />
      </div>

      {error ? <ErrorState message={error} onRetry={reload} className="mb-6" /> : null}
      {highlight && !room ? <Empty icon={SearchX}>Dòng kèo này không còn trong trận.</Empty> : null}

      {mobile ? (
        <MobileMatrix match={id} groups={groups} tenants={tenants} minMargin={data.minMargin} highlight={highlight} />
      ) : (
        <Matrix match={id} groups={groups} tenants={tenants} minMargin={data.minMargin} onOpen={selectRoom} highlight={highlight} active={room} />
      )}

      <RoomDrawer room={room} onClose={() => selectRoom(null)} />
    </div>
  );
}

type Groups = ReturnType<typeof grouped>;

/** Ma trận market × tenant: bảng mở, nhóm bằng tiêu đề phụ chữ hoa nhỏ. */
function Matrix({
  match,
  groups,
  tenants,
  minMargin,
  onOpen,
  highlight,
  active,
}: {
  match: string;
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
  }, [highlight]);
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
                const hl = highlight === row.market;
                return (
                  <tr
                    key={row.market}
                    ref={hl ? hlRef : undefined}
                    tabIndex={0}
                    onClick={() => onOpen(row.room)}
                    onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onOpen(row.room)}
                    className={cn(
                      'group/row cursor-pointer transition-colors duration-150 [&>td]:border-b [&>td]:border-line hover:bg-hover/50 focus-visible:bg-hover/50 focus-visible:outline-none',
                      (hl || active === row.room) && 'bg-accent-soft hover:bg-accent-soft',
                    )}
                  >
                    <td className="py-3 pr-4 align-middle">
                      <Link href={matchHref(match, row.market)} scroll={false} onClick={(e) => e.stopPropagation()} className="text-body font-medium text-fg hover:text-accent-text hover:underline">{marketLabel(row.market)}</Link>
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
                      {row.aboveMinMargin ? <Pill tone="ok">vượt ngưỡng</Pill> : null}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Mobile: mỗi market một mục (không viền), nhóm thu gọn được; một hàng mỗi tenant. */
function MobileMatrix({
  match,
  groups,
  tenants,
  minMargin,
  highlight,
}: {
  match: string;
  groups: Groups;
  tenants: string[];
  minMargin: number;
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
              return (
                <Link
                  href={matchHref(match, row.market)}
                  scroll={false}
                  key={row.market}
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
                      {row.aboveMinMargin ? <Pill tone="ok">vượt ngưỡng</Pill> : null}
                      <Margin value={Object.keys(row.lines).length >= 2 ? row.bestMargin : null} min={minMargin} className="font-medium" />
                    </span>
                  </div>
                </Link>
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
      <div className="skeleton mb-5 h-8 w-80 max-w-full" />
      <div className="skeleton mb-12 h-3 w-96 max-w-full opacity-60" />
      <SkeletonRows rows={9} cols={[28, 20, 20, 8, 10]} />
    </div>
  );
}

