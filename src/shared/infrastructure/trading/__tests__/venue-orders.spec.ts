import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiVenueOrders,
  readPolymarketBalance,
  hedgeBet,
  empireCoins,
  empireBalanceFrom,
  type OrderPlan,
} from '../venue-orders.js';
import { AesGcmSecretCipher } from '../secret-cipher.js';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  cash: vi.fn(),
  refresh: vi.fn(),
  portfolio: vi.fn(),
  signer: vi.fn(),
}));
vi.mock('@polymarket/client', async (original) => ({
  ...(await original<object>()),
  createSecureClient: mocks.create,
}));
vi.mock('@polymarket/client/actions', () => ({
  fetchBalanceAllowance: mocks.cash,
  updateBalanceAllowance: mocks.refresh,
  fetchPortfolioValue: mocks.portfolio,
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
  /** Kho số dư giả (Redis): `snapshot` là lần Chrome nền đọc gần nhất. */
  const store = (
    snapshot: { cash: number; at?: number } | null,
    extra: { spent?: number; lastError?: { error: string; at: number } } = {},
  ) => ({
    readEmpireBalance: vi.fn((_resource: string) =>
      Promise.resolve({
        snapshot: snapshot
          ? {
              cash: snapshot.cash,
              coins: snapshot.cash * 2,
              at: snapshot.at ?? Date.now(),
              account: { id: '4242', name: 'Trader One' },
            }
          : null,
        lastError: extra.lastError ?? null,
        spent: extra.spent ?? 0,
      }),
    ),
    spendEmpire: vi.fn((_r: string, _amount: number) => Promise.resolve()),
  });

  it('đặt bù: cả hai cửa không lỗ sau làm tròn; ví dụ 20 share / 8.5$ → odds 1.74, cược 11.49$', () => {
    expect(hedgeBet(20, 8.5, 2)).toEqual({ odds: 1.74, stake: 11.49 });
    expect(hedgeBet(20, 12, 2)).toBeNull();
    expect(hedgeBet(5, 6, 3)).toBeNull();
    // bất biến trên nhiều bộ số
    for (let shares = 3; shares <= 400; shares += 7.3)
      for (const ratio of [0.3, 0.45, 0.6, 0.75, 0.9])
        for (const planned of [1.5, 2, 3.2, 6]) {
          const cost = Math.round(shares * ratio * 100) / 100;
          const h = hedgeBet(shares, cost, planned);
          if (!h) continue;
          expect(h.odds).toBeLessThan(planned);
          expect(h.stake * h.odds).toBeGreaterThanOrEqual(
            h.stake + cost - 1e-9,
          );
          expect(shares).toBeGreaterThanOrEqual(h.stake + cost - 1e-9);
        }
  });

  it('tính số dư từ metadata + tỷ giá mà Chrome đọc được', () => {
    expect(
      empireBalanceFrom(
        {
          user: {
            default_balance_type: 1,
            balance: 10000,
            balances: [
              { balance_type: 1, balance: '10000', balance_coins: '100.00' },
            ],
            id: 4242,
            steam_name: 'Trader One',
            username: 'trader1',
            email: 'one@example.test',
          },
        },
        { rates: { USD: 1, CSGOEMPIRE_COIN: 2 } },
      ),
    ).toEqual({
      cash: 50,
      coins: 100,
      account: { id: '4242', name: 'Trader One', wallet: null },
      username: 'trader1',
      email: 'one@example.test',
    });
    // làm tròn XUỐNG tới cent như trang (18.09 coin / 2 = 9.045 → 9.04, không phải 9.05)
    expect(
      empireBalanceFrom(
        { user: { default_balance_type: 1, balance: 1809 } },
        { rates: { USD: 1, CSGOEMPIRE_COIN: 2 } },
      ).cash,
    ).toBe(9.04);
    // khách (chưa đăng nhập) = phiên hết hạn
    expect(() =>
      empireBalanceFrom(
        { user: null },
        { rates: { USD: 1, CSGOEMPIRE_COIN: 2 } },
      ),
    ).toThrow('CSGOEMPIRE_SESSION_EXPIRED');
  });

  it('số coin: hai trường của csgoempire phải khớp đơn vị, không thì từ chối', () => {
    expect(empireCoins({ default_balance_type: 1, balance: 12345 })).toBe(
      123.45,
    );
    expect(
      empireCoins({
        default_balance_type: 1,
        balance: 12345,
        balances: [{ balance_type: 1, balance_coins: '123.45' }],
      }),
    ).toBe(123.45);
    // balance_coins gấp 100 lần: đơn vị khác với giả định → không đoán
    expect(() =>
      empireCoins({
        default_balance_type: 1,
        balance: 12345,
        balances: [{ balance_type: 1, balance_coins: '12345' }],
      }),
    ).toThrow('CASH_UNAVAILABLE');
  });

  it('vào lệnh: dùng số dư Chrome nền vừa đọc (không gọi csgoempire), trừ tiền bot đã cược sau lần đọc, ghi nhận sau khi khớp', async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
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
      throw new Error(`Unexpected API ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const at = Date.now() - 5_000;
    const balances = store({ cash: 60, at }, { spent: 10 });
    const order = await new ApiVenueOrders(balances).empire(
      session,
      plan,
      new AbortController().signal,
    );
    expect(order).toMatchObject({ cash: 50, requiredCash: 10 });
    expect(
      fetcher.mock.calls.some(([url]) => url.includes('csgoempire.com')),
    ).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/bet/place'))).toBe(
      false,
    );
    expect(await order.submit()).toMatchObject({
      status: 'filled',
      orderRef: 'ticket-1',
      cost: 10,
    });
    expect(balances.spendEmpire).toHaveBeenCalledWith(
      expect.stringMatching(/^csgoempire:/),
      10,
    );
  });

  it('BetBy từ chối vé (odds giảm) khi Polymarket đã khớp: đặt bù MỘT lần ở odds sàn, tiền cược theo odds đó', async () => {
    const placed: { k: string; id: string; selK: string; sum: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('/coupon/max'))
          return Promise.resolve(Response.json({ max_bet: '30' }));
        const [body] = JSON.parse(
          typeof init?.body === 'string' ? init.body : '[]',
        ) as {
          k: string;
          sum: string;
          bet_request_id: string;
          selections: { k: string }[];
        }[];
        placed.push({
          k: body.k,
          sum: body.sum,
          id: body.bet_request_id,
          selK: body.selections[0].k,
        });
        return Promise.resolve(
          placed.length === 1
            ? Response.json({ accepted: [], error: [{ code: 'odds_changed' }] })
            : Response.json({
                accepted: [
                  { bet_request_id: body.bet_request_id, bet_id: 'ticket-2' },
                ],
                error: [],
              }),
        );
      }),
    );
    const order = await new ApiVenueOrders(store({ cash: 100 })).empire(
      session,
      plan,
      new AbortController().signal,
    );
    // 20 share Polymarket, chi phí 8.5$ → odds sàn 20/11.5 = 1.739 → 1.74; cược 20/1.74 = 11.49$
    const r = await order.submit({ hedge: { shares: 20, cost: 8.5 } });
    expect(r).toMatchObject({
      status: 'filled',
      orderRef: 'ticket-2',
      avgPrice: 1.74,
      filledAmount: 11.49,
      cost: 11.49,
    });
    expect(placed.map((x) => [x.k, x.selK, x.sum])).toEqual([
      ['2', '2', '10.00'],
      ['1.74', '1.74', '11.49'],
    ]);
    expect(placed[0].id).toBe('request-123');
    expect(placed[1].id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('BetBy từ chối mà không đặt bù được (không có odds sàn thấp hơn / thiếu Cash): không gửi thêm, nói rõ vì sao', async () => {
    const fetcher = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/coupon/max')
          ? Response.json({ max_bet: '30' })
          : Response.json({ accepted: [], error: [{ code: 'limit' }] }),
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const order = await new ApiVenueOrders(store({ cash: 100 })).empire(
      session,
      plan,
      new AbortController().signal,
    );
    // 20 share, chi phí 12$ → odds sàn 2.5 ≥ odds gốc 2: không có mức nào bù được
    const r = await order.submit({ hedge: { shares: 20, cost: 12 } });
    expect(r.status).toBe('rejected');
    expect(r.error).toContain('"code":"limit"');
    expect(r.error).toContain('không đặt bù: không có odds nào');
    // cần 11.49$ mà Cash chỉ 11$
    const poor = await new ApiVenueOrders(store({ cash: 11 })).empire(
      session,
      plan,
      new AbortController().signal,
    );
    const r2 = await poor.submit({ hedge: { shares: 20, cost: 8.5 } });
    expect(r2.error).toContain('vượt Cash csgoempire 11.00$');
    expect(
      fetcher.mock.calls.filter(([u]) => u.endsWith('/bet/place')),
    ).toHaveLength(2);
  });

  it('số dư quá cũ / chưa đọc được / không có kho: không vào lệnh, nói rõ lý do', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ max_bet: '30' }))),
    );
    const signal = new AbortController().signal;
    await expect(
      new ApiVenueOrders(store({ cash: 100, at: Date.now() - 90_000 })).empire(
        session,
        plan,
        signal,
      ),
    ).rejects.toThrow(/CSGOEMPIRE_BALANCE_UNAVAILABLE: đọc cách đây 90 giây/);
    await expect(
      new ApiVenueOrders(
        store(null, {
          lastError: {
            error: 'CSGOEMPIRE_BALANCE_READ_FAILED',
            at: Date.now(),
          },
        }),
      ).empire(session, plan, signal),
    ).rejects.toThrow(/lần đọc gần nhất lỗi CSGOEMPIRE_BALANCE_READ_FAILED/);
    await expect(
      new ApiVenueOrders().empire(session, plan, signal),
    ).rejects.toThrow('CSGOEMPIRE_BALANCE_UNAVAILABLE');
    // số dư còn mới nhưng lần đọc/kiểm tra SAU đó lỗi → vẫn từ chối
    await expect(
      new ApiVenueOrders(
        store(
          { cash: 100, at: Date.now() - 10_000 },
          {
            lastError: {
              error: 'CSGOEMPIRE_BALANCE_READ_FAILED: metadata HTTP 403',
              at: Date.now(),
            },
          },
        ),
      ).empire(session, plan, signal),
    ).rejects.toThrow(/lần đọc gần nhất lỗi CSGOEMPIRE_BALANCE_READ_FAILED/);
  });

  it('BetBy 401 khi JWT còn hạn: lý do ghi endpoint, HTTP, lời sàn và thời hạn JWT còn lại', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({ message: 'Unauthorized' }, { status: 401 }),
        ),
      ),
    );
    await expect(
      new ApiVenueOrders(store({ cash: 100 })).empire(
        session,
        plan,
        new AbortController().signal,
      ),
    ).rejects.toThrow(
      /CSGOEMPIRE_SESSION_EXPIRED: .*BetBy \/api\/v1\/coupon\/max HTTP 401 — Unauthorized · JWT còn 30 phút/,
    );
  });

  it('zero csgoempire cash is returned even if max_bet is zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ max_bet: '0' }))),
    );
    expect(
      await new ApiVenueOrders(store({ cash: 0 })).empire(
        session,
        plan,
        new AbortController().signal,
      ),
    ).toMatchObject({ cash: 0 });
  });

  it('API trả trang HTML lỗi: báo "sàn từ chối", không coi là phiên hết hạn; Cloudflare chỉ khi có dấu Cloudflare', async () => {
    const html = (headers: Record<string, string>) =>
      vi.fn(() =>
        Promise.resolve(
          new Response('<html>Forbidden</html>', { status: 403, headers }),
        ),
      );
    const signal = new AbortController().signal;
    vi.stubGlobal(
      'fetch',
      html({ 'content-type': 'text/html; charset=UTF-8' }),
    );
    await expect(
      new ApiVenueOrders(store({ cash: 100 })).empire(session, plan, signal),
    ).rejects.toThrow('CSGOEMPIRE_HTTP_REJECTED: HTTP 403');
    vi.stubGlobal(
      'fetch',
      html({ 'content-type': 'text/html', 'cf-mitigated': 'challenge' }),
    );
    await expect(
      new ApiVenueOrders(store({ cash: 100 })).empire(session, plan, signal),
    ).rejects.toThrow('CSGOEMPIRE_CLOUDFLARE_BLOCKED: HTTP 403');
  });

  it('Polymarket: ví funder không sinh ra từ private key → báo POLYMARKET_FUNDER_MISMATCH, không gọi số dư', async () => {
    vi.stubEnv('TRADING_SECRET_KEY', 'unit-test-key-not-a-real-wallet-key');
    mocks.create.mockResolvedValue({
      account: { signer: '0xsigner', signerType: 'SESSION_KEY' },
    });
    const c = {
      walletAddress: '0xsigner',
      funderAddress: '0xsomeoneelse',
      secretCipher: new AesGcmSecretCipher(
        process.env.TRADING_SECRET_KEY,
      ).encrypt('test-private-key'),
    };
    await expect(
      new ApiVenueOrders().polymarket(c, plan, new AbortController().signal),
    ).rejects.toThrow('POLYMARKET_FUNDER_MISMATCH');
    expect(mocks.cash).not.toHaveBeenCalled();
  });

  it('kiểm tra tài khoản Polymarket: bắt CLOB đọc lại cash (không dùng số đệm), kèm giá trị vị thế để hiển thị', async () => {
    vi.stubEnv('TRADING_SECRET_KEY', 'unit-test-key-not-a-real-wallet-key');
    const client = {
      account: { signer: '0xsigner', signerType: 'OWNER', wallet: '0xfunder' },
    };
    mocks.create.mockResolvedValue(client);
    mocks.refresh.mockResolvedValue({
      balance: '80000',
      allowances: { exchange: 1000000000n },
    });
    mocks.portfolio.mockResolvedValue({ wallet: '0xfunder', value: '12.5' });
    const c = {
      walletAddress: '0xsigner',
      funderAddress: '0xfunder',
      secretCipher: new AesGcmSecretCipher(
        process.env.TRADING_SECRET_KEY,
      ).encrypt('test-private-key'),
    };
    const r = await readPolymarketBalance(c, new AbortController().signal);
    expect(r).toMatchObject({ cash: 0.08, positions: 12.5 });
    expect(mocks.cash).not.toHaveBeenCalled();
    expect(mocks.portfolio).toHaveBeenCalledWith(client, { user: '0xfunder' });
    // sàn không trả giá trị vị thế: vẫn kiểm tra được, chỉ thiếu số vị thế
    mocks.portfolio.mockRejectedValue(new Error('down'));
    expect(
      (await readPolymarketBalance(c, new AbortController().signal)).positions,
    ).toBeNull();
  });

  it('Polymarket: tiền lệnh quá 2 số lẻ → hủy gọn lúc chuẩn bị; sàn trả 4xx → "bị từ chối" (không phải không rõ)', async () => {
    vi.stubEnv('TRADING_SECRET_KEY', 'unit-test-key-not-a-real-wallet-key');
    const c = {
      walletAddress: '0xsigner',
      funderAddress: null,
      secretCipher: new AesGcmSecretCipher(
        process.env.TRADING_SECRET_KEY,
      ).encrypt('test-private-key'),
    };
    mocks.cash.mockResolvedValue({
      balance: '100000000',
      allowances: { exchange: 1000000000n },
    });
    const client = {
      account: { signer: '0xsigner', signerType: 'OWNER', wallet: '0xsigner' },
      createLimitOrder: vi.fn(() =>
        Promise.resolve({ takerAmount: '20500000', makerAmount: '7585000' }),
      ),
      postOrder: vi.fn(),
    };
    mocks.create.mockResolvedValue(client);
    await expect(
      new ApiVenueOrders().polymarket(
        c,
        { ...plan, shares: 20.5, polyLimit: 0.37 },
        new AbortController().signal,
      ),
    ).rejects.toThrow('POLYMARKET_AMOUNT_PRECISION');
    expect(client.postOrder).not.toHaveBeenCalled();

    client.createLimitOrder.mockResolvedValue({
      takerAmount: '20000000',
      makerAmount: '8000000',
    });
    const rejected = Object.assign(new Error('invalid amounts'), {
      name: 'RequestRejectedError',
      status: 400,
    });
    client.postOrder.mockRejectedValueOnce(rejected);
    const order = await new ApiVenueOrders().polymarket(
      c,
      plan,
      new AbortController().signal,
    );
    expect(await order.submit()).toMatchObject({
      status: 'rejected',
      error: expect.stringContaining(
        'RequestRejectedError 400 — invalid amounts',
      ) as string,
    });
    // 5xx: có thể đã vào → không đoán, để bên ngoài coi là KHÔNG RÕ
    client.postOrder.mockRejectedValueOnce(
      Object.assign(new Error('bad gateway'), {
        name: 'RequestRejectedError',
        status: 502,
      }),
    );
    await expect(order.submit()).rejects.toThrow('bad gateway');
  });

  it('Polymarket reads collateral cash of the funder, ignores portfolio, and uses FOK', async () => {
    vi.stubEnv('TRADING_SECRET_KEY', 'unit-test-key-not-a-real-wallet-key');
    const signed = { takerAmount: '20000000', makerAmount: '8000000' };
    const client = {
      account: { signer: '0xsigner', signerType: 'OWNER' },
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
    // FOK bị giết: giữ mã + lời sàn để đối soát biết vì sao chân Polymarket không vào
    client.postOrder.mockResolvedValueOnce({
      ok: false,
      code: 'FOK_ORDER_NOT_FILLED',
      message: "order couldn't be fully filled",
    } as never);
    expect(await fundedOrder.submit()).toMatchObject({
      status: 'rejected',
      error:
        "POLYMARKET_REJECTED:FOK_ORDER_NOT_FILLED — order couldn't be fully filled",
    });
  });
});
