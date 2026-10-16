import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiVenueOrders,
  readEmpireBalance,
  type OrderPlan,
} from '../venue-orders.js';
import { AesGcmSecretCipher } from '../secret-cipher.js';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  cash: vi.fn(),
  signer: vi.fn(),
}));
vi.mock('@polymarket/client', async (original) => ({
  ...(await original<object>()),
  createSecureClient: mocks.create,
}));
vi.mock('@polymarket/client/actions', () => ({
  fetchBalanceAllowance: mocks.cash,
}));
vi.mock('@polymarket/client/viem', () => ({ privateKey: mocks.signer }));
const plan: OrderPlan = {
  id: 'request-123',
  bookRef: { e: 'event', m: 'market', s: 'mapnr=1', o0: 'outcome' },
  bookSide: 0,
  bookOdds: 2,
  stake: 10,
  tokenId: 'token',
  shares: 20,
  polyLimit: 0.4,
  polyFee: 0.5,
  expiresAt: Date.now() + 60_000,
};
const session = {
  browserProfile: 'e',
  token: 'test-jwt',
  expiresAt: Date.now() + 1_800_000,
  apiUrl: 'https://api-h-c7818b61-608.sptpub.com',
  brandId: '2432911154364948480',
  sessionId: 'session',
  minBet: 0.1,
  cookie: 'test-cookie',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('direct venue APIs', () => {
  it('reports which csgoempire account the session cookie belongs to', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          Response.json(
            url.endsWith('/api/v2/user')
              ? {
                  success: true,
                  default_balance_type: 1,
                  balance: 10000,
                  id: 4242,
                  steam_name: 'Trader One',
                  username: 'trader1',
                  email: 'one@example.test',
                }
              : { rates: { USD: 1, CSGOEMPIRE_COIN: 2 } },
          ),
        ),
      ),
    );
    expect(
      await readEmpireBalance(session, new AbortController().signal),
    ).toEqual({
      cash: 50,
      account: { id: '4242', name: 'Trader One', wallet: null },
      username: 'trader1',
      email: 'one@example.test',
    });
  });

  it('reads current csgoempire cash, converts coins to USD, and prepares the HAR coupon without placing it', async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v2/user'))
        return Promise.resolve(
          Response.json({
            success: true,
            default_balance_type: 1,
            balance: 10000,
            portfolio: 999999,
          }),
        );
      if (url.endsWith('/exchange-rates'))
        return Promise.resolve(
          Response.json({ rates: { USD: 1, CSGOEMPIRE_COIN: 2 } }),
        );
      if (url.endsWith('/coupon/max'))
        return Promise.resolve(Response.json({ max_bet: '30' }));
      if (url.endsWith('/bet/place')) {
        const body: unknown = JSON.parse(
          typeof init?.body === 'string' ? init.body : 'null',
        );
        expect(body).toMatchObject([
          {
            type: '1/1',
            sum: '10.00',
            odds_change: 'higher',
            bet_request_id: 'request-123',
            selections: [
              {
                event_id: 'event',
                market_id: 'market',
                specifiers: 'mapnr=1',
                outcome_id: 'outcome',
              },
            ],
          },
        ]);
        return Promise.resolve(
          Response.json({
            accepted: [{ bet_request_id: 'request-123', bet_id: 'ticket-1' }],
            error: [],
          }),
        );
      }
      throw new Error('Unexpected API');
    });
    vi.stubGlobal('fetch', fetcher);
    const order = await new ApiVenueOrders().empire(
      session,
      plan,
      new AbortController().signal,
    );
    expect(order).toMatchObject({ cash: 50, requiredCash: 10 });
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/bet/place'))).toBe(
      false,
    );
    expect(await order.submit()).toMatchObject({
      status: 'filled',
      orderRef: 'ticket-1',
      cost: 10,
    });
  });
  it('zero csgoempire cash is returned even if max_bet is zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          Response.json(
            url.endsWith('/api/v2/user')
              ? { success: true, default_balance_type: 1, balance: 0 }
              : url.endsWith('/exchange-rates')
                ? { rates: { USD: 1, CSGOEMPIRE_COIN: 2 } }
                : { max_bet: '0' },
          ),
        ),
      ),
    );
    expect(
      await new ApiVenueOrders().empire(
        session,
        plan,
        new AbortController().signal,
      ),
    ).toMatchObject({ cash: 0 });
  });
  it('Polymarket reads collateral cash of the funder, ignores portfolio, and uses FOK', async () => {
    vi.stubEnv('TRADING_SECRET_KEY', 'unit-test-key-not-a-real-wallet-key');
    const signed = { takerAmount: '20000000', makerAmount: '8000000' };
    const client = {
      account: { signer: '0xsigner' },
      portfolio: 999999,
      createLimitOrder: vi.fn(() => Promise.resolve(signed)),
      postOrder: vi.fn(() =>
        Promise.resolve({
          ok: true,
          orderId: 'poly-order',
          status: 'matched',
          takingAmount: '20',
          makingAmount: '8',
          tradeIds: ['fill-1'],
        }),
      ),
      waitForOrderFillSettlement: vi.fn(() => Promise.resolve([])),
    };
    mocks.create.mockResolvedValue(client);
    mocks.cash.mockResolvedValue({
      balance: '1000000',
      allowances: { exchange: 1000000000n },
    });
    const c = {
      walletAddress: '0xsigner',
      funderAddress: '0xfunder',
      secretCipher: new AesGcmSecretCipher(
        process.env.TRADING_SECRET_KEY,
      ).encrypt('test-private-key'),
    };
    const order = await new ApiVenueOrders().polymarket(
      c,
      plan,
      new AbortController().signal,
    );
    expect(order).toMatchObject({ cash: 1, requiredCash: 8.5 });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ wallet: '0xfunder' }),
    );
    expect(mocks.cash).toHaveBeenCalledWith(client, {
      assetType: 'COLLATERAL',
    });
    expect(client.postOrder).not.toHaveBeenCalled();
    await expect(order.submit()).rejects.toThrow('INSUFFICIENT_CASH');
    expect(client.postOrder).not.toHaveBeenCalled();
    mocks.cash.mockResolvedValue({
      balance: '100000000',
      allowances: { exchange: 1000000000n },
    });
    const fundedOrder = await new ApiVenueOrders().polymarket(
      c,
      plan,
      new AbortController().signal,
    );
    expect(await fundedOrder.submit()).toMatchObject({
      status: 'filled',
      orderRef: 'poly-order',
      filledAmount: 20,
      cost: 8.5,
    });
    expect(client.postOrder).toHaveBeenCalledWith({
      ...signed,
      orderType: 'FOK',
    });
    expect(client.waitForOrderFillSettlement).toHaveBeenCalledOnce();
  });
});
