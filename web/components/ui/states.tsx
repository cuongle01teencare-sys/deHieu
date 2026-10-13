'use client';

import type { LucideIcon } from 'lucide-react';
import { AlertCircle, Lock, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/** Trạng thái rỗng: một biểu tượng, một dòng, một hành động. */
export function Empty({
  icon: Icon,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-14 text-center', className)}>
      <Icon className="size-5 stroke-[1.5] text-faint" aria-hidden />
      <p className="max-w-sm text-body text-muted-fg">{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 border-y border-line py-4 text-body', className)} role="alert">
      <AlertCircle className="size-4 shrink-0 stroke-[1.5] text-critical" />
      <span className="min-w-0 flex-1 text-muted-fg">
        Không tải được dữ liệu. <span className="num text-caption text-faint">{message}</span>
      </span>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <RotateCw /> Thử lại
        </Button>
      ) : null}
    </div>
  );
}

export function PermissionDenied({ permission }: { permission: string }) {
  return (
    <Empty icon={Lock}>
      Bạn chưa có quyền xem mục này. Cần quyền <span className="num text-fg">{permission}</span>.
    </Empty>
  );
}

/** Khung xương dạng dòng khớp bố cục thật (không phải khối xám). */
export function SkeletonRows({
  rows = 6,
  cols = [40, 18, 14, 12, 10],
  className,
}: {
  rows?: number;
  cols?: number[];
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)} aria-busy aria-label="Đang tải">
      <div className="flex gap-6 border-b border-line pb-3">
        {cols.map((w, i) => (
          <div key={i} className="skeleton h-2.5 opacity-60" style={{ width: `${w * 0.6}%` }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-11 items-center gap-6 border-b border-line last:border-0">
          {cols.map((w, i) => (
            <div key={i} className="skeleton h-3" style={{ width: `${w * (0.7 + ((r * 7 + i * 3) % 5) / 15)}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2.5', className)} aria-busy>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton h-3" style={{ width: `${90 - i * 17}%` }} />
      ))}
    </div>
  );
}

/** Chỉ báo nhỏ khi tải lại nền (không thay nội dung). */
export function Loading({ className }: { className?: string }) {
  return <span className={cn('inline-block size-3 animate-spin rounded-full border border-line-strong border-t-accent', className)} aria-label="Đang tải" />;
}
