import { ExternalLink } from 'lucide-react';
import type { MatchMarketRow } from '@/lib/types';
import { matchSources, tenantHref } from '@/lib/match-links';
import { Tenant } from '../ui/tenant';

export function TenantSourceLink({
  tenant,
  reference,
}: {
  tenant: string;
  reference: Record<string, string>;
}) {
  const href = tenantHref(reference);
  return href ? <SourceLink tenant={tenant} href={href} /> : null;
}

export function TenantSourceLinks({
  markets,
  tenants,
}: {
  markets: MatchMarketRow[];
  tenants: string[];
}) {
  const sources = matchSources(markets);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-caption">
      {sources.map(({ tenant, href }) => (
        <SourceLink key={`${tenant}:${href}`} tenant={tenant} href={href} />
      ))}
      {tenants
        .filter((tenant) => !sources.some((source) => source.tenant === tenant))
        .map((tenant) => (
          <span
            key={tenant}
            className="inline-flex min-w-0 flex-wrap items-center gap-2 text-faint"
          >
            <Tenant tenant={tenant} muted /> Chưa có URL nguồn
          </span>
        ))}
    </div>
  );
}

function SourceLink({ tenant, href }: { tenant: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-8 min-w-0 items-center gap-2 text-accent-text hover:underline focus-visible:outline-accent"
      aria-label={`Mở trận tại ${tenant} (tab mới)`}
      title={href}
    >
      <Tenant tenant={tenant} />
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}
