import type { PolymarketResolutionSource } from '../../application/trade-settlement.js';

const list = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * Giá resolve của các token từ một market gamma. Chỉ trả khi market đã đóng VÀ đã resolve xong
 * (UMA 'resolved', hoặc giá đã chốt đúng 0/1). Market đóng nhưng còn tranh chấp → bỏ qua.
 */
export function resolvedPrices(
  m: Record<string, unknown>,
): Map<string, number> {
  const out = new Map<string, number>();
  if (m.closed !== true) return out;
  const tokens = list(m.clobTokenIds).map(String);
  const prices = list(m.outcomePrices).map(Number);
  if (!tokens.length || tokens.length !== prices.length) return out;
  if (prices.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) return out;
  const status =
    typeof m.umaResolutionStatus === 'string' ? m.umaResolutionStatus : null;
  const exact = prices.every((p) => p === 0 || p === 1);
  if (status ? status !== 'resolved' : !exact) return out;
  tokens.forEach((t, i) => out.set(t, prices[i]));
  return out;
}

/** Đọc kết quả market từ gamma API công khai (không cần ví). */
export class GammaPolymarketResolutions implements PolymarketResolutionSource {
  constructor(
    private readonly _base = (
      process.env.POLYMARKET_GAMMA_URL ?? 'https://gamma-api.polymarket.com'
    ).replace(/\/+$/, ''),
    private readonly _fetch: typeof fetch = fetch,
    private readonly _chunk = 20,
  ) {}

  async resolve(tokenIds: readonly string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const wanted = new Set(tokenIds);
    for (let i = 0; i < tokenIds.length; i += this._chunk) {
      const chunk = tokenIds.slice(i, i + this._chunk);
      const qs = chunk
        .map((t) => `clob_token_ids=${encodeURIComponent(t)}`)
        .join('&');
      const res = await this._fetch(
        `${this._base}/markets?${qs}&closed=true&limit=${chunk.length * 2}`,
        { signal: AbortSignal.timeout(15_000), redirect: 'error' },
      );
      if (!res.ok) throw new Error(`POLYMARKET_GAMMA_HTTP_${res.status}`);
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) continue;
      for (const m of rows)
        if (m && typeof m === 'object')
          for (const [t, p] of resolvedPrices(m as Record<string, unknown>))
            if (wanted.has(t)) out.set(t, p);
    }
    return out;
  }
}
