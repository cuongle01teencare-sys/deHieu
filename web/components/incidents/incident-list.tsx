'use client';

import { useState } from 'react';
import { Check, CheckCircle2 } from 'lucide-react';
import type { Incident } from '@/lib/types';
import { cn } from '@/lib/utils';
import { fmtAge, fmtStamp } from '@/lib/format';
import { useNow } from '@/hooks/use-now';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Empty } from '../ui/states';
import { SEVERITY_LABEL, SEVERITY_TONE, StatusDot } from '../ui/status';
import { Hint } from '../ui/tooltip';

/** Sắp theo mức độ rồi thời gian mở (mới trước). */
export const sortIncidents = (list: Incident[]) =>
  [...list].sort((a, b) => (a.severity === b.severity ? b.openedAt - a.openedAt : a.severity === 'critical' ? -1 : 1));

export function useAck(onDone: () => void) {
  const mutate = useMutate();
  const reason = useGuard('admin:incidents');
  const [busy, setBusy] = useState<string | null>(null);
  const ack = async (key: string) => {
    setBusy(key);
    const r = await mutate(`admin/incidents/${encodeURIComponent(key)}/ack`, { method: 'POST' }, 'Đã xác nhận sự cố');
    setBusy(null);
    if (r !== null) onDone();
  };
  return { ack, busy, reason };
}

/** Danh sách sự cố gọn: chấm mức độ, tiêu đề, mô tả, thời gian mở, nút "Xác nhận" dạng ghost. */
export function IncidentList({
  incidents,
  onAcked,
  onOpen,
  highlight,
  emptyText = 'Không có sự cố nào đang mở. Pipeline đang ổn.',
}: {
  incidents: Incident[];
  onAcked: () => void;
  onOpen?: (i: Incident) => void;
  highlight?: string | null;
  emptyText?: string;
}) {
  const now = useNow(1_000);
  const { ack, busy, reason } = useAck(onAcked);
  if (!incidents.length) return <Empty icon={CheckCircle2} className="py-8">{emptyText}</Empty>;
  return (
    <ul>
      {sortIncidents(incidents).map((i) => {
        const tone = SEVERITY_TONE[i.severity];
        return (
          <li
            key={i.key}
            className={cn(
              'group flex min-h-14 items-center gap-4 border-b border-line py-3 last:border-0',
              onOpen && 'cursor-pointer',
              highlight === i.key && '-mx-3 rounded-[6px] bg-accent-soft px-3',
            )}
            onClick={() => onOpen?.(i)}
          >
            <StatusDot tone={tone} pulse={!i.acknowledgedAt && i.severity === 'critical'} label={SEVERITY_LABEL[i.severity]} className="mt-0.5 self-start md:mt-0 md:self-center" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3">
                <span className={cn('min-w-0 truncate text-body font-medium', i.severity === 'critical' ? 'text-fg' : 'text-fg/90')}>{i.title}</span>
                <span className="num hidden shrink-0 text-micro text-faint md:inline">{i.kind}</span>
              </div>
              <p className="mt-0.5 truncate text-caption text-muted-fg">{i.message}</p>
            </div>
            <Hint content={`Mở lúc ${fmtStamp(i.openedAt)}`}>
              <span className="num hidden w-14 shrink-0 cursor-default text-right text-caption text-muted-fg sm:inline">{fmtAge(now - i.openedAt)}</span>
            </Hint>
            <div className="shrink-0 text-right md:w-[104px]" onClick={(e) => e.stopPropagation()}>
              {i.acknowledgedAt ? (
                <Hint content={`Đã xác nhận bởi ${i.acknowledgedBy ?? '—'} · ${fmtStamp(i.acknowledgedAt)}`}>
                  <span className="inline-flex h-8 cursor-default items-center gap-1.5 text-caption text-faint">
                    <Check className="size-3.5" /> {i.acknowledgedBy}
                  </span>
                </Hint>
              ) : (
                <Button variant="ghost" size="sm" className="h-8 md:h-7" loading={busy === i.key} disabledReason={reason} onClick={() => void ack(i.key)}>
                  Xác nhận
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
