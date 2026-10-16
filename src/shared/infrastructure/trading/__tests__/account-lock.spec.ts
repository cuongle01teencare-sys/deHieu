import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { AccountLock } from '../account-lock.js';

/** Redis giả đủ cho khóa: SET NX PX, GET, EVAL (so chủ rồi DEL / PEXPIRE). */
function fakeRedis() {
  const store = new Map<string, string>();
  const redis = {
    status: 'ready',
    on: () => redis,
    set: (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return Promise.resolve(null);
      store.set(key, value);
      return Promise.resolve('OK');
    },
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
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
