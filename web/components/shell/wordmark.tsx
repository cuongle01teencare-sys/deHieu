import { cn } from '@/lib/utils';

/** Biểu tượng Arb Ops: hai đường odds giao nhau trên nền nhấn. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-6 shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M8 21.5 L13 14 L17 18 L24 9.5" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11 L14 17.5" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ compact, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {!compact ? <span className="text-[14px] font-semibold tracking-tight text-fg">Arb Ops</span> : null}
    </span>
  );
}
