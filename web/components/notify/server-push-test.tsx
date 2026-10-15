'use client';

import { useState } from 'react';
import { RadioTower, Send } from 'lucide-react';
import { toast } from 'sonner';
import { pushSubscriptionId } from '@/lib/push';
import { useApi } from '@/hooks/use-api';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Section } from '../ui/layout';
import { Pill } from '../ui/status';

interface PushStatus {
  configured: boolean;
  webUrl: string | null;
}
interface PushResult {
  id: string | null;
  errors: string[];
}

/**
 * Gửi thử THẬT từ backend qua OneSignal — cùng đường với thông báo kèo On click: kiểm tra key,
 * App ID, thiết bị đã đăng ký và tag "Kèo" một lượt.
 */
export function ServerPushTest({ subscribed }: { subscribed: boolean }) {
  const status = useApi<PushStatus>('trading/push/status', 60_000);
  const guard = useGuard('trading:manage');
  const mutate = useMutate();
  const [busy, setBusy] = useState<'device' | 'all' | null>(null);

  const send = async (scope: 'device' | 'all') => {
    const subscriptionId = scope === 'device' ? pushSubscriptionId() : null;
    if (scope === 'device' && !subscriptionId) {
      toast.error('Thiết bị này chưa có mã đăng ký OneSignal', { description: 'Bật thông báo ở trên rồi thử lại.' });
      return;
    }
    setBusy(scope);
    const r = await mutate<PushResult>('trading/push/test', { method: 'POST', body: subscriptionId ? { subscriptionId } : {} });
    setBusy(null);
    if (!r) return;
    if (r.errors.length || !r.id)
      toast.warning('OneSignal đã nhận yêu cầu nhưng không gửi tới thiết bị nào', {
        description: r.errors.join(' · ') || 'Không có thiết bị nào khớp (chưa bật thông báo, hoặc tắt mục "Kèo").',
      });
    else toast.success('Đã gửi qua OneSignal', { description: `Mã thông báo ${r.id}. Thường tới trong vài giây.` });
  };

  const notReady = !status.data ? 'Đang kiểm tra backend…' : !status.data.configured ? 'Backend chưa đặt ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY' : guard;

  return (
    <Section
      title="Gửi thử từ backend (OneSignal)"
      description="Gửi một thông báo thật từ server qua OneSignal, đúng đường gửi kèo On click. Nhận được nghĩa là key, App ID và đăng ký thiết bị đều ổn."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-caption text-muted-fg">
        <RadioTower className="size-4 stroke-[1.5]" aria-hidden />
        Backend:
        {status.error ? (
          <Pill tone="critical">không đọc được</Pill>
        ) : !status.data ? (
          <Pill tone="muted">đang kiểm tra</Pill>
        ) : status.data.configured ? (
          <Pill tone="ok">đã cấu hình OneSignal</Pill>
        ) : (
          <Pill tone="warn">chưa cấu hình OneSignal</Pill>
        )}
        {status.data?.configured && !status.data.webUrl ? <span className="text-warn">· chưa đặt WEB_APP_URL nên bấm thông báo sẽ không mở trang</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy === 'device'} disabledReason={notReady ?? (subscribed ? null : 'Thiết bị này chưa bật thông báo')} onClick={() => void send('device')}>
          <Send aria-hidden /> Gửi thử tới thiết bị này
        </Button>
        <Button variant="secondary" loading={busy === 'all'} disabledReason={notReady} onClick={() => void send('all')}>
          <Send aria-hidden /> Gửi tới mọi thiết bị bật mục Kèo
        </Button>
      </div>
      <p className="mt-3 text-caption text-faint">
        "Mọi thiết bị" dùng đúng bộ lọc của thông báo kèo On click (mục "Kèo vượt ngưỡng · kèo On click" đang bật), nên dùng để kiểm tra điện thoại khác có nhận kèo hay không.
      </p>
    </Section>
  );
}
