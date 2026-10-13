'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Flash } from './values';
import { toneBg, toneText, type Tone } from './status';

/**
 * Dải chỉ số nằm ngang: số lớn tabular, nhãn nhỏ bên dưới, vạch dọc mảnh giữa các chỉ số.
 * Mobile: lưới 2 cột số trơn (không hộp).
 */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 md:gap-y-7 xl:flex xl:items-stretch xl:gap-0',
        'xl:[&>*]:border-l xl:[&>*]:border-line xl:[&>*]:px-6 xl:[&>*:first-child]:border-l-0 xl:[&>*:first-child]:pl-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  spark,
  className,
  size = 'md',
}: {
  label: ReactNode;
  value: ReactNode;
  /** Dòng phụ sau số (vd "/ 1 284 ghép"). */
  sub?: ReactNode;
  tone?: Tone;
  spark?: number[];
  className?: string;
  size?: 'md' | 'lg';
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-end gap-3">
        <Flash
          value={typeof value === 'string' || typeof value === 'number' ? value : undefined}
          className={cn(
            'num -mx-1 px-1 leading-none tracking-tight',
            size === 'lg' ? 'text-[30px] font-medium' : 'text-[24px] font-medium',
            tone ? toneText(tone) : 'text-fg',
          )}
        >
          {value}
        </Flash>
        {sub ? <span className="num pb-0.5 text-caption text-muted-fg">{sub}</span> : null}
        {spark && spark.length > 1 ? <Sparkline values={spark} className="mb-0.5 hidden h-5 w-14 lg:block" /> : null}
      </div>
      <div className="mt-2 truncate text-caption text-muted-fg">{label}</div>
    </div>
  );
}

/** Sparkline siêu nhỏ, không trục, không khung. */
export function Sparkline({
  values,
  className,
  color = 'var(--accent)',
}: {
  values: number[];
  className?: string;
  color?: string;
}) {
  if (values.length < 2) return <svg className={className} aria-hidden />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${22 - ((v - min) / span) * 18}`).join(' ');
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Thước mảnh 0–1 (điểm ghép, tỉ lệ). */
export function Meter({ value, tone = 'accent', className, label }: { value: number; tone?: Tone; className?: string; label?: string }) {
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value}
      aria-label={label}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-200', toneBg(tone))} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

/** Thanh phân đoạn mảnh với số đếm ghi trực tiếp bên dưới. */
export function SegmentBar({
  segments,
  className,
  onSelect,
}: {
  segments: { key: string; label: string; value: number; tone: Tone }[];
  className?: string;
  onSelect?: (key: string) => void;
}) {
  const total = segments.reduce((n, s) => n + s.value, 0) || 1;
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div className={className}>
      <div className="flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full">
        {shown.map((s) => (
          <div key={s.key} className={cn('h-full first:rounded-l-full last:rounded-r-full', toneBg(s.tone))} style={{ width: `${(s.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {shown.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect?.(s.key)}
            className={cn('inline-flex items-center gap-1.5 text-caption text-muted-fg', onSelect && 'hover:text-fg')}
          >
            <span className={cn('size-1.5 rounded-full', toneBg(s.tone))} />
            <span className="num text-fg">{s.value}</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
