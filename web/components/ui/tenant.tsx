import { cn } from '@/lib/utils';
import { tenantVar } from '@/lib/tenants';

/** Chấm màu tenant (luôn đi kèm tên — không dựa vào màu). */
export function TenantDot({ tenant, className }: { tenant: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ background: tenantVar(tenant) }}
    />
  );
}

/** Chấm + tên tenant (mono). */
export function Tenant({
  tenant,
  className,
  count,
  muted,
}: {
  tenant: string;
  className?: string;
  /** Số đi sau tên, vd số market phủ. */
  count?: number;
  muted?: boolean;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap', className)}>
      <TenantDot tenant={tenant} />
      <span className={cn('num truncate text-caption', muted ? 'text-muted-fg' : 'text-fg')}>{tenant}</span>
      {count !== undefined ? <span className="num text-caption text-muted-fg">{count}</span> : null}
    </span>
  );
}

/** Độ phủ: `● sptpub 13  ● polymarket 6` — chữ yên lặng. */
export function Coverage({ coverage, className }: { coverage: Record<string, number>; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {Object.entries(coverage).map(([t, n]) => (
        <Tenant key={t} tenant={t} count={n} muted />
      ))}
    </span>
  );
}

/** Chỉ các chấm chồng nhẹ (danh sách hẹp). */
export function TenantDots({ tenants, className }: { tenants: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} aria-label={tenants.join(', ')}>
      {tenants.map((t) => (
        <TenantDot key={t} tenant={t} />
      ))}
    </span>
  );
}
