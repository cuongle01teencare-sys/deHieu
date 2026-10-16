import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { AccountLock } from '../account-lock.js';

/** Redis giả đủ cho khóa: SET NX PX, GET, EVAL (so chủ rồi DEL / PEXPIRE). */
function fakeRedis() {
  const store = new Map<string, string>();
  const zsets = new Map<string, [number, string][]>();
  const redis = {
    status: 'ready',
    on: () => redis,
    set: (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return Promise.resolve(null);
      store.set(key, value);
      return Promise.resolve('OK');
    },
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    mget: (...keys: string[]) =>
      Promise.resolve(keys.map((k) => store.get(k) ?? null)),
    zrangebyscore: (key: string, min: number, _max: string) =>
      Promise.resolve(
        (zsets.get(key) ?? [])
          .filter(([score]) => score >= min)
          .map(([, m]) => m),
      ),
    multi: () => {
      const ops: (() => void)[] = [];
      const tx = {
        zadd: (key: string, score: number, member: string) => {
          ops.push(() =>
            zsets.set(key, [...(zsets.get(key) ?? []), [score, member]]),
          );
          return tx;
        },
        zremrangebyscore: (key: string, _min: string, max: number) => {
          ops.push(() =>
            zsets.set(
              key,
              (zsets.get(key) ?? []).filter(([score]) => score > max),
            ),
          );
          return tx;
        },
        pexpire: () => tx,
        exec: () => {
          ops.forEach((o) => o());
          return Promise.resolve([]);
        },
      };
      return tx;
    },
    eval: (script: string, _n: number, key: string, owner: string) => {
      if (store.get(key) !== owner) return Promise.resolve(0);
      if (script.includes('DEL')) store.delete(key);
      return Promise.resolve(1);
    },
    disconnect: () => undefined,
  };
  return { store, redis: redis as unknown as Redis };
}

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('khóa tài khoản', () => {
  it('mặc định báo bận ngay (đặt lệnh không chờ trên odds cũ)', async () => {
    const { redis } = fakeRedis();
    const lock = new AccountLock('redis://unused', redis);
    let release!: () => void;
    const holding = lock.with(
      ['csgoempire:a'],
      () => new Promise<void>((r) => (release = r)),
    );
    await later(5);
    await expect(
      lock.with(['csgoempire:a'], () => Promise.resolve()),
    ).rejects.toThrow('ACCOUNT_BUSY');
    release();
    await holding;
  });

  it('waitMs: chờ người đang giữ nhả rồi chạy; không giữ một phần khóa trong lúc chờ', async () => {
    const { store, redis } = fakeRedis();
    const lock = new AccountLock('redis://unused', redis);
    let release!: () => void;
    const holding = lock.with(
      ['csgoempire:b'],
      () => new Promise<void>((r) => (release = r)),
    );
    await later(5);
    const order: string[] = [];
    const waiting = lock.with(
      ['csgoempire:a', 'csgoempire:b'],
      () => {
        order.push('second');
        return Promise.resolve();
      },
      { waitMs: 2_000 },
    );
    await later(150);
    // tài nguyên a không bị giữ hộ trong lúc chờ b
    expect(store.has('trade:lock:csgoempire:a')).toBe(false);
    order.push('first-done');
    release();
    await holding;
    await waiting;
    expect(order).toEqual(['first-done', 'second']);
    expect(store.size).toBe(0);
  });

  it('waitMs hết hạn → ACCOUNT_BUSY; hai tài khoản khác nhau không chặn nhau', async () => {
    const { redis } = fakeRedis();
    const lock = new AccountLock('redis://unused', redis);
    let release!: () => void;
    const holding = lock.with(
      ['csgoempire:x'],
      () => new Promise<void>((r) => (release = r)),
    );
    await later(5);
    await expect(
      lock.with(['csgoempire:x'], () => Promise.resolve(), { waitMs: 200 }),
    ).rejects.toThrow('ACCOUNT_BUSY');
    await expect(
      lock.with(['csgoempire:y'], () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
    release();
    await holding;
  });
});

describe('số dư csgoempire dùng chung giữa Chrome nền và worker', () => {
  it('trừ mọi lần bot cược từ lúc BẮT ĐẦU đọc (kể cả cược trong lúc đang đọc), trừ hao 5 giây', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { redis } = fakeRedis();
    const lock = new AccountLock('redis://unused', redis);
    const t0 = Date.now();
    // cược 30 giây trước lần đọc: đã có trong số dư sàn trả về → không trừ
    vi.setSystemTime(t0 - 30_000);
    await lock.spendEmpire('csgoempire:a', 7);
    // cược 3 giây trước lúc bắt đầu đọc: có thể sàn chưa kịp trừ → vẫn trừ (an toàn)
    vi.setSystemTime(t0 - 3_000);
    await lock.spendEmpire('csgoempire:a', 5);
    // Chrome nền BẮT ĐẦU đọc lúc t0; bot cược 10 khi Chrome còn đang đọc
    vi.setSystemTime(t0 + 1_000);
    await lock.spendEmpire('csgoempire:a', 10);
    // Chrome ghi kết quả (số dư sàn trả về chưa trừ 10 kia)
    await lock.saveEmpireBalance('csgoempire:a', {
      cash: 100,
      coins: 200,
      at: t0,
      account: { id: '1', name: 'x' },
    });
    // thêm một lệnh nữa ngay sau
    vi.setSystemTime(t0 + 2_000);
    await lock.spendEmpire('csgoempire:a', 20);
    const r = await lock.readEmpireBalance('csgoempire:a');
    expect(r.snapshot?.cash).toBe(100);
    expect(r.spent).toBe(35);
    // tài khoản khác không bị trừ lẫn
    expect((await lock.readEmpireBalance('csgoempire:b')).spent).toBe(0);
    vi.useRealTimers();
  });
});
