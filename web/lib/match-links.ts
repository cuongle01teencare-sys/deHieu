import type { MatchMarketRow, Phase } from './types';

export function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function matchHref(match: string, market?: string): string {
  const path = `/tran-dau/${encodeURIComponent(match)}`;
  return market ? `${path}?${new URLSearchParams({ market })}` : path;
}

export function roomHref(room: string): string | null {
  const parts = /^room:([^:]+:[^:]+):([^:]+)$/.exec(room);
  return parts ? matchHref(parts[1]!, parts[2]!) : null;
}

// The match-detail API exposes phases on individual lines, not on the match.
export function matchPhases(markets: MatchMarketRow[]): Phase[] {
  return [
    ...new Set(
      markets.flatMap((row) =>
        Object.values(row.lines).map((line) => line.phase),
      ),
    ),
  ];
}

export function tenantHref(ref: Record<string, string>): string | null {
  if (!ref.url) return null;
  try {
    const url = new URL(ref.url);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function matchSources(
  markets: MatchMarketRow[],
): { tenant: string; href: string }[] {
  const sources = new Map<string, { tenant: string; href: string }>();
  for (const row of markets) {
    for (const [tenant, line] of Object.entries(row.lines)) {
      const href = tenantHref(line.ref);
      if (href) sources.set(`${tenant}\0${href}`, { tenant, href });
    }
  }
  return [...sources.values()];
}
