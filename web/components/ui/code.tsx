'use client';

import { useState } from 'react';
import { Check, ChevronRight, Copy } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import { cn } from '@/lib/utils';

export function CopyButton({ text, label = 'Sao chép', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* trình duyệt chặn clipboard */
        }
      }}
      className={cn('inline-flex items-center gap-1 text-caption text-muted-fg transition-colors hover:text-fg', className)}
      aria-label={label}
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5 stroke-[1.5]" />}
      {done ? 'Đã chép' : label}
    </button>
  );
}

/** Chuỗi mono có nút chép (ID, chuỗi gốc). */
export function Mono({ children, copy, className }: { children: string; copy?: boolean; className?: string }) {
  return (
    <span className={cn('group/mono inline-flex min-w-0 items-center gap-2', className)}>
      <span className="num min-w-0 break-all text-caption text-fg/90">{children}</span>
      {copy ? <CopyButton text={children} label="" className="opacity-60 group-hover/mono:opacity-100" /> : null}
    </span>
  );
}

/** JSON gốc: thu gọn mặc định, mở ra để xem, chép được. */
export function JsonBlock({ value, title = 'JSON gốc', defaultOpen = false }: { value: unknown; title?: string; defaultOpen?: boolean }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between">
        <Collapsible.Trigger className="inline-flex items-center gap-1 text-caption text-muted-fg hover:text-fg">
          <ChevronRight className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')} />
          {title}
        </Collapsible.Trigger>
        {open ? <CopyButton text={text} /> : null}
      </div>
      <Collapsible.Content>
        <pre className="num mt-2 max-h-80 overflow-auto rounded-[6px] bg-bg/70 p-3 text-[11.5px] leading-[1.6] text-fg/80 shadow-[inset_0_0_0_1px_var(--line)]">
          {text}
        </pre>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
