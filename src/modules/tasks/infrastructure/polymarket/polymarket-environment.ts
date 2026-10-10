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
