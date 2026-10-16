import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TradingAccount } from '../../../domain/trading-account.js';
import { LiveConfigProvider } from '../live-config.provider.js';
import { accountResource } from '../../../../../shared/infrastructure/trading/account-lock.js';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock(
  '../../../../../shared/infrastructure/trading/venue-orders.js',
  async (original) => ({
    ...(await original<object>()),
    readPolymarketBalance: mocks.read,
  }),
);

const account = {
  id: 'poly-1',
  label: 'polymarket',
  enabled: true,
  config: {
    venue: 'polymarket',
    walletAddress: '0xSigner',
    funderAddress: '0xFunder',
  },
  secretCipher: 'cipher',
} as unknown as TradingAccount;

function provider(halts: Record<string, string>) {
  const p = new LiveConfigProvider();
  const halted = vi.fn((resources: readonly string[]) =>
    Promise.resolve(resources.map((r) => halts[r]).find(Boolean) ?? null),
  );
  Object.assign(p, {
    locks: { connect: () => Promise.resolve(), halted },
  });
  return { p, halted };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('kiểm tra tài khoản báo trạng thái khóa vào lệnh', () => {
  it('đọc số dư được nhưng tài khoản đang khóa → trả lý do khóa (không báo "xanh" che mất)', async () => {
    vi.stubEnv('TRADING_SECRET_KEY', 'unit-test-key');
    vi.stubEnv('REDIS_URL', '');
    mocks.read.mockResolvedValue({
      cash: 0.08,
      allowance: 1,
      positions: 21.1,
      account: { id: '0xSigner', name: null, wallet: '0xFunder' },
    });
    const { p, halted } = provider({
      // khóa theo ví funder (chữ thường), cùng khóa mà worker đặt
      [accountResource('polymarket', '0xfunder')]:
        'LIVE_RECONCILIATION_REQUIRED:req-1',
    });
    const r = await p.check(account);
    expect(halted).toHaveBeenCalledWith([
      accountResource('polymarket', '0xfunder'),
    ]);
    expect(r).toMatchObject({
      cash: 0.08,
      halted: 'LIVE_RECONCILIATION_REQUIRED:req-1',
    });
  });

  it('không khóa → halted null', async () => {
    vi.stubEnv('TRADING_SECRET_KEY', 'unit-test-key');
    vi.stubEnv('REDIS_URL', '');
    mocks.read.mockResolvedValue({
      cash: 1,
      allowance: 1,
      positions: null,
      account: { id: '0xSigner', name: null, wallet: '0xFunder' },
    });
    expect((await provider({}).p.check(account)).halted).toBeNull();
  });
});
