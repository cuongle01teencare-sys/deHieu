import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Đầu trang: tiêu đề 24px, mô tả mờ, hành động bên phải. Không hộp. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Dòng nhỏ phía trên tiêu đề (vd "cập nhật 2s trước"). */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-8 flex flex-col gap-4 md:mb-10 md:flex-row md:items-end md:justify-between', className)}>
      <div className="min-w-0">
        {meta ? <div className="mb-2 flex flex-wrap items-center gap-3">{meta}</div> : null}
        <h1 className="hidden text-title font-semibold text-fg md:block">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-body text-muted-fg md:mt-1.5">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Một mục trên trang: tiêu đề 15 semibold + phụ đề, nội dung trực tiếp trên nền trang. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('mb-10 md:mb-12', className)}>
      {title || actions ? (
        <div className="mb-3 flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title ? <h2 className="text-section font-semibold text-fg">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-caption text-muted-fg">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Tiêu đề phụ chữ hoa nhỏ, mờ (nhóm hàng trong ma trận). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-micro font-medium uppercase tracking-[0.08em] text-faint', className)}>{children}</div>
  );
}

export function Hairline({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div aria-hidden className={cn(vertical ? 'w-px self-stretch bg-line' : 'h-px w-full bg-line', className)} />;
}

/** Cặp nhãn – giá trị dạng danh sách định nghĩa (drawer). */
export function KV({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2 text-body', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-fg">{k}</dt>
          <dd className="min-w-0 break-words text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
