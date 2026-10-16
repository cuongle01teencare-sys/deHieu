import { describe, expect, it, vi } from 'vitest';
import { ReconcileAdmin } from '../reconcile-admin.js';
import type { TradingAccount } from '../../domain/trading-account.js';
import type { TraderProfile } from '../../domain/trader-profile.js';

const empire = {
  id: 'acc-e',
  config: { venue: 'csgoempire', browserProfile: 'empire-test' },
} as unknown as TradingAccount;
const poly = {
  id: 'acc-p',
  config: { venue: 'polymarket', walletAddress: '0xa', funderAddress: '0xb' },
} as unknown as TradingAccount;
const profile = {
  id: 'p1',
  csgoempireAccountId: 'acc-e',
  polymarketAccountId: 'acc-p',
} as unknown as TraderProfile;

function setup(cleared: string[] | Error) {
  const halts = {
    clearReconciliation: vi.fn(() =>
      cleared instanceof Error
        ? Promise.reject(cleared)
        : Promise.resolve(cleared),
    ),
  };
  const sync = { pushAll: vi.fn(() => Promise.resolve(1)) };
  const admin = new ReconcileAdmin(
    {
      get: (id: string) => Promise.resolve(id === 'p1' ? profile : null),
    } as never,
    {
      get: (id: string) =>
        Promise.resolve(id === 'acc-e' ? empire : id === 'acc-p' ? poly : null),
    } as never,
    halts,
    sync,
  );
  return { admin, halts, sync };
}

describe('nút "Đã đối soát — gỡ khóa" của profile', () => {
  it('gỡ khóa đối soát trên CẢ HAI tài khoản của profile rồi ép gửi lại cấu hình', async () => {
    const s = setup(['LIVE_RECONCILIATION_REQUIRED:abc — CHỈ chân Polymarket']);
    expect(await s.admin.resume('p1')).toEqual({
      status: 'SUCEED',
      data: {
        cleared: ['LIVE_RECONCILIATION_REQUIRED:abc — CHỈ chân Polymarket'],
      },
    });
    expect(s.halts.clearReconciliation).toHaveBeenCalledWith([empire, poly]);
    expect(s.sync.pushAll).toHaveBeenCalledWith(true);
  });

  it('không có khóa nào: báo rõ, không gửi lại cấu hình', async () => {
    const s = setup([]);
    const r = await s.admin.resume('p1');
    expect(r).toMatchObject({ status: 'FAILED' });
    expect(r.status === 'FAILED' && r.reason).toMatch(
      /^NO_RECONCILIATION_HALT/,
    );
    expect(s.sync.pushAll).not.toHaveBeenCalled();
  });

  it('profile không tồn tại / Redis lỗi', async () => {
    expect((await setup([]).admin.resume('nope')).status).toBe('NOT_FOUND');
    expect(
      await setup(new Error('LIVE_REDIS_REQUIRED')).admin.resume('p1'),
    ).toEqual({ status: 'FAILED', reason: 'LIVE_REDIS_REQUIRED' });
  });
});
