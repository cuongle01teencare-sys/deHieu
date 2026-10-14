import {
  forkEnvironmentConfig,
  production,
  type EnvironmentConfig,
} from '@polymarket/client';

export interface PolymarketEndpoints {
  readonly gammaRest?: string; // vd https://gamma-api.polymarket.com
  readonly clobRest?: string;
  readonly clobMarketWs?: string; // vd wss://ws-subscriptions-clob.polymarket.com/ws/market
}

/** Mặc định production; chỉ ghi đè endpoint nào được truyền vào. */
export const polymarketEnvironment = (
  e?: PolymarketEndpoints,
): EnvironmentConfig =>
  !e
    ? production
    : forkEnvironmentConfig({
        name: 'custom',
        ...(e.gammaRest ? { gamma: { rest: e.gammaRest } } : {}),
        ...(e.clobRest || e.clobMarketWs
          ? {
              clob: {
                ...(e.clobRest ? { rest: e.clobRest } : {}),
                ...(e.clobMarketWs ? { market: { ws: e.clobMarketWs } } : {}),
              },
            }
          : {}),
      });

/**
 * URL REST cho client tự gọi (sổ lệnh, thông số market): endpoint truyền vào, mặc định theo cấu hình
 * production của SDK (kiểu công khai của SDK không lộ url nên đọc qua dạng lỏng).
 */
export const polymarketRestUrls = (
  e?: PolymarketEndpoints,
): { readonly clobRest: string; readonly gammaRest: string } => {
  const prod = production as unknown as {
    clob?: { rest?: string };
    gamma?: { rest?: string };
  };
  const clobRest = e?.clobRest ?? prod.clob?.rest;
  const gammaRest = e?.gammaRest ?? prod.gamma?.rest;
  if (!clobRest || !gammaRest)
    throw new Error('không xác định được URL REST của polymarket (clob/gamma)');
  return { clobRest, gammaRest };
};
