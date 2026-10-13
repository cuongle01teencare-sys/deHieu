'use client';

import { useEffect, useState } from 'react';
import { BellRing, Share, SquarePlus, WifiOff, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { fmtHM } from '@/lib/format';
import { isIos, isStandalone, pushPermission, pushSupport, requestPush } from '@/lib/push';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Sheet } from '../ui/panel';
import { LogoMark } from './wordmark';

/* ------------------------------------------------------------------ banners */

/** Dải mảnh dưới thanh trên: offline / đang kết nối lại / vừa kết nối lại. */
export function ConnectionBanner({
  online,
  reconnecting,
  dataAt,
}: {
  online: boolean;
  reconnecting: boolean;
  dataAt: number | null;
}) {
  const [justBack, setJustBack] = useState(false);
  const [wasDown, setWasDown] = useState(false);
  const down = !online || reconnecting;
  useEffect(() => {
    if (down) setWasDown(true);
    else if (wasDown) {
      setJustBack(true);
      setWasDown(false);
      const t = setTimeout(() => setJustBack(false), 2_500);
      return () => clearTimeout(t);
    }
  }, [down, wasDown]);

  if (!online)
    return (
      <Banner tone="offline">
        <WifiOff className="size-3.5 stroke-[1.5]" />
        Mất kết nối{dataAt ? ` — dữ liệu lúc ${fmtHM(dataAt)}` : ''}. Thao tác tạm khóa.
      </Banner>
    );
  if (reconnecting)
    return (
      <Banner tone="warn">
        <RefreshCw className="size-3.5 animate-spin stroke-[1.5] [animation-duration:2s]" />
        Đang kết nối lại stream… dữ liệu có thể cũ.
      </Banner>
    );
  if (justBack)
    return (
      <Banner tone="ok">
        <span className="size-1.5 rounded-full bg-ok" /> Đã kết nối lại — đang làm mới
      </Banner>
    );
  return null;
}

function Banner({ tone, children }: { tone: 'offline' | 'warn' | 'ok'; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex h-8 items-center justify-center gap-2 border-b border-line px-4 text-caption animate-fade-in',
        tone === 'offline' && 'bg-hover text-fg',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'ok' && 'bg-ok-soft text-ok',
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ push prompt + iOS guide */

const SNOOZE_KEY = 'arbops-push-snooze';

/**
 * Nhắc bật thông báo — sheet mềm của app, chỉ gọi prompt gốc khi người dùng bấm "Bật thông báo".
 * Không bao giờ hiện ở lần tải đầu: chờ 25s sử dụng, và "Để sau" ẩn 7 ngày.
 */
export function PushPromptManager() {
  const [open, setOpen] = useState<'push' | 'ios' | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => setOpen((e as CustomEvent<'push' | 'ios'>).detail);
    window.addEventListener('arbops:prompt', onOpen);
    let snoozed = false;
    try {
      snoozed = Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
    } catch {
      /* bỏ qua */
    }
    const t = setTimeout(() => {
      if (snoozed) return;
      const s = pushSupport();
      if (s === 'ios-needs-install') setOpen('ios');
      else if (s === 'supported' && pushPermission() === 'default') setOpen('push');
    }, 25_000);
    return () => {
      clearTimeout(t);
      window.removeEventListener('arbops:prompt', onOpen);
    };
  }, []);
  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + 7 * 86_400_000));
    } catch {
      /* bỏ qua */
    }
    setOpen(null);
  };
  return (
    <>
      <PushPromptSheet open={open === 'push'} onOpenChange={(v) => (v ? setOpen('push') : snooze())} onDone={() => setOpen(null)} />
      <IosInstallSheet open={open === 'ios'} onOpenChange={(v) => (v ? setOpen('ios') : snooze())} />
    </>
  );
}

/** Mở sheet từ bất kỳ đâu (vd trang Thông báo). */
export const openPrompt = (which: 'push' | 'ios') => window.dispatchEvent(new CustomEvent('arbops:prompt', { detail: which }));

export function PushPromptSheet({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex flex-col items-start gap-4">
          <span className="grid size-11 place-items-center rounded-[10px] bg-accent-soft text-accent-text">
            <BellRing className="size-5 stroke-[1.5]" />
          </span>
          Bật thông báo cho sự cố khẩn
        </span>
      }
      footer={
        <>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await requestPush();
              setBusy(false);
              onDone?.();
              if (r === 'granted') toast.success('Đã bật thông báo trên thiết bị này');
              else if (r === 'denied') toast.error('Trình duyệt đã chặn thông báo', { description: 'Mở cài đặt trình duyệt để cho phép lại.' });
            }}
          >
            Bật thông báo
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Để sau
          </Button>
        </>
      }
    >
      <p>Arb Ops chỉ báo những việc cần bạn xử lý: publisher FAILED, node hoặc Redis/Postgres mất kết nối, và kèo vượt ngưỡng bạn đặt.</p>
      <p className="mt-2">Chạm vào thông báo sẽ mở thẳng màn hình liên quan. Có thể chỉnh từng loại và giờ yên lặng bất cứ lúc nào.</p>
    </Sheet>
  );
}

export function IosInstallSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const steps = [
    { icon: <Share className="size-4 stroke-[1.5]" />, text: <>Chạm nút <b className="font-medium text-fg">Chia sẻ</b> ở thanh dưới Safari</> },
    { icon: <SquarePlus className="size-4 stroke-[1.5]" />, text: <>Chọn <b className="font-medium text-fg">Thêm vào Màn hình chính</b></> },
    { icon: <LogoMark className="size-4" />, text: <>Mở <b className="font-medium text-fg">Arb Ops</b> từ Màn hình chính rồi bật thông báo</> },
  ];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Cài Arb Ops để nhận thông báo"
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Đã hiểu
        </Button>
      }
    >
      <p>Trên iPhone, thông báo đẩy chỉ hoạt động khi web app được thêm vào Màn hình chính (iOS 16.4 trở lên).</p>
      <ol className="mt-5 flex flex-col">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-4 border-b border-line py-3.5 last:border-0">
            <span className="num w-4 text-caption text-faint">{i + 1}</span>
            <span className="grid size-8 place-items-center rounded-[8px] bg-hover text-accent-text">{s.icon}</span>
            <span className="flex-1 text-body text-muted-fg">{s.text}</span>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ service worker + cập nhật */

/** Đăng ký SW (push + bấm thông báo mở đúng màn); có bản mới → toast "Tải lại". */
export function ServiceWorkerManager() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    let reloading = false;
    const notify = (w: ServiceWorker) =>
      toast('Có phiên bản mới', {
        duration: Infinity,
        action: { label: 'Tải lại', onClick: () => w.postMessage({ type: 'SKIP_WAITING' }) },
      });
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) notify(w);
        });
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }, []);
  return null;
}

/** Thông tin cài đặt cho trang Thông báo. */
export function useInstallState() {
  const [s, set] = useState({ ios: false, standalone: false, permission: 'default' as NotificationPermission | 'unsupported' });
  useEffect(() => {
    const read = () => set({ ios: isIos(), standalone: isStandalone(), permission: pushPermission() });
    read();
    const t = setInterval(read, 2_000);
    return () => clearInterval(t);
  }, []);
  return s;
}
