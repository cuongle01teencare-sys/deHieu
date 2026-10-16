import { describe, expect, it, vi } from 'vitest';
import { LiveOrderExecutor } from '../live-executor.js';
import type { LiveTradingConfig } from '../../../application/live-trading.js';
import type { OrderPlan, VenueFill } from '../venue-orders.js';

const credentials: LiveTradingConfig = {
  empire: {
    browserProfile: 'test',
    token: 'test-token',
    expiresAt: Date.now() + 1_800_000,
    apiUrl: 'https://api-h-c7818b61-608.sptpub.com',
    brandId: '2432911154364948480',
    sessionId: 'test',
    minBet: 0.1,
    cookie: 'test-cookie',
  },
  polymarket: {
    walletAddress: '0x123',
    funderAddress: null,
    secretCipher: 'encrypted',
  },
};
const plan: OrderPlan = {
  id: 'delivery-1',
  bookRef: { e: 'event', m: 'market', s: '', o0: 'outcome' },
  bookSide: 0,
  bookOdds: 2,
  stake: 10,
  tokenId: 'token',
  shares: 20,
  polyLimit: 0.4,
  polyFee: 0.5,
  expiresAt: Date.now() + 60_000,
};
const fill: VenueFill = {
  status: 'filled',
  orderRef: 'order-1',
  filledAmount: 10,
  avgPrice: 2,
  fee: 0,
  cost: 10,
  sentAt: 1,
  ackedAt: 2,
  filledAt: 2,
  error: null,
};
function setup(cash = [100, 100], required = [10, 8.5]) {
  const halted = new Map<string, string>();
  const submitted = new Set<string>();
  const locks = {
    with: async <T>(
      _keys: readonly string[],
      fn: (check: () => Promise<void>) => Promise<T>,
    ) => fn(() => Promise.resolve()),
    halted: (keys: readonly string[]) =>
      Promise.resolve(keys.map((k) => halted.get(k)).find(Boolean) ?? null),
    halt: vi.fn((keys: readonly string[], reason: string) => {
      for (const key of keys) halted.set(key, reason);
      return Promise.resolve();
    }),
    clearHalt: vi.fn((keys: readonly string[], expected: string) => {
      for (const key of keys)
        if (halted.get(key) === expected) halted.delete(key);
      return Promise.resolve();
    }),
    claim: (id: string) => {
      if (submitted.has(id)) return Promise.resolve(false);
      submitted.add(id);
      return Promise.resolve(true);
    },
    saveResult: vi.fn(() => Promise.resolve()),
    close: () => undefined,
  };
  const submit = [
    vi.fn(() => Promise.resolve({ ...fill })),
    vi.fn(() =>
      Promise.resolve({ ...fill, filledAmount: 20, avgPrice: 0.4, cost: 8.5 }),
    ),
  ];
  const venues = {
    empire: vi.fn(() =>
      Promise.resolve({
        cash: cash[0],
        requiredCash: required[0],
        account: { id: '42', name: 'empire-user', wallet: null },
        submit: submit[0],
      }),
    ),
    polymarket: vi.fn(() =>
      Promise.resolve({
        cash: cash[1],
        requiredCash: required[1],
        account: { id: '0xsigner', name: null, wallet: '0xfunder' },
        submit: submit[1],
      }),
    ),
  };
  return {
    executor: new LiveOrderExecutor(locks, venues),
    submit,
    venues,
    locks,
    halted,
  };
}

describe('live pair execution', () => {
  it.each([
    [9, 100],
    [100, 8],
    [0, 0],
  ])(
    'cash %s / %s: cancels BOTH legs without submitting',
    async (book, poly) => {
      const s = setup([book, poly]);
      const result = await s.executor.execute(
        credentials,
        plan,
        new AbortController().signal,
      );
      expect(result).toMatchObject({
        status: 'cancelled',
        reason: 'INSUFFICIENT_CASH: hủy cả hai chân',
        submitted: false,
      });
      // ghi kèm tài khoản thật sàn trả về để đối chiếu đúng tài khoản
      expect(result.cash).toEqual([
        {
          venue: 'csgoempire',
          available: book,
          required: 10,
          account: { id: '42', name: 'empire-user', wallet: null },
        },
        {
          venue: 'polymarket',
          available: poly,
          required: 8.5,
          account: { id: '0xsigner', name: null, wallet: '0xfunder' },
        },
      ]);
      for (const submit of s.submit) expect(submit).not.toHaveBeenCalled();
      expect(s.locks.halt).not.toHaveBeenCalled();
    },
  );
  it('cash must cover fees as well as the share notional', async () => {
    const s = setup([10, 8.49]);
    expect(
      (
        await s.executor.execute(
          credentials,
          plan,
          new AbortController().signal,
        )
      ).submitted,
    ).toBe(false);
    expect(s.submit[0]).not.toHaveBeenCalled();
  });
  it('submits once when both cash balances cover the complete amounts', async () => {
    const s = setup([10, 8.5]);
    expect(
      (
        await s.executor.execute(
          credentials,
          plan,
          new AbortController().signal,
        )
      ).status,
    ).toBe('filled');
    expect(s.halted.size).toBe(0);
    expect(s.locks.saveResult).toHaveBeenCalledOnce();
    expect(
      (
        await s.executor.execute(
          credentials,
          plan,
          new AbortController().signal,
        )
      ).reason,
    ).toBe('LIVE_ALREADY_SUBMITTED');
    for (const submit of s.submit) expect(submit).toHaveBeenCalledOnce();
  });
  it('does not substitute any guessed amount when cash cannot be read', async () => {
    const s = setup();
    s.venues.polymarket.mockRejectedValue(new Error('CASH_UNAVAILABLE'));
    expect(
      (
        await s.executor.execute(
          credentials,
          plan,
          new AbortController().signal,
        )
      ).submitted,
    ).toBe(false);
    for (const submit of s.submit) expect(submit).not.toHaveBeenCalled();
  });
  it('retains a persistent halt on both accounts after an unknown submission', async () => {
    const s = setup();
    s.submit[1].mockRejectedValue(new Error('network failure'));
    const r = await s.executor.execute(
      credentials,
      plan,
      new AbortController().signal,
    );
    expect(r).toMatchObject({ status: 'partial', submitted: true });
    expect(r.fills.map((f) => f.status)).toEqual(['filled', 'error']);
    expect(s.halted.size).toBe(2);
    await s.executor.execute(
      credentials,
      { ...plan, id: 'delivery-2' },
      new AbortController().signal,
    );
    for (const submit of s.submit) expect(submit).toHaveBeenCalledOnce();
  });
  it('BetBy từ chối phiên: hủy, khóa tài khoản csgoempire VÀ giữ chi tiết (endpoint, HTTP) trong lý do', async () => {
    const s = setup([100, 100]);
    s.venues.empire.mockRejectedValueOnce(
      new Error(
        'CSGOEMPIRE_SESSION_EXPIRED: Phiên csgoempire hết hạn — BetBy /api/v1/coupon/max HTTP 401 — token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
      ),
    );
    const result = await s.executor.execute(
      credentials,
      plan,
      new AbortController().signal,
    );
    expect(result.status).toBe('cancelled');
    expect(result.reason).toContain(
      'CSGOEMPIRE_SESSION_EXPIRED: Phiên csgoempire hết hạn — BetBy /api/v1/coupon/max HTTP 401',
    );
    expect(result.reason).not.toContain('eyJ');
    expect(s.locks.halt).toHaveBeenCalledWith(
      [expect.stringMatching(/^csgoempire:/)],
      result.reason,
    );
    for (const submit of s.submit) expect(submit).not.toHaveBeenCalled();
  });

  it('does not send expired signals', async () => {
    const s = setup();
    expect(
      (
        await s.executor.execute(
          credentials,
          { ...plan, expiresAt: 0 },
          new AbortController().signal,
        )
      ).submitted,
    ).toBe(false);
    for (const submit of s.submit) expect(submit).not.toHaveBeenCalled();
  });
  it('cancellation during preflight never submits a leg', async () => {
    const s = setup();
    const ac = new AbortController();
    ac.abort();
    expect(
      (await s.executor.execute(credentials, plan, ac.signal)).submitted,
    ).toBe(false);
    for (const submit of s.submit) expect(submit).not.toHaveBeenCalled();
  });
});
