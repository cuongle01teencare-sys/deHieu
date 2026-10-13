'use client';

import Link from 'next/link';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NAV_GROUPS, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { Hint } from '../ui/tooltip';
import { Wordmark } from './wordmark';

/**
 * Sidebar tối giản: không hộp quanh mục; mục đang chọn = chữ nhấn + nền rất nhạt.
 * Thu gọn còn biểu tượng (mặc định thu gọn ở tablet).
 */
export function Sidebar({
  active,
  collapsed,
  onToggle,
  incidentCount,
  criticalCount,
  envLabel,
}: {
  active: NavItem | undefined;
  collapsed: boolean;
  onToggle: () => void;
  incidentCount: number;
  criticalCount: number;
  envLabel: string;
}) {
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line transition-[width] duration-200 ease-out md:flex',
        collapsed ? 'w-[60px]' : 'w-[232px]',
      )}
    >
      <div className={cn('flex h-14 items-center', collapsed ? 'justify-center' : 'px-5')}>
        <Wordmark compact={collapsed} />
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-2 scrollbar-none" aria-label="Điều hướng chính">
        {NAV_GROUPS.map((g, gi) => (
          <div key={gi} className={cn(gi > 0 && 'mt-5')}>
            {g.label ? (
              collapsed ? (
                <div className="mx-auto mb-2 h-px w-5 bg-line" />
              ) : (
                <div className="mb-1 px-2 text-micro text-faint">{g.label}</div>
              )
            ) : null}
            <ul className="flex flex-col gap-px">
              {g.items.map((item) => {
                const on = active?.href === item.href;
                const count = item.href === '/su-co' ? incidentCount : 0;
                const link = (
                  <Link
                    href={item.href}
                    aria-current={on ? 'page' : undefined}
                    className={cn(
                      'relative flex h-8 items-center gap-2.5 rounded-[6px] text-body transition-colors duration-150',
                      collapsed ? 'justify-center' : 'px-2',
                      on ? 'bg-accent-soft font-medium text-accent-text' : 'text-muted-fg hover:bg-hover/70 hover:text-fg',
                    )}
                  >
                    <item.icon className="size-4 shrink-0 stroke-[1.5]" />
                    {!collapsed ? <span className="truncate">{item.label}</span> : null}
                    {count > 0 ? (
                      collapsed ? (
                        <span className={cn('absolute right-2 top-1.5 size-1.5 rounded-full', criticalCount ? 'bg-critical' : 'bg-warn')} />
                      ) : (
                        <span className={cn('num ml-auto text-caption', criticalCount ? 'text-critical' : 'text-warn')}>{count}</span>
                      )
                    ) : null}
                  </Link>
                );
                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Hint content={item.label} side="right">
                        {link}
                      </Hint>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('flex h-12 items-center border-t border-line', collapsed ? 'justify-center' : 'justify-between px-4')}>
        {!collapsed ? <span className="truncate text-caption text-faint">{envLabel}</span> : null}
        <button
          type="button"
          onClick={onToggle}
          className="grid size-8 place-items-center rounded-[6px] text-faint transition-colors hover:bg-hover hover:text-fg"
          aria-label={collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}
        >
          {collapsed ? <PanelLeftOpen className="size-4 stroke-[1.5]" /> : <PanelLeftClose className="size-4 stroke-[1.5]" />}
        </button>
      </div>
    </aside>
  );
}
