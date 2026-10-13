'use client';

import { useEffect } from 'react';
import { Check, Minus } from 'lucide-react';
import { fmtAge, fmtClock, fmtOdds, fmtStamp } from '@/lib/format';
import { marketLabel } from '@/lib/markets';
import type { ListResult, OddsTransition, RoomDetailView } from '@/lib/types';
import { CANCEL_REASONS } from '@/lib/skip-reasons';
import { useApi } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { cn } from '@/lib/utils';
import { useConsoleData } from './console-data';
import { Panel } from './ui/panel';
import { Eyebrow, KV } from './ui/layout';
import { Tenant } from './ui/tenant';
import { LiveStamp, Margin, OddsCell } from './ui/values';
import { CopyButton, JsonBlock, Mono } from './ui/code';
import { ErrorState, SkeletonText } from './ui/states';
import { PhasePill, StartsAt, Teams } from './domain';
import { SignalLegs } from './signal-legs';

/** Drawer chi tiết room (bottom sheet trên mobile). Làm mới khi có odds.changed của room trên stream. */
export function RoomDrawer({ room, onClose }: { room: string | null; onClose: () => void }) {
  return (
    <Panel
      open={!!room}
      onOpenChange={(v) => !v && onClose()}
      eyebrow={room ? <Mono copy>{room}</Mono> : null}
      title={room ? <RoomTitle room={room} /> : ''}
      width="lg"
    >
      {room ? <RoomBody room={room} /> : null}
    </Panel>
  );
}

function RoomTitle({ room }: { room: string }) {
  const market = room.split(':').pop() ?? '';
  const pair = room.split(':')[2] ?? '';
  const [a = '', b = ''] = pair.split('~');
  return (
    <span className="flex flex-col gap-0.5">
      <span>{marketLabel(market)}</span>
      <Teams teams={[a, b]} strong={false} className="text-body font-normal text-muted-fg" />
    </span>
  );
}

function RoomBody({ room }: { room: string }) {
  const { data, error, reload, updatedAt } = useApi<RoomDetailView>(`arbitrage/rooms/${encodeURIComponent(room)}`, 5_000);
  const tl = useApi<ListResult<OddsTransition>>(`admin/odds-transitions?room=${encodeURIComponent(room)}&limit=40`, 30_000);
  const { onEvent } = useConsoleData();
  useEffect(
    () =>
      onEvent((e) => {
        if (e.topic === `room:${room}` || (e.type.startsWith('signal.') && e.data.room === room)) void reload();
      }),
    [onEvent, reload, room],
  );

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <SkeletonText lines={8} />;

  const tenants = Object.keys(data.lines);
  const first = Object.values(data.lines)[0];
  const best: [number, number] = [
    Math.max(...Object.values(data.lines).map((l) => l.odds[0])),
    Math.max(...Object.values(data.lines).map((l) => l.odds[1])),
  ];
  const picks: [string, string] = data.combos[0] ? [data.combos[0].legs[0]!.pick, data.combos[0].legs[1]!.pick] : data.teams;

  return (
    <div className="flex flex-col">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {first ? <PhasePill phase={first.phase} /> : null}
        {first ? <StartsAt at={first.startsAt} /> : null}
        <span className="ml-auto">
          <LiveStamp at={updatedAt} />
        </span>
      </div>

      {/* --- dòng kèo theo tenant */}
      <DrawerSection title="Dòng kèo" hint={`${tenants.length} tenant`}>
        <p className="mb-1 text-caption text-muted-fg">
          Trái: <span className="text-fg">{picks[0]}</span> · Phải: <span className="text-fg">{picks[1]}</span>
        </p>
        {tenants.map((t) => {
          const l = data.lines[t]!;
          return (
            <div key={t} className="border-b border-line py-3.5 last:border-0">
              <div className="flex items-center gap-4">
                <Tenant tenant={t} className="flex-1" />
                <OddsCell odds={l.odds} status={l.status} ageMs={l.ageMs} best={[l.odds[0] === best[0], l.odds[1] === best[1]]} />
              </div>
              <details className="group mt-2">
                <summary className="cursor-pointer list-none text-caption text-faint hover:text-muted-fg">
                  <span className="group-open:hidden">Chi tiết dòng</span>
                  <span className="hidden group-open:inline">Ẩn chi tiết</span>
                </summary>
                <KV
                  className="mt-3 text-caption"
                  items={[
                    ['Trạng thái', l.status === 'open' ? 'Đang mở' : 'Tạm khóa'],
                    ['Kênh', l.phase === 'live' ? 'Live' : 'Trước trận'],
                    ['Cập nhật', <span key="u" className="num">{fmtStamp(l.updatedAt)} · {fmtAge(l.ageMs)}</span>],
                    ['Bắt đầu', <span key="s" className="num">{fmtStamp(l.startsAt)}</span>],
                    ...Object.entries(l.ref).filter(([, v]) => v).map(([k, v]) => [<span key={k} className="num">ref.{k}</span>, <Mono key={`${k}v`} copy>{v}</Mono>] as [React.ReactNode, React.ReactNode]),
                  ]}
                />
                <div className="mt-3 flex items-start gap-2">
                  <code className="num min-w-0 flex-1 break-all rounded-[6px] bg-bg/60 px-2.5 py-2 text-[11px] text-fg/75">{l.raw}</code>
                  <CopyButton text={l.raw} label="" className="mt-2" />
                </div>
              </details>
            </div>
          );
        })}
      </DrawerSection>

      {/* --- tổ hợp */}
      <DrawerSection title="Tổ hợp" hint={`ngưỡng ${(data.minMargin * 100).toFixed(2)}%`}>
        {data.combos.length ? (
          data.combos.map((c) => (
            <div key={c.comboId} className="flex items-center gap-4 border-b border-line py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <SignalLegs legs={c.legs} />
              </div>
              <div className="flex items-center gap-2">
                <Margin value={c.margin} min={data.minMargin} />
                {c.aboveMinMargin ? <Check className="size-3.5 text-ok" aria-label="Vượt ngưỡng" /> : <Minus className="size-3.5 text-faint" aria-label="Dưới ngưỡng" />}
              </div>
            </div>
          ))
        ) : (
          <p className="text-body text-muted-fg">Chưa có tổ hợp — room cần odds từ ít nhất 2 tenant.</p>
        )}
      </DrawerSection>

      {/* --- kèo đang hiệu lực */}
      <DrawerSection title="Kèo đang hiệu lực" hint={String(data.activeSignals.length)}>
        {data.activeSignals.length ? (
          data.activeSignals.map((s) => <ActiveSignal key={s.signalId} s={s} />)
        ) : (
          <p className="text-body text-muted-fg">Không có kèo nào đang sống cho room này.</p>
        )}
      </DrawerSection>

      {/* --- dòng thời gian */}
      <DrawerSection title="Dòng thời gian odds" hint="7 ngày gần nhất">
        {tl.data?.items.length ? <Timeline items={tl.data.items} /> : tl.data ? <p className="text-body text-muted-fg">Chưa có chuyển trạng thái nào.</p> : <SkeletonText lines={4} />}
      </DrawerSection>

      <div className="pt-2">
        <JsonBlock value={data} />
      </div>
    </div>
  );
}

function ActiveSignal({ s }: { s: RoomDetailView['activeSignals'][number] }) {
  const now = useNow(1_000);
  const left = Math.max(0, s.expiresAt - now);
  const total = s.expiresAt - s.issuedAt || 1;
  return (
    <div className="border-b border-line py-3 last:border-0">
      <div className="flex items-center gap-3">
        <Margin value={s.margin} min={0} size="lg" />
        <span className="num text-caption text-faint">{s.signalId}</span>
        <span className="num ml-auto text-caption text-muted-fg">còn {fmtAge(left)}</span>
      </div>
      <SignalLegs legs={s.legs} className="mt-1.5" />
      <div className="mt-2.5 h-px w-full bg-line">
        <div className="h-px bg-ok transition-[width] duration-1000 ease-linear" style={{ width: `${(left / total) * 100}%` }} />
      </div>
    </div>
  );
}

const TL_LABEL: Record<string, string> = { open: 'Mở', suspended: 'Tạm khóa', removed: 'Bị gỡ' };

function Timeline({ items }: { items: OddsTransition[] }) {
  return (
    <ol className="relative ml-1.5 border-l border-line">
      {items.map((t) => (
        <li key={t.id} className="relative pb-4 pl-5 last:pb-0">
          <span
            className={cn(
              'absolute -left-[4.5px] top-1.5 size-2 rounded-full ring-4 ring-raised',
              t.to === 'removed' ? 'bg-critical' : t.to === 'suspended' ? 'bg-warn' : t.from === null ? 'bg-accent' : 'bg-ok',
            )}
          />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="num text-caption text-faint">{fmtClock(t.at)}</span>
            <Tenant tenant={t.tenant} muted />
            <span className="text-body text-fg">
              {t.from === null ? 'Xuất hiện' : `${TL_LABEL[t.from]} → ${TL_LABEL[t.to]}`}
            </span>
            {t.odds && t.to !== 'removed' ? (
              <span className="num text-caption text-muted-fg">
                {fmtOdds(t.odds[0])} / {fmtOdds(t.odds[1])}
              </span>
            ) : null}
          </div>
          {t.reason ? (
            <div className="mt-0.5 text-caption text-muted-fg">
              {CANCEL_REASONS[t.reason] ?? t.reason} <span className="num text-faint">{t.reason}</span>
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function DrawerSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-5 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-baseline justify-between">
        <Eyebrow>{title}</Eyebrow>
        {hint ? <span className="num text-caption text-faint">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

