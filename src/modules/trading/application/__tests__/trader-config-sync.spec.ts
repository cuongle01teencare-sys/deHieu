import { describe, expect, it } from 'vitest';
import { DEFAULT_STAKE_PLAN } from '../../domain/stake-plan.js';
import {
  DEFAULT_RISK_LIMITS,
  DEFAULT_STRATEGY,
  type TraderProfile,
} from '../../domain/trader-profile.js';
import type { TradingAccount } from '../../domain/trading-account.js';
import { DEFAULT_TRADING_SETTINGS } from '../../domain/trading-settings.js';
import type { TraderRuntimeConfig } from '../trader-config.js';
import { TraderConfigSync } from '../trader-config.sync.js';

const accounts: TradingAccount[] = [1, 2, 3, 4].flatMap((n) => [
  {
    id: `e${n}`,
    label: `Empire ${n}`,
    enabled: true,
    config: { venue: 'csgoempire' as const, browserProfile: `empire-${n}` },
    secretCipher: null,
  },
  {
    id: `p${n}`,
    label: `Poly ${n}`,
    enabled: true,
    config: {
      venue: 'polymarket' as const,
      walletAddress: `0x${String(n).repeat(40)}`,
      funderAddress: null,
    },
    secretCipher: 'k',
  },
]);
const profile = (n: number): TraderProfile => ({
  id: `P${n}`,
  name: `P${n}`,
  enabled: true,
  mode: 'live',
  csgoempireAccountId: `e${n}`,
  polymarketAccountId: `p${n}`,
  stakePlan: DEFAULT_STAKE_PLAN,
  strategy: DEFAULT_STRATEGY,
  risk: DEFAULT_RISK_LIMITS,
});

describe('TraderConfigSync.pushAll', () => {
  it('chuẩn bị nhiều profile song song có giới hạn; một tài khoản chậm không giữ các profile khác', async () => {
    let active = 0;
    let peak = 0;
    const finished: string[] = [];
    const pushed: string[] = [];
    const sync = new TraderConfigSync(
      { list: () => Promise.resolve(accounts) } as never,
      {
        get: (id: string) => Promise.resolve(profile(Number(id.slice(1)))),
      } as never,
      { get: () => Promise.resolve(DEFAULT_TRADING_SETTINGS) } as never,
      {
        listTiers: () =>
          Promise.resolve([
            { id: 'std', name: 'Thường', minMargin: 0.02, maxMargin: null },
          ]),
      },
      {
        listRunning: () =>
          Promise.resolve(
            [1, 2, 3, 4].map((n) => ({ taskId: `t${n}`, profileId: `P${n}` })),
          ),
        push: (taskId: string) => {
          pushed.push(taskId);
          return Promise.resolve(true);
        },
        command: () => Promise.resolve(true),
      },
      () => undefined,
      {
        // P1 phải mở Chrome làm mới phiên (chậm), các profile khác có phiên sẵn
        prepare: async (c: TraderRuntimeConfig) => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) =>
            setTimeout(r, c.profileId === 'P1' ? 200 : 10),
          );
          active--;
          finished.push(c.profileId);
          return c;
        },
      },
      2,
    );
    expect(await sync.pushAll()).toBe(4);
    expect(peak).toBe(2);
    expect(finished.indexOf('P1')).toBe(3);
    expect(pushed.sort()).toEqual(['t1', 't2', 't3', 't4']);
  });
});
