import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STAKE_PLAN, type StakeTier } from '../../domain/stake-plan.js';
import type { TradingAccount } from '../../domain/trading-account.js';
import {
  DEFAULT_RISK_LIMITS,
  DEFAULT_STRATEGY,
  type TraderProfile,
} from '../../domain/trader-profile.js';
import {
  DEFAULT_TRADING_SETTINGS,
  type TradingSettings,
} from '../../domain/trading-settings.js';
import { TradingAdmin, type ProfileInput } from '../trading-admin.js';
import { TraderConfigSync } from '../trader-config.sync.js';
import type { TraderRuntimeConfig } from '../trader-config.js';
import type {
  RunningTrader,
  SecretCipher,
  TradeAttemptRepository,
  TraderTaskGateway,
  TradingSettingsStore,
} from '../trading.ports.js';

class MemRepo<T extends { id: string }> {
  readonly rows = new Map<string, T>();
  list = () => Promise.resolve([...this.rows.values()]);
  get = (id: string) => Promise.resolve(this.rows.get(id) ?? null);
  save = (x: T) => {
    this.rows.set(x.id, x);
    return Promise.resolve();
  };
  delete = (id: string) => Promise.resolve(this.rows.delete(id));
}

const TIERS: StakeTier[] = [
  { id: 'vip', name: 'VIP', minMargin: 0.05, maxMargin: null },
  { id: 'std', name: 'Thường', minMargin: 0.02, maxMargin: 0.05 },
];

const fakeCipher = (ok: boolean): SecretCipher => ({
  available: () => ok,
  encrypt: (p) => `enc(${p})`,
  decrypt: (c) => c.slice(4, -1),
});

class FakeGateway implements TraderTaskGateway {
  running: RunningTrader[] = [];
  pushed: { taskId: string; config: TraderRuntimeConfig }[] = [];
  listRunning = () => Promise.resolve(this.running);
  push = (taskId: string, config: TraderRuntimeConfig) => {
    this.pushed.push({ taskId, config });
    return Promise.resolve(true);
  };
}

describe('TradingAdmin + TraderConfigSync', () => {
  let accounts: MemRepo<TradingAccount>;
  let profiles: MemRepo<TraderProfile>;
  let settings: TradingSettings;
  let gateway: FakeGateway;
  let admin: TradingAdmin;
  let sync: TraderConfigSync;

  const make = (cipherOk = true) => {
    const settingsStore: TradingSettingsStore = {
      get: () => Promise.resolve(settings),
      save: (s) => {
        settings = s;
        return Promise.resolve();
      },
    };
    const tiers = { listTiers: () => Promise.resolve(TIERS) };
    sync = new TraderConfigSync(
      accounts,
      profiles,
      settingsStore,
      tiers,
      gateway,
    );
    admin = new TradingAdmin(
      accounts,
      profiles,
      {} as TradeAttemptRepository,
      settingsStore,
      tiers,
      fakeCipher(cipherOk),
      sync,
    );
  };

  beforeEach(() => {
    accounts = new MemRepo();
    profiles = new MemRepo();
    settings = DEFAULT_TRADING_SETTINGS;
    gateway = new FakeGateway();
    make();
  });

  const addAccounts = async () => {
    const e = await admin.saveAccount(null, {
      label: 'Empire 1',
      enabled: true,
      config: { venue: 'csgoempire', browserProfile: 'empire-1' },
    });
    const p = await admin.saveAccount(null, {
      label: 'Poly 1',
      enabled: true,
      config: {
        venue: 'polymarket',
        walletAddress: `0x${'a'.repeat(40)}`,
        funderAddress: null,
      },
      privateKey: 'B'.repeat(64),
    });
    if (e.status !== 'SUCEED' || p.status !== 'SUCEED')
      throw new Error('setup');
    return { empire: e.data, poly: p.data };
  };

  const profileInput = (empire: string, poly: string): ProfileInput => ({
    name: 'Trader A',
    enabled: true,
    mode: 'paper',
    csgoempireAccountId: empire,
    polymarketAccountId: poly,
    stakePlan: {
      ...DEFAULT_STAKE_PLAN,
      trend: 'up',
      baseStake: 40,
      stepPct: 0.5,
    },
    strategy: DEFAULT_STRATEGY,
    risk: DEFAULT_RISK_LIMITS,
  });

  it('mã hóa private key, API chỉ báo hasSecret', async () => {
    const { poly } = await addAccounts();
    expect(poly.hasSecret).toBe(true);
    expect(JSON.stringify(poly)).not.toContain('bbbb');
    expect(accounts.rows.get(poly.id)?.secretCipher).toBe(
      `enc(0x${'b'.repeat(64)})`,
    );

    // sửa không gửi key = giữ key cũ
    const again = await admin.saveAccount(poly.id, {
      label: 'Poly 1',
      enabled: false,
      config: poly.config,
    });
    expect(again).toMatchObject({
      status: 'SUCEED',
      data: { hasSecret: true, enabled: false },
    });
  });

  it('không có TRADING_SECRET_KEY → từ chối lưu private key', async () => {
    make(false);
    const r = await admin.saveAccount(null, {
      label: 'Poly',
      enabled: true,
      config: {
        venue: 'polymarket',
        walletAddress: `0x${'a'.repeat(40)}`,
        funderAddress: null,
      },
      privateKey: 'c'.repeat(64),
    });
    expect(r).toMatchObject({ status: 'FAILED' });
    expect(r.status === 'FAILED' && r.reason).toMatch(/^SECRET_KEY_MISSING/);
  });

  it('profile phải ghép đúng 1 csgoempire + 1 polymarket; tài khoản đang dùng không xóa được', async () => {
    const { empire, poly } = await addAccounts();
    const wrong = await admin.saveProfile(
      null,
      profileInput(poly.id, empire.id),
    );
    expect(wrong.status).toBe('FAILED');
    const ok = await admin.saveProfile(null, profileInput(empire.id, poly.id));
    expect(ok.status).toBe('SUCEED');
    expect((await admin.deleteAccount(empire.id)).status).toBe('FAILED');
  });

  it('gửi cấu hình đã tính sẵn (bảng vốn theo hạng) cho task trader đang chạy', async () => {
    const { empire, poly } = await addAccounts();
    const r = await admin.saveProfile(null, profileInput(empire.id, poly.id));
    if (r.status !== 'SUCEED') throw new Error('profile');
    gateway.running = [{ taskId: 'trader-a', profileId: r.data.id }];

    expect(await sync.pushAll()).toBe(1);
    const cfg = gateway.pushed.at(-1)!.config;
    expect(cfg).toMatchObject({
      active: true,
      inactiveReason: null,
      matchExposureCapUsd: 500,
    });
    // up 50%: hạng thấp (Thường) 40, hạng cao (VIP) 60
    expect(cfg.stakeTable.map((x) => [x.tierName, x.stake])).toEqual([
      ['Thường', 40],
      ['VIP', 60],
    ]);

    // không đổi → không gửi lại; đổi cấu hình chung → gửi
    expect(await sync.pushAll()).toBe(0);
    await admin.saveSettings({ matchExposureCapUsd: 0 });
    expect(gateway.pushed.at(-1)!.config.matchExposureCapUsd).toBe(0);
  });

  it('tài khoản tắt → worker nhận active=false kèm lý do', async () => {
    const { empire, poly } = await addAccounts();
    const r = await admin.saveProfile(null, profileInput(empire.id, poly.id));
    if (r.status !== 'SUCEED') throw new Error('profile');
    await admin.saveAccount(empire.id, {
      label: 'Empire 1',
      enabled: false,
      config: empire.config,
    });
    const cfg = await admin.runtimeConfig(r.data.id);
    expect(cfg).toMatchObject({
      active: false,
      inactiveReason: 'CSGOEMPIRE_ACCOUNT_DISABLED',
    });
    expect((await admin.runtimeConfig('missing')).inactiveReason).toBe(
      'PROFILE_NOT_FOUND',
    );
  });

  it('xem trước bảng vốn theo hạng hiện có', async () => {
    const r = await admin.previewStakeTable({
      ...DEFAULT_STAKE_PLAN,
      trend: 'down',
      baseStake: 90,
      stepPct: 0.5,
    });
    expect(r.status === 'SUCEED' && r.data.rows.map((x) => x.stake)).toEqual([
      90, 60,
    ]);
  });
});
