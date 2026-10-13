import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Bảng không viền: không khung ngoài, không sọc; chỉ hairline dưới header và giữa các hàng.
 * Header dính; hàng cao 44px (desktop); hover = nền rất nhạt.
 */
export function Table({ className, ...p }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 lg:overflow-visible">
      <table className={cn('w-full border-separate border-spacing-0 text-body', className)} {...p} />
    </div>
  );
}

export function THead({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('lg:[&_th]:sticky lg:[&_th]:top-14 [&_th]:z-[2] [&_th]:bg-bg', className)} {...p} />;
}

export function TH({ className, numeric, ...p }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        'h-9 whitespace-nowrap border-b border-line px-3 text-left align-bottom pb-2 text-caption font-normal text-muted-fg first:pl-0 last:pr-0',
        numeric && 'text-right',
        className,
      )}
      {...p}
    />
  );
}

export function TR({
  className,
  interactive,
  highlight,
  ...p
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; highlight?: boolean }) {
  return (
    <tr
      className={cn(
        'group/row transition-colors duration-150 [&>td]:border-b [&>td]:border-line last:[&>td]:border-b-0',
        interactive && 'cursor-pointer hover:bg-hover/60 focus-visible:bg-hover/60 focus-visible:outline-none',
        highlight && 'bg-accent-soft hover:bg-accent-soft',
        className,
      )}
      {...p}
    />
  );
}

export function TD({ className, numeric, ...p }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn('h-11 whitespace-nowrap px-3 align-middle first:pl-0 last:pr-0', numeric && 'num text-right tabular', className)}
      {...p}
    />
  );
}

/** Hàng danh sách mobile (thay cho bảng rộng): hairline giữa các hàng, cao ≥ 56px. */
export function ListRow({
  className,
  interactive,
  highlight,
  ...p
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'min-h-14 border-b border-line py-3 last:border-b-0',
        interactive && 'cursor-pointer active:bg-hover/60',
        highlight && '-mx-4 bg-accent-soft px-4',
        className,
      )}
      {...p}
    />
  );
}
