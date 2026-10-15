'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Bell, ChevronRight, LogOut, Moon, Palette, Search, Settings2, Sun } from 'lucide-react';
import { fmtAge, initials } from '@/lib/format';
import type { HealthResult } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useNow } from '@/hooks/use-now';
import type { StreamStatus } from '../console-data';
import { Hint } from '../ui/tooltip';
import { Menu, MenuItem, MenuLabel, MenuSeparator, Popover } from '../ui/menu';
import { openPushSetup } from './push-setup';
import { StatusDot, type Tone } from '../ui/status';
import { NotificationList, useNotifications } from './notifications';
import { logout } from '@/app/login/actions';
import type { WebUser } from '@/lib/types';
import type { Theme } from '@/hooks/use-theme';

export const STREAM_LABEL: Record<StreamStatus, { tone: Tone; text: string; help: string }> = {
  stream: { tone: 'ok', text: 'Trực tiếp', help: 'Đang nhận stream realtime từ backend' },
  polling: { tone: 'info', text: 'Thăm dò', help: 'Không có stream — tự lấy dữ liệu mỗi 2–5 giây' },
  connecting: { tone: 'warn', text: 'Đang kết nối', help: 'Đang mở kết nối stream' },
  reconnecting: { tone: 'warn', text: 'Kết nối lại', help: 'Mất stream — đang kết nối lại, tạm thăm dò REST' },
};

/** Trạng thái kết nối: chấm + chữ ngắn + tuổi frame cuối. */
export function ConnectionPill({ status, lastFrameAt, online = true, compact }: { status: StreamStatus; lastFrameAt: number | null; online?: boolean; compact?: boolean }) {
  const now = useNow(1_000);
  const s = online ? STREAM_LABEL[status] : { tone: 'critical' as Tone, text: 'Ngoại tuyến', help: 'Thiết bị mất mạng' };
  return (
    <Hint content={s.help}>
      <span className="inline-flex h-8 cursor-default items-center gap-2 rounded-[6px] px-2 text-caption text-muted-fg">
        <StatusDot tone={s.tone} pulse={online && status === 'stream'} label={s.text} />
        {!compact ? <span>{s.text}</span> : null}
        {!compact && lastFrameAt && online ? <span className="num text-faint">{fmtAge(now - lastFrameAt)}</span> : null}
      </span>
    </Hint>
  );
}

const HEALTH_NAME: Record<string, string> = { dragonfly: 'Redis', postgres: 'Postgres' };

export function Topbar({
  crumbs,
  status,
  lastFrameAt,
  online,
  health,
  incidentCount,
  criticalCount,
  user,
  theme,
  onToggleTheme,
  onOpenCommand,
}: {
  crumbs: { label: string; href?: string }[];
  status: StreamStatus;
  lastFrameAt: number | null;
  online: boolean;
  health: HealthResult[];
  incidentCount: number;
  criticalCount: number;
  user: WebUser;
  theme: Theme;
  onToggleTheme: () => void;
  onOpenCommand: () => void;
}) {
  const router = useRouter();
  const { unread, markAllRead } = useNotifications();
  const [bellOpen, setBellOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 hidden h-14 items-center gap-4 border-b border-line bg-bg/85 px-8 backdrop-blur-md md:flex">
      <nav aria-label="Vị trí" className="flex min-w-0 flex-1 items-center gap-1.5 text-body">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-faint" /> : null}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="truncate text-muted-fg hover:text-fg">
                {c.label}
              </Link>
            ) : (
              <span className="truncate font-medium text-fg">{c.label}</span>
            )}
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-1">
        <ConnectionPill status={status} lastFrameAt={lastFrameAt} online={online} />
        <Hint
          content={
            <div className="flex flex-col gap-1">
              {health.map((h) => (
                <span key={h.name} className="flex items-center gap-2">
                  <StatusDot tone={h.ok ? 'ok' : 'critical'} />
                  {HEALTH_NAME[h.name] ?? h.name}
                  <span className="num text-faint">{h.ok ? `${h.latencyMs}ms` : h.error}</span>
                </span>
              ))}
            </div>
          }
        >
          <span className="inline-flex h-8 cursor-default items-center gap-1 rounded-[6px] px-2" aria-label="Sức khỏe Redis và Postgres">
            {health.length ? (
              health.map((h) => <StatusDot key={h.name} tone={h.ok ? 'ok' : 'critical'} label={`${HEALTH_NAME[h.name] ?? h.name}: ${h.ok ? 'ổn' : 'lỗi'}`} />)
            ) : (
              <StatusDot tone="muted" />
            )}
            <span className="ml-1 text-caption text-faint">DB</span>
          </span>
        </Hint>
        <Link
          href="/su-co"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2 text-caption transition-colors hover:bg-hover',
            criticalCount ? 'text-critical' : incidentCount ? 'text-warn' : 'text-muted-fg',
          )}
          aria-label={`${incidentCount} sự cố đang mở`}
        >
          <span className="num font-medium">{incidentCount}</span>
          <span>sự cố</span>
        </Link>

        <div className="mx-2 h-4 w-px bg-line" />

        <button
          type="button"
          onClick={onOpenCommand}
          className="inline-flex h-8 w-52 items-center gap-2 rounded-[6px] px-2.5 text-caption text-faint shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:text-muted-fg lg:w-60"
        >
          <Search className="size-3.5 stroke-[1.5]" />
          <span className="flex-1 text-left">Tìm trận, room, task…</span>
          <kbd className="num rounded bg-hover px-1.5 py-0.5 text-[10px] text-muted-fg">⌘K</kbd>
        </button>

        <Popover
          open={bellOpen}
          onOpenChange={setBellOpen}
          align="end"
          className="w-[400px] p-0"
          trigger={
            <button type="button" className="relative grid size-8 place-items-center rounded-[6px] text-muted-fg transition-colors hover:bg-hover hover:text-fg" aria-label={`Thông báo, ${unread} chưa đọc`}>
              <Bell className="size-4 stroke-[1.5]" />
              {unread ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-critical" /> : null}
            </button>
          }
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-section font-semibold">Thông báo</span>
            {unread ? (
              <button type="button" className="text-caption text-muted-fg hover:text-fg" onClick={markAllRead}>
                Đánh dấu đã đọc
              </button>
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto px-1">
            <NotificationList onOpen={() => setBellOpen(false)} max={12} />
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-caption">
            <Link href="/thong-bao" onClick={() => setBellOpen(false)} className="flex items-center gap-2 text-muted-fg hover:text-fg">
              <Settings2 className="size-3.5 stroke-[1.5]" /> Tùy chọn thông báo
            </Link>
            <button
              type="button"
              className="flex items-center gap-1.5 text-accent-text hover:underline"
              onClick={() => {
                setBellOpen(false);
                openPushSetup();
              }}
            >
              <Bell className="size-3.5 stroke-[1.5]" /> Bật trên thiết bị này
            </button>
          </div>
        </Popover>

        <Menu
          trigger={
            <button type="button" className="ml-1 grid size-8 place-items-center rounded-full bg-accent-soft text-micro font-semibold text-accent-text" aria-label="Tài khoản">
              {initials(user.name)}
            </button>
          }
        >
          <MenuLabel>
            <span className="block text-body font-medium text-fg">{user.name}</span>
            <span className="block text-caption text-muted-fg">{user.role || user.username}</span>
          </MenuLabel>
          <MenuSeparator />
          <MenuItem icon={theme === 'dark' ? <Sun /> : <Moon />} onSelect={onToggleTheme}>
            {theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}
          </MenuItem>
          <MenuItem icon={<Bell />} onSelect={() => router.push('/thong-bao')}>
            Thông báo
          </MenuItem>
          <MenuItem icon={<Palette />} onSelect={() => router.push('/thiet-ke')}>
            Hệ thống thiết kế
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<LogOut />} onSelect={() => void logout()}>
            Đăng xuất
          </MenuItem>
        </Menu>
      </div>
    </header>
  );
}

/** Thanh trên mobile: tiêu đề lớn, chấm stream, chuông có huy hiệu. */
export function MobileTopbar({
  title,
  back,
  status,
  online,
  onBell,
}: {
  title: string;
  back?: { href: string; label: string } | null;
  status: StreamStatus;
  online: boolean;
  onBell: () => void;
}) {
  const { unread } = useNotifications();
  const s = online ? STREAM_LABEL[status] : { tone: 'critical' as Tone, text: 'Ngoại tuyến' };
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 pt-safe backdrop-blur-xl md:hidden">
      <div className="flex h-14 items-center gap-3 px-4">
        {back ? (
          <Link href={back.href} className="-ml-2 flex h-11 items-center gap-0.5 pr-1 text-body text-accent-text">
            <ChevronRight className="size-5 rotate-180" />
            {back.label}
          </Link>
        ) : null}
        <h1 className={cn('min-w-0 flex-1 truncate font-semibold tracking-tight text-fg', back ? 'text-[15px]' : 'text-[22px]')}>{title}</h1>
        <span className="flex h-11 items-center gap-1.5 text-micro text-faint" aria-label={s.text}>
          <StatusDot tone={s.tone} pulse={online && status === 'stream'} />
        </span>
        <button type="button" onClick={onBell} className="relative -mr-2 grid size-11 place-items-center text-muted-fg" aria-label={`Thông báo, ${unread} chưa đọc`}>
          <Bell className="size-5 stroke-[1.5]" />
          {unread ? (
            <span className="num absolute right-1.5 top-2 grid h-4 min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-medium leading-none text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
      </div>
    </header>
  );
}
