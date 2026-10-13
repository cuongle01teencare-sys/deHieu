'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { Activity, Box, CornerDownLeft, Moon, Radio, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { NAV_ITEMS } from '@/lib/nav';
import type { ListResult, MatchListItem, RoomListItem, TaskRecord } from '@/lib/types';
import { fmtMargin } from '@/lib/format';
import { TenantDots } from '../ui/tenant';
import { StatusDot, TASK_STATE_TONE } from '../ui/status';

const itemCls =
  'flex h-10 cursor-pointer select-none items-center gap-3 rounded-[6px] px-2.5 text-body text-muted-fg outline-none data-[selected=true]:bg-hover data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:stroke-[1.5]';
const groupCls =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:text-faint';

/** ⌘K / Ctrl+K — nhảy tới trận, room, task hoặc màn hình. */
export function CommandPalette({
  open,
  onOpenChange,
  tasks,
  onToggleTheme,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tasks: TaskRecord[];
  onToggleTheme: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<MatchListItem[]>([]);
  const [rooms, setRooms] = useState<RoomListItem[]>([]);

  useEffect(() => {
    if (!open) return;
    setQ('');
    api<ListResult<MatchListItem>>('arbitrage/matches?limit=50')
      .then((r) => setMatches(r.items))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setRooms([]);
      return;
    }
    const t = setTimeout(() => {
      api<ListResult<RoomListItem>>(`arbitrage/rooms?q=${encodeURIComponent(q.trim())}&limit=8`)
        .then((r) => setRooms(r.items))
        .catch(() => undefined);
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[min(600px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[10px] bg-raised shadow-pop outline-none animate-pop-in">
          <VisuallyHidden.Root>
            <Dialog.Title>Tìm kiếm nhanh</Dialog.Title>
            <Dialog.Description>Nhảy tới trận, room, task hoặc màn hình</Dialog.Description>
          </VisuallyHidden.Root>
          <Command loop className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 shrink-0 stroke-[1.5] text-faint" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder="Tìm trận, room, task, màn hình…"
                className="h-12 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint"
              />
              <kbd className="num rounded bg-hover px-1.5 py-0.5 text-[10px] text-faint">esc</kbd>
            </div>
            <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
              <Command.Empty className="py-10 text-center text-body text-muted-fg">Không tìm thấy kết quả.</Command.Empty>

              {matches.length ? (
                <Command.Group heading="Trận đấu" className={groupCls}>
                  {matches.map((m) => (
                    <Command.Item key={m.match} value={`trận ${m.match} ${m.teams.join(' ')}`} onSelect={() => go(`/tran-dau/${encodeURIComponent(m.match)}`)} className={itemCls}>
                      <Activity />
                      <span className="min-w-0 flex-1 truncate text-fg">
                        {m.teams[0]} <span className="text-faint">vs</span> {m.teams[1]}
                      </span>
                      <TenantDots tenants={m.tenants} />
                      <span className="num w-16 text-right text-caption">{fmtMargin(m.bestMargin)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              {rooms.length ? (
                <Command.Group heading="Room" className={groupCls}>
                  {rooms.map((r) => {
                    const match = r.room.replace(/^room:/, '').replace(/:[^:]+$/, '');
                    return (
                      <Command.Item key={r.room} value={`room ${r.room}`} onSelect={() => go(`/tran-dau/${encodeURIComponent(match)}?market=${encodeURIComponent(r.market)}`)} className={itemCls}>
                        <Box />
                        <span className="num min-w-0 flex-1 truncate text-caption">{r.room}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ) : null}

              {tasks.length ? (
                <Command.Group heading="Publisher" className={groupCls}>
                  {tasks.map((t) => (
                    <Command.Item key={t.spec.taskId} value={`task ${t.spec.taskId} ${t.spec.kind}`} onSelect={() => go(`/publisher?task=${encodeURIComponent(t.spec.taskId)}`)} className={itemCls}>
                      <Radio />
                      <span className="num flex-1 truncate text-fg">{t.spec.taskId}</span>
                      <StatusDot tone={TASK_STATE_TONE[t.state]} />
                      <span className="text-caption">{t.state}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}

              <Command.Group heading="Màn hình" className={groupCls}>
                {NAV_ITEMS.map((n) => (
                  <Command.Item key={n.href} value={`màn hình ${n.label}`} onSelect={() => go(n.href)} className={itemCls}>
                    <n.icon />
                    <span className="flex-1 text-fg">{n.label}</span>
                    <CornerDownLeft className="opacity-0 [[data-selected=true]_&]:opacity-60" />
                  </Command.Item>
                ))}
                <Command.Item value="đổi giao diện sáng tối theme" onSelect={() => { onToggleTheme(); onOpenChange(false); }} className={itemCls}>
                  <Moon />
                  <span className="flex-1 text-fg">Đổi giao diện sáng / tối</span>
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
