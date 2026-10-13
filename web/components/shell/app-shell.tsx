'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft, BellRing } from 'lucide-react';
import { Toaster } from 'sonner';
import { Drawer } from 'vaul';
import { findNav } from '@/lib/nav';
import { decodePathSegment } from '@/lib/match-links';
import type { WebUser } from '@/lib/types';
import { useTheme } from '@/hooks/use-theme';
import { useMedia } from '@/hooks/use-media';
import { useOnline } from '@/hooks/use-online';
import { ConsoleDataProvider, useConsoleData } from '../console-data';
import { TooltipProvider } from '../ui/tooltip';
import { ShellCtx } from './shell-context';
import { Sidebar } from './sidebar';
import { MobileTopbar, Topbar } from './topbar';
import { BottomTabs, MoreSheet } from './mobile-nav';
import { CommandPalette } from './command-palette';
import { NotificationList, NotificationsProvider, useNotifications } from './notifications';
import { ConnectionBanner, PushPromptManager, ServiceWorkerManager } from './pwa';

interface Props {
  user: WebUser;
  envLabel: string;
  children: React.ReactNode;
}

export { useShell, useCan, useGuard, useMutate } from './shell-context';

export function AppShell(props: Props) {
  const shell = useMemo(() => ({ envLabel: props.envLabel, user: props.user }), [props.envLabel, props.user]);
  return (
    <ShellCtx.Provider value={shell}>
      <TooltipProvider>
        <ConsoleDataProvider>
          <NotificationsProvider>
            <Shell {...props} />
          </NotificationsProvider>
        </ConsoleDataProvider>
      </TooltipProvider>
    </ShellCtx.Provider>
  );
}

const SIDEBAR_KEY = 'arbops-sidebar';

/** Breadcrumb + nút quay lại (mobile) theo đường dẫn. */
function useCrumbs(pathname: string) {
  const nav = findNav(pathname);
  const crumbs: { label: string; href?: string }[] = [{ label: nav?.label ?? 'Arb Ops', href: nav?.href }];
  let back: { href: string; label: string } | null = null;
  const m = /^\/tran-dau\/(.+)$/.exec(pathname);
  if (m) {
    const id = decodePathSegment(m[1]!);
    const [, pair = ''] = id.split(':');
    crumbs.push({ label: pair.replace('~', ' vs ') });
    back = { href: '/tran-dau', label: 'Trận đấu' };
  }
  return { nav, crumbs, back, title: crumbs[crumbs.length - 1]!.label };
}

function Shell({ user, envLabel, children }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { nav, crumbs, back, title } = useCrumbs(pathname);
  const [theme, toggleTheme] = useTheme();
  const online = useOnline();
  const tablet = useMedia('(max-width: 1179px)');
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const { snapshot, snapshotAt, status, lastFrameAt } = useConsoleData();

  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_KEY);
      if (v) setCollapsed(v === '1');
    } catch {
      /* bỏ qua */
    }
  }, []);
  const isCollapsed = collapsed ?? tablet;
  const toggleSidebar = () => {
    const next = !isCollapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      /* bỏ qua */
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const incidents = snapshot?.incidents ?? [];
  const criticalCount = incidents.filter((i) => i.severity === 'critical').length;
  const fromNotif = params.get('from') === 'notif' || params.get('from') === 'push';
  const mobileBack = back ?? (fromNotif && pathname !== '/' ? { href: '/', label: 'Tổng quan' } : null);

  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <Sidebar
        active={nav}
        collapsed={isCollapsed}
        onToggle={toggleSidebar}
        incidentCount={incidents.length}
        criticalCount={criticalCount}
        envLabel={envLabel}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          crumbs={crumbs}
          status={status}
          lastFrameAt={lastFrameAt}
          online={online}
          health={snapshot?.health ?? []}
          incidentCount={incidents.length}
          criticalCount={criticalCount}
          user={user}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenCommand={() => setCommandOpen(true)}
        />
        <MobileTopbar title={title} back={mobileBack} status={status} online={online} onBell={() => setBellOpen(true)} />
        <ConnectionBanner online={online} reconnecting={status === 'reconnecting'} dataAt={snapshotAt} />
        {fromNotif ? <DeepLinkBar /> : null}
        <main className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-4 pb-28 pt-6 md:px-8 md:pb-16 md:pt-8">{children}</main>
      </div>

      <BottomTabs active={nav} incidentCount={incidents.length} criticalCount={criticalCount} onMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} active={nav} theme={theme} onToggleTheme={toggleTheme} userName={user.name} />
      <MobileNotificationCenter open={bellOpen} onOpenChange={setBellOpen} />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} tasks={snapshot?.tasks ?? []} onToggleTheme={toggleTheme} />
      <PushPromptManager />
      <ServiceWorkerManager />
      <Toaster
        position="bottom-right"
        theme={theme}
        offset={{ bottom: 24, right: 24 }}
        mobileOffset={{ bottom: 76 }}
        toastOptions={{
          classNames: {
            toast: '!bg-raised !text-fg !shadow-pop !border-0 !rounded-[10px] !font-sans !text-body',
            description: '!text-muted-fg',
            actionButton: '!bg-accent !text-accent-fg !rounded-[6px]',
          },
        }}
      />
    </div>
  );
}

/** Đến từ thông báo: lối tắt quay về Tổng quan (desktop; mobile dùng nút back trên thanh trên). */
function DeepLinkBar() {
  return (
    <div className="hidden h-10 items-center gap-3 border-b border-line px-8 text-caption text-muted-fg animate-fade-in md:flex">
      <Link href="/" className="inline-flex items-center gap-1.5 text-fg hover:text-accent-text">
        <ArrowLeft className="size-3.5" /> Tổng quan
      </Link>
      <span className="h-3 w-px bg-line" />
      <BellRing className="size-3.5 stroke-[1.5]" /> Mở từ thông báo — mục liên quan được đánh dấu bên dưới
    </div>
  );
}

function MobileNotificationCenter({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { unread, markAllRead } = useNotifications();
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] flex-col rounded-t-[14px] bg-raised outline-none">
          <div className="mx-auto mb-1 mt-2.5 h-1 w-9 rounded-full bg-line-strong" aria-hidden />
          <div className="flex items-center justify-between px-4 pb-1 pt-2">
            <Drawer.Title className="text-[17px] font-semibold">Thông báo</Drawer.Title>
            {unread ? (
              <button type="button" onClick={markAllRead} className="h-11 text-caption text-accent-text">
                Đánh dấu đã đọc
              </button>
            ) : null}
          </div>
          <Drawer.Description className="sr-only">Danh sách thông báo</Drawer.Description>
          <div className="flex-1 overflow-y-auto px-4 pb-safe">
            <NotificationList onOpen={() => onOpenChange(false)} />
            <Link href="/thong-bao" onClick={() => onOpenChange(false)} className="mb-6 mt-2 flex h-11 items-center justify-center text-caption text-muted-fg">
              Tùy chọn thông báo
            </Link>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
