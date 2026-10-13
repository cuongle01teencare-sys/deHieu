import { fmtOdds } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Tenant } from './ui/tenant';

/** Hai chân kèo: `tenant · pick @ odds`. */
export function SignalLegs({
  legs,
  className,
  stacked,
}: {
  legs: { tenant: string; pick: string; odds: number }[];
  className?: string;
  /** Xếp dọc (mobile / cột hẹp). */
  stacked?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 gap-x-5 gap-y-1', stacked ? 'flex-col' : 'flex-wrap items-center', className)}>
      {legs.map((l, i) => (
        <span key={i} className="flex min-w-0 items-center gap-2 text-body">
          <Tenant tenant={l.tenant} muted className="shrink-0" />
          <span className="min-w-0 truncate text-fg">{l.pick}</span>
          <span className="num text-faint">@</span>
          <span className="num font-medium text-fg">{fmtOdds(l.odds)}</span>
        </span>
      ))}
    </div>
  );
}
