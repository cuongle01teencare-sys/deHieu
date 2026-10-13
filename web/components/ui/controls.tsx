'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Switch as RSwitch } from 'radix-ui';
import { cn } from '@/lib/utils';

const field =
  'h-8 w-full rounded-[6px] bg-transparent px-2.5 text-body text-fg shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none transition-shadow placeholder:text-faint focus:shadow-[inset_0_0_0_1px_var(--accent)] disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...p },
  ref,
) {
  return <input ref={ref} className={cn(field, className)} {...p} />;
});

/** Ô tìm kiếm có biểu tượng + nút xóa. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Tìm…',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 stroke-[1.5] text-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(field, 'pl-8 pr-7')}
        type="search"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Xóa"
          className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-faint hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Select gốc của trình duyệt (tốt trên mobile), kiểu dáng gọn. */
export function Select({
  className,
  children,
  ...p
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(field, 'appearance-none pr-7')} {...p}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 stroke-[1.5] text-faint" />
    </div>
  );
}

/** Control phân đoạn (chọn 1). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[7px] bg-hover/70 p-0.5 scrollbar-none', className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] font-medium transition-colors duration-150',
              size === 'sm' ? 'h-6 px-2 text-caption' : 'h-7 px-3 text-body',
              on ? 'bg-raised text-fg shadow-raised' : 'text-muted-fg hover:text-fg',
            )}
          >
            {o.label}
            {o.count !== undefined ? <span className="num text-micro text-faint">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
}) {
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-line-strong transition-colors duration-150 data-[state=checked]:bg-accent disabled:opacity-45"
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
}

/** Nhóm trường form: nhãn, điều khiển, chữ hướng dẫn bên dưới. */
export function Field({
  label,
  help,
  error,
  children,
  htmlFor,
  className,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={htmlFor} className="text-body font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? <p className="text-caption text-critical">{error}</p> : help ? <p className="text-caption text-muted-fg">{help}</p> : null}
    </div>
  );
}

/** Chip lọc dính (mobile) — mở sheet lọc. */
export function FilterChip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-caption transition-colors',
        active ? 'bg-accent-soft text-accent-text' : 'text-muted-fg shadow-[inset_0_0_0_1px_var(--line-strong)]',
      )}
    >
      {children}
    </button>
  );
}
