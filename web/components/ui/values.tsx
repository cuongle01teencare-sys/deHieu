'use client';

import type { ReactNode } from 'react';
import { Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtAge, fmtMargin, fmtOdds, fmtStamp } from '@/lib/format';
import { useFlash } from '@/hooks/use-flash';
import { useNow } from '@/hooks/use-now';
import { Hint } from './tooltip';
import { StatusDot } from './status';

/** Nền sáng nhẹ rồi tắt dần khi `value` đổi (không nháy gắt). */
export function Flash({
  value,
  children,
  className,
  as: As = 'span',
}: {
  value: unknown;
  children: ReactNode;
  className?: string;
  as?: 'span' | 'div' | 'td';
}) {
  const k = useFlash(value);
  return (
    <As key={k} className={cn(k > 0 && 'animate-flash', 'rounded-[4px]', className)}>
      {children}
    </As>
  );
}

/** Margin: `+2.35%`; dương ≥ ngưỡng = xanh, dương dưới ngưỡng = chữ thường, âm = đỏ nhạt. */
export function Margin({
  value,
  min,
  className,
  size = 'md',
}: {
  value: number | null | undefined;
  min?: number;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const tone =
    value == null
      ? 'text-faint'
      : min !== undefined && value >= min
        ? 'text-ok'
        : value < 0
          ? 'text-critical/70'
          : 'text-fg';
  const sz = { sm: 'text-caption', md: 'text-body', lg: 'text-[15px] font-semibold', xl: 'text-[22px] font-semibold tracking-tight' }[size];
  return <span className={cn('num whitespace-nowrap', sz, tone, className)}>{fmtMargin(value)}</span>;
}

/** Tuổi dữ liệu `3s`, `2m`; quá hạn → mờ + biểu tượng đồng hồ. */
export function Age({
  ms,
  staleAfter,
  className,
  suffix,
}: {
  ms: number | null | undefined;
  staleAfter?: number;
  className?: string;
  suffix?: string;
}) {
  const stale = ms != null && staleAfter !== undefined && ms > staleAfter;
  return (
    <span
      className={cn('num inline-flex items-center gap-1 whitespace-nowrap text-caption', stale ? 'text-warn/80' : 'text-muted-fg', className)}
      title={stale ? 'Dữ liệu cũ hơn chu kỳ cập nhật dự kiến' : undefined}
    >
      {stale ? <Clock3 className="size-3 stroke-[1.5]" aria-label="Dữ liệu cũ" /> : null}
      {fmtAge(ms)}
      {suffix}
    </span>
  );
}

/** Tuổi tính từ mốc thời gian, tự nhảy mỗi giây. */
export function AgeSince({ at, staleAfter, className }: { at: number | null | undefined; staleAfter?: number; className?: string }) {
  const now = useNow(1_000);
  if (!at) return <span className={cn('text-caption text-faint', className)}>—</span>;
  return (
    <Hint content={fmtStamp(at)}>
      <span className="cursor-default">
        <Age ms={now - at} staleAfter={staleAfter} className={className} />
      </span>
    </Hint>
  );
}

/** "cập nhật 3s trước" — gắn ở mọi vùng dữ liệu sống. */
export function LiveStamp({
  at,
  staleAfter = 15_000,
  className,
}: {
  at: number | null | undefined;
  staleAfter?: number;
  className?: string;
}) {
  const now = useNow(1_000);
  if (!at) return <span className={cn('text-caption text-faint', className)}>đang tải…</span>;
  const age = now - at;
  const stale = age > staleAfter;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-caption', stale ? 'text-warn/80' : 'text-faint', className)}>
      {stale ? <Clock3 className="size-3 stroke-[1.5]" /> : <StatusDot tone="ok" pulse className="size-[5px]" />}
      cập nhật {fmtAge(age)} trước
    </span>
  );
}

export type OddsStatus = 'open' | 'suspended';

/**
 * Ô odds hai phía (mono, căn phải): chấm trạng thái + tuổi.
 * Trạng thái: open · suspended (gạch mờ) · stale (mờ + đồng hồ) · empty (gạch ngang) · changing (flash).
 * Odds tốt nhất mỗi phía được nhấn bằng độ đậm + gạch chân mảnh — không đóng khung.
 */
export function OddsCell({
  odds,
  status,
  ageMs,
  staleAfter = 30_000,
  best = [false, false],
  layout = 'row',
  className,
}: {
  odds: [number, number] | null | undefined;
  status?: OddsStatus;
  ageMs?: number;
  staleAfter?: number;
  best?: [boolean, boolean];
  layout?: 'row' | 'mobile';
  className?: string;
}) {
  if (!odds) return <span className={cn('num text-faint', className)}>—</span>;
  const suspended = status === 'suspended';
  const stale = ageMs !== undefined && ageMs > staleAfter;
  const one = (v: number, isBest: boolean, i: number) => (
    <Flash key={i} value={v} className={cn('px-1 -mx-1 inline-block min-w-[3.25ch] text-right')}>
      <span
        className={cn(
          'num text-[13px]',
          isBest && !suspended ? 'font-semibold text-fg underline decoration-accent/60 decoration-1 underline-offset-[5px]' : 'text-fg/90',
          suspended && 'text-faint line-through decoration-faint/60',
        )}
      >
        {fmtOdds(v)}
      </span>
    </Flash>
  );
  return (
    <span
      className={cn(
        'inline-flex items-center gap-3 whitespace-nowrap',
        stale && !suspended && 'opacity-55',
        layout === 'mobile' && 'gap-5',
        className,
      )}
    >
      <span className="inline-flex items-center gap-3">
        {one(odds[0], best[0], 0)}
        {one(odds[1], best[1], 1)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <StatusDot tone={suspended ? 'warn' : 'ok'} label={suspended ? 'Tạm khóa' : 'Đang mở'} />
        {ageMs !== undefined ? <Age ms={ageMs} staleAfter={staleAfter} className="w-9 text-micro" /> : null}
      </span>
    </span>
  );
}

/** Số lớn tabular có flash khi đổi. */
export function Num({ value, format = (v) => String(v), className }: { value: number | null | undefined; format?: (v: number) => string; className?: string }) {
  return (
    <Flash value={value} className={cn('num', className)}>
      {value == null ? '—' : format(value)}
    </Flash>
  );
}
