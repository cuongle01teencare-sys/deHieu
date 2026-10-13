import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { TaskState } from '@/lib/types';

export type Tone = 'ok' | 'warn' | 'critical' | 'info' | 'muted' | 'accent';

const DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  critical: 'bg-critical',
  info: 'bg-info',
  muted: 'bg-muted',
  accent: 'bg-accent',
};
const TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  critical: 'text-critical',
  info: 'text-info',
  muted: 'text-muted-fg',
  accent: 'text-accent-text',
};
const SOFT: Record<Tone, string> = {
  ok: 'bg-ok-soft',
  warn: 'bg-warn-soft',
  critical: 'bg-critical-soft',
  info: 'bg-info-soft',
  muted: 'bg-hover',
  accent: 'bg-accent-soft',
};
export const toneText = (t: Tone) => TEXT[t];
export const toneBg = (t: Tone) => DOT[t];
export const toneSoft = (t: Tone) => SOFT[t];

/** Chấm trạng thái 6px. `pulse` cho giá trị đang sống (stream). */
export function StatusDot({
  tone = 'ok',
  pulse,
  className,
  label,
}: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
  /** Nhãn cho trình đọc màn hình — màu không bao giờ là tín hiệu duy nhất. */
  label?: string;
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('relative inline-block size-1.5 shrink-0 rounded-full', DOT[tone], className)}
    >
      {pulse ? (
        <span className={cn('absolute inset-0 rounded-full opacity-60 animate-ping [animation-duration:2.4s]', DOT[tone])} />
      ) : null}
    </span>
  );
}

/** Pill nhỏ: chấm + chữ, nền rất nhạt. Không dùng khối màu đặc. */
export function Pill({
  tone = 'muted',
  children,
  dot = true,
  className,
  mono,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-micro font-medium',
        SOFT[tone],
        TEXT[tone],
        mono && 'num tracking-normal',
        className,
      )}
    >
      {dot ? <span className={cn('size-1.5 rounded-full', DOT[tone])} /> : null}
      {children}
    </span>
  );
}

/** Chữ có chấm phía trước — dạng trạng thái nhẹ nhất (trong bảng). */
export function DotLabel({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 whitespace-nowrap', className)}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

export const TASK_STATE_TONE: Record<TaskState, Tone> = {
  CREATED: 'info',
  INITIALIZING: 'info',
  READY: 'info',
  STARTING: 'info',
  RUNNING: 'ok',
  STOPPING: 'muted',
  STOPPED: 'muted',
  RESTARTING: 'warn',
  FAILED: 'critical',
};

export const SEVERITY_TONE = { critical: 'critical', warning: 'warn' } as const satisfies Record<string, Tone>;
export const SEVERITY_LABEL = { critical: 'Nghiêm trọng', warning: 'Cảnh báo' } as const;
