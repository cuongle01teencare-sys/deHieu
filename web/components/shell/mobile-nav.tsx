'use client';

import Link from 'next/link';
import { AlertTriangle, LayoutDashboard, LogOut, Menu as MenuIcon, Moon, Sun, Zap, Activity, ChevronRight } from 'lucide-react';
import { Drawer } from 'vaul';
import { MOBILE_TABS, NAV_ITEMS, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { logout } from '@/app/login/actions';
import type { Theme } from '@/hooks/use-theme';

const TAB_ICON: Record<string, typeof LayoutDashboard> = {
  '/': LayoutDashboard,
  '/su-co': AlertTriangle,
  '/keo': Zap,
  '/tran-dau': Activity,
};
const TAB_LABEL: Record<string, string> = { '/': 'Tổng quan', '/su-co': 'Sự cố', '/keo': 'Kèo', '/tran-dau': 'Trận đấu' };

/** Tab dưới (tối đa 5): nền mờ trong suốt, mục chọn màu nhấn, nhãn dưới biểu tượng. */
export function BottomTabs({
  active,
  incidentCount,
  criticalCount,
  onMore,
}: {
  active: NavItem | undefined;
  incidentCount: number;
  criticalCount: number;
  onMore: () => void;
}) {
  const inMore = active && !MOBILE_TABS.includes(active.href);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/80 pb-safe backdrop-blur-xl md:hidden"
      aria-label="Điều hướng"
    >
      <ul className="grid h-[52px] grid-cols-5">
        {MOBILE_TABS.map((href) => {
          const Icon = TAB_ICON[href]!;
          const on = active?.href === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={on ? 'page' : undefined}
                className={cn('relative flex h-full flex-col items-center justify-center gap-1 text-[10px] font-medium', on ? 'text-accent-text' : 'text-muted-fg')}
              >
                <Icon className="size-[22px] stroke-[1.5]" />
                {TAB_LABEL[href]}
                {href === '/su-co' && incidentCount ? (
                  <span
                    className={cn(
                      'num absolute left-1/2 top-1 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] leading-none text-white',
                      criticalCount ? 'bg-critical' : 'bg-warn',
                    )}
                  >
                    {incidentCount}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onMore}
            className={cn('flex h-full w-full flex-col items-center justify-center gap-1 text-[10px] font-medium', inMore ? 'text-accent-text' : 'text-muted-fg')}
          >
            <MenuIcon className="size-[22px] stroke-[1.5]" />
            Thêm
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** Sheet "Thêm": các màn còn lại, theme, đăng xuất. */
export function MoreSheet({
  open,
  onOpenChange,
  active,
  theme,
  onToggleTheme,
  userName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  active: NavItem | undefined;
  theme: Theme;
  onToggleTheme: () => void;
  userName: string;
}) {
  const rest = NAV_ITEMS.filter((i) => !MOBILE_TABS.includes(i.href));
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[14px] bg-raised outline-none">
          <div className="mx-auto mb-1 mt-2.5 h-1 w-9 rounded-full bg-line-strong" aria-hidden />
          <Drawer.Title className="px-5 pb-2 pt-2 text-[17px] font-semibold">Thêm</Drawer.Title>
          <Drawer.Description className="sr-only">Các màn hình khác</Drawer.Description>
          <div className="overflow-y-auto px-5 pb-safe">
            <ul>
              {rest.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => onOpenChange(false)}
                    className={cn('flex h-12 items-center gap-3 border-b border-line text-[15px]', active?.href === i.href ? 'text-accent-text' : 'text-fg')}
                  >
                    <i.icon className="size-[18px] stroke-[1.5] text-muted-fg" />
                    <span className="flex-1">{i.label}</span>
                    <ChevronRight className="size-4 text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
            <button type="button" onClick={onToggleTheme} className="flex h-12 w-full items-center gap-3 border-b border-line text-[15px] text-fg">
              {theme === 'dark' ? <Sun className="size-[18px] stroke-[1.5] text-muted-fg" /> : <Moon className="size-[18px] stroke-[1.5] text-muted-fg" />}
              <span className="flex-1 text-left">{theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}</span>
            </button>
            <form action={logout}>
              <button type="submit" className="mb-4 flex h-12 w-full items-center gap-3 text-[15px] text-critical">
                <LogOut className="size-[18px] stroke-[1.5]" />
                <span className="flex-1 text-left">Đăng xuất</span>
                <span className="text-caption text-faint">{userName}</span>
              </button>
            </form>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
