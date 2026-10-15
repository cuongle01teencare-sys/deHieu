import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  parseEntry,
  RedisExposureLedgerReader,
} from '../redis-exposure-ledger.reader.js';
import { ExposureAdmin } from '../../../application/exposure-admin.js';
import type {
  StakeTierSource,
  TraderProfileRepository,
  TradingSettingsStore,
} from '../../../application/trading.ports.js';
import { DEFAULT_STAKE_PLAN } from '../../../domain/stake-plan.js';
import {
  DEFAULT_RISK_LIMITS,
  DEFAULT_STRATEGY,
  type TraderProfile,
} from '../../../domain/trader-profile.js';

/** Redis giả: đủ scan/mget/pttl/del cho reader. */
class FakeRedis {
  constructor(readonly kv = new Map<string, string>()) {}
  scan(_c: string, _m: string, pattern: string) {
    // đủ cho mẫu chỉ có '*' (tên trận trong test không chứa ký tự glob)
    const esc = (x: string) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${pattern.split('*').map(esc).join('.*')}$`);
    return Promise.resolve([
      '0',
      [...this.kv.keys()].filter((k) => re.test(k)),
    ]);
  }
  mget(...keys: string[]) {
    return Promise.resolve(keys.map((k) => this.kv.get(k) ?? null));
  }
  pttl() {
    return Promise.resolve(3_600_000);
  }
  del(...keys: string[]) {
    return Promise.resolve(keys.filter((k) => this.kv.delete(k)).length);
  }
}

const ROOM = 'room:cs2:aurora~ninjasinpyjamas:map-2-winner';
const COMBO = 'sptpub>0|polymarket>1';

const seed = () =>
  new FakeRedis(
    new Map([
      ['trade:paper:match:cs2:aurora~ninjasinpyjamas', '496.39'],
      ['trade:paper:profile:p1:match:cs2:aurora~ninjasinpyjamas', '48.31'],
      ['trade:paper:match:cs2:mindfreak~rooster', '60.42'],
      [`trade:paper:slot:entry:p1:${ROOM}:${COMBO}:auto`, '1'],
      ['trade:paper:done:p1:sig-1', '1'],
    ]),
  );

describe('Sổ phơi nhiễm (Redis)', () => {
  it('tách khóa số lệnh: room chứa dấu ":"', () => {
    expect(parseEntry(`p1:${ROOM}:${COMBO}:auto`)).toEqual({
      profileId: 'p1',
      room: ROOM,
      comboId: COMBO,
      tierId: 'auto',
    });
    expect(parseEntry('broken')).toBeNull();
  });

  it('đọc tiền theo trận (chung + riêng profile), số lệnh; bỏ dấu "đã xử lý"', async () => {
    const snap = await new RedisExposureLedgerReader(
      seed() as unknown as Redis,
    ).snapshot();
    expect(snap.matches.map((m) => [m.match, m.usedUsd])).toEqual([
      ['cs2:aurora~ninjasinpyjamas', 496.39],
      ['cs2:mindfreak~rooster', 60.42],
    ]);
    expect(snap.matches[0]?.byProfile).toEqual([
      { profileId: 'p1', usedUsd: 48.31, ttlMs: 3_600_000 },
    ]);
    expect(snap.entries).toEqual([
      {
        profileId: 'p1',
        room: ROOM,
        comboId: COMBO,
        tierId: 'auto',
        count: 1,
        ttlMs: 3_600_000,
      },
    ]);
  });

  it('đặt lại trận xóa cả khóa chung lẫn khóa riêng profile; đặt lại một cửa', async () => {
    const r = seed();
    const reader = new RedisExposureLedgerReader(r as unknown as Redis);
    expect(await reader.resetMatch('cs2:aurora~ninjasinpyjamas')).toBe(2);
    expect([...r.kv.keys()].some((k) => k.includes('aurora'))).toBe(true); // còn khóa số lệnh
    expect(
      await reader.resetEntry({
        profileId: 'p1',
        room: ROOM,
        comboId: COMBO,
        tierId: 'auto',
      }),
    ).toBe(1);
    expect([...r.kv.keys()].some((k) => k.includes('aurora'))).toBe(false);
  });

  it('ExposureAdmin gắn tên profile/hạng, hạn mức và số lệnh tối đa (riêng hạng)', async () => {
    const profile: TraderProfile = {
      id: 'p1',
      name: 'Trader A',
      enabled: true,
      mode: 'paper',
      csgoempireAccountId: 'e',
      polymarketAccountId: 'p',
      stakePlan: {
        ...DEFAULT_STAKE_PLAN,
        overrides: { auto: { maxEntries: 3 } },
      },
      strategy: DEFAULT_STRATEGY,
      risk: { ...DEFAULT_RISK_LIMITS, matchCapUsd: 100 },
    };
    const admin = new ExposureAdmin(
      new RedisExposureLedgerReader(seed() as unknown as Redis),
      {
        list: () => Promise.resolve([profile]),
      } as unknown as TraderProfileRepository,
      {
        listTiers: () =>
          Promise.resolve([
            { id: 'auto', name: 'VIP auto', minMargin: 0.05, maxMargin: null },
          ]),
      } satisfies StakeTierSource,
      {
        get: () => Promise.resolve({ matchExposureCapUsd: 500 }),
      } as unknown as TradingSettingsStore,
    );
    const v = await admin.view();
    expect(v.available).toBe(true);
    expect(v.matches[0]).toMatchObject({
      usedUsd: 496.39,
      capUsd: 500,
      profiles: [{ profileName: 'Trader A', usedUsd: 48.31, capUsd: 100 }],
    });
    expect(v.entries[0]).toMatchObject({
      profileName: 'Trader A',
      tierName: 'VIP auto',
      count: 1,
      max: 3,
    });
  });

  it('Redis lỗi → available=false kèm lỗi, không ném', async () => {
    const admin = new ExposureAdmin(
      {
        snapshot: () => Promise.reject(new Error('ECONNREFUSED')),
      } as never,
      { list: () => Promise.resolve([]) } as unknown as TraderProfileRepository,
      { listTiers: () => Promise.resolve([]) } satisfies StakeTierSource,
      {
        get: () => Promise.resolve({ matchExposureCapUsd: 500 }),
      } as unknown as TradingSettingsStore,
    );
    expect(await admin.view()).toMatchObject({
      available: false,
      error: 'ECONNREFUSED',
    });
  });
});
