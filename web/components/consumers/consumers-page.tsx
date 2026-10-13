'use client';

import { useState } from 'react';
import { Bot } from 'lucide-react';
import type { ConsumerHubStats, ConsumerView } from '@/lib/types';
import { fmtSince, fmtStamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useGuard, useMutate } from '../shell/shell-context';
import { Switch } from '../ui/controls';
import { PageHeader } from '../ui/layout';
import { Confirm } from '../ui/panel';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Pill, StatusDot } from '../ui/status';
import { Hint } from '../ui/tooltip';
import { LiveStamp } from '../ui/values';

const BACKLOG = 50;

export function ConsumersPage() {
  const { data, error, reload, updatedAt } = useApi<ConsumerHubStats>('consumers/hub', 5_000);
  const reason = useGuard('consumers:control');
  const mutate = useMutate();
  const now = useNow(5_000);
  const [pending, setPending] = useState<ConsumerView | null>(null);
  const [busy, setBusy] = useState(false);

  const consumers = data?.consumers ?? [];
  const sorted = [...consumers].sort((a, b) => Number(b.connected) - Number(a.connected) || b.pending - a.pending);
  const online = sorted.filter((c) => c.connected).length;

  return (
    <div>
      <PageHeader
        title="Consumer"
        description="Bot giao dịch và kênh Discord nhận kèo. Tạm dừng = ngừng gửi kèo mới cho consumer đó."
        meta={
          <>
            <LiveStamp at={updatedAt} />
            {data ? (
              <span className="text-caption text-muted-fg">
                <span className="num text-fg">{online}</span>/{consumers.length} trực tuyến
                <span className="text-faint"> · </span>
                <span className="num text-fg">{data.pendingDeliveries}</span> chờ ack
              </span>
            ) : null}
          </>
        }
      />
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {!data && !error ? <SkeletonRows rows={5} cols={[24, 10, 10, 12, 16]} /> : null}
      {data && !consumers.length ? <Empty icon={Bot}>Chưa có consumer nào kết nối tới cổng kèo.</Empty> : null}

      {sorted.length ? (
        <ul>
          <li className="hidden h-9 items-end gap-6 border-b border-line pb-2 text-caption text-muted-fg md:flex">
            <span className="flex-1">Consumer</span>
            <span className="w-24">Vai trò</span>
            <span className="w-28 text-right">Chờ ack</span>
            <span className="w-36 text-right">Lần cuối</span>
            <span className="w-32 text-right">Gửi kèo</span>
          </li>
          {sorted.map((c) => (
            <li key={c.consumerId} className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-1 border-b border-line py-3 last:border-0">
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <StatusDot tone={c.connected ? 'ok' : 'critical'} label={c.connected ? 'Trực tuyến' : 'Mất kết nối'} />
                <span className={cn('num truncate text-body', c.connected ? 'text-fg' : 'text-muted-fg')}>{c.consumerId}</span>
                {c.paused ? <Pill tone="warn">Tạm dừng</Pill> : null}
                {!c.connected ? <span className="text-caption text-critical">mất kết nối</span> : null}
              </span>
              <span className="w-24 text-caption text-muted-fg md:block">{c.role}</span>
              <span className={cn('num w-28 text-right text-body', c.pending >= BACKLOG ? 'text-warn' : c.pending ? 'text-fg' : 'text-faint')}>
                {c.pending}
                {c.pending >= BACKLOG ? <span className="ml-1 text-caption">tồn</span> : null}
              </span>
              <Hint content={fmtStamp(c.lastSeenAt)}>
                <span className="hidden w-36 cursor-default text-right text-caption text-muted-fg md:block">{fmtSince(c.lastSeenAt, now)}</span>
              </Hint>
              <span className="ml-auto flex w-32 items-center justify-end gap-3 md:ml-0">
                <span className="text-caption text-muted-fg">{c.paused ? 'Đang dừng' : 'Đang gửi'}</span>
                <Hint content={reason}>
                  <span>
                    <Switch checked={!c.paused} disabled={!!reason} onCheckedChange={() => setPending(c)} label={c.paused ? 'Tiếp tục gửi kèo' : 'Tạm dừng gửi kèo'} />
                  </span>
                </Hint>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <Confirm
        open={!!pending}
        onOpenChange={(v) => !v && setPending(null)}
        tone={pending?.paused ? 'primary' : 'danger'}
        title={pending?.paused ? `Tiếp tục gửi kèo cho ${pending.consumerId}?` : `Tạm dừng ${pending?.consumerId ?? ''}?`}
        description={
          pending?.paused
            ? pending.connected
              ? 'Consumer sẽ nhận lại các kèo còn hiệu lực ngay sau khi tiếp tục.'
              : 'Consumer đang mất kết nối; trạng thái tiếp tục sẽ có hiệu lực khi kết nối lại.'
            : pending?.connected
              ? 'Consumer vẫn kết nối nhưng không nhận kèo mới cho tới khi tiếp tục. Kèo đang chờ ack vẫn được gửi lại.'
              : 'Consumer đang mất kết nối; hub vẫn ghi nhớ trạng thái tạm dừng cho lần kết nối sau.'
        }
        confirmLabel={pending?.paused ? 'Tiếp tục' : 'Tạm dừng'}
        loading={busy}
        onConfirm={async () => {
          if (!pending) return;
          setBusy(true);
          const r = await mutate(`consumers/${encodeURIComponent(pending.consumerId)}/${pending.paused ? 'resume' : 'pause'}`, { method: 'POST' }, pending.paused ? `Đã tiếp tục ${pending.consumerId}` : `Đã tạm dừng ${pending.consumerId}`);
          setBusy(false);
          if (r !== null) {
            setPending(null);
            void reload();
          }
        }}
      />
    </div>
  );
}
