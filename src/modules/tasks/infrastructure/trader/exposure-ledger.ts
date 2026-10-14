import { Redis } from 'ioredis';

/**
 * Sổ phơi nhiễm theo trận, DÙNG CHUNG mọi task trader (Redis) để giới hạn tổng theo trận
 * áp cho MỌI tài khoản. Không có Redis → bộ nhớ trong task (chỉ đúng cho một trader).
 */
export interface ExposureLedger {
  /** Đánh dấu kèo đã xử lý (chống xử lý lại khi hub gửi lại sau khi task khởi động lại). false = đã có. */
  claim(profileId: string, signalId: string, ttlMs: number): Promise<boolean>;
  /** Đã dùng bao nhiêu (USD) ở từng khóa. */
  used(keys: readonly string[]): Promise<number[]>;
  /** Giữ `amount` trên mọi khóa nếu không khóa nào vượt giới hạn (cap ≤ 0 = không giới hạn). Nguyên tử. */
  reserve(
    entries: readonly { key: string; cap: number }[],
    amount: number,
    ttlMs: number,
  ): Promise<boolean>;
  /** Giữ chỗ một khóa trong ttl (SET NX). false = đã có người giữ. */
  hold(key: string, ttlMs: number): Promise<boolean>;
  isHeld(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
  close(): Promise<void>;
}

const RESERVE_LUA = `
local amount = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
for i, key in ipairs(KEYS) do
  local cap = tonumber(ARGV[2 + i])
  if cap > 0 then
    local cur = tonumber(redis.call('GET', key) or '0')
    if cur + amount > cap + 1e-9 then return 0 end
  end
end
for _, key in ipairs(KEYS) do
  redis.call('INCRBYFLOAT', key, amount)
  redis.call('PEXPIRE', key, ttl)
end
return 1
`;

export class RedisExposureLedger implements ExposureLedger {
  private readonly _redis: Redis;

  constructor(
    url: string,
    private readonly _ns: string,
  ) {
    this._redis = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this._redis.on('error', () => undefined); // lỗi từng lệnh do nơi gọi xử lý
  }

  async claim(profileId: string, signalId: string, ttlMs: number) {
    const r = await this._redis.set(
      `${this._ns}:done:${profileId}:${signalId}`,
      '1',
      'PX',
      Math.max(1_000, Math.round(ttlMs)),
      'NX',
    );
    return r === 'OK';
  }

  async hold(key: string, ttlMs: number) {
    const r = await this._redis.set(
      `${this._ns}:hold:${key}`,
      '1',
      'PX',
      Math.max(1_000, Math.round(ttlMs)),
      'NX',
    );
    return r === 'OK';
  }

  async isHeld(key: string) {
    return (await this._redis.exists(`${this._ns}:hold:${key}`)) === 1;
  }

  async release(key: string) {
    await this._redis.del(`${this._ns}:hold:${key}`);
  }

  async used(keys: readonly string[]) {
    if (!keys.length) return [];
    const v = await this._redis.mget(...keys.map((k) => `${this._ns}:${k}`));
    return v.map((x) => Number(x ?? 0) || 0);
  }

  async reserve(
    entries: readonly { key: string; cap: number }[],
    amount: number,
    ttlMs: number,
  ) {
    const r = await this._redis.eval(
      RESERVE_LUA,
      entries.length,
      ...entries.map((e) => `${this._ns}:${e.key}`),
      String(amount),
      String(Math.round(ttlMs)),
      ...entries.map((e) => String(e.cap)),
    );
    return r === 1;
  }

  async close() {
    await this._redis.quit().catch(() => this._redis.disconnect());
  }
}

export class InMemoryExposureLedger implements ExposureLedger {
  private readonly _v = new Map<string, { amount: number; until: number }>();
  private readonly _done = new Map<string, number>();
  private readonly _held = new Map<string, number>();

  hold(key: string, ttlMs: number) {
    if (this._isHeld(key)) return Promise.resolve(false);
    this._held.set(key, Date.now() + ttlMs);
    return Promise.resolve(true);
  }

  isHeld(key: string) {
    return Promise.resolve(this._isHeld(key));
  }

  release(key: string) {
    this._held.delete(key);
    return Promise.resolve();
  }

  private _isHeld(key: string) {
    const until = this._held.get(key);
    return until !== undefined && until > Date.now();
  }

  claim(profileId: string, signalId: string, ttlMs: number) {
    const k = `${profileId}:${signalId}`;
    const now = Date.now();
    for (const [x, until] of this._done) if (until <= now) this._done.delete(x);
    if (this._done.has(k)) return Promise.resolve(false);
    this._done.set(k, now + ttlMs);
    return Promise.resolve(true);
  }

  used(keys: readonly string[]) {
    return Promise.resolve(keys.map((k) => this._get(k)));
  }

  reserve(
    entries: readonly { key: string; cap: number }[],
    amount: number,
    ttlMs: number,
  ) {
    if (
      entries.some((e) => e.cap > 0 && this._get(e.key) + amount > e.cap + 1e-9)
    )
      return Promise.resolve(false);
    for (const e of entries)
      this._v.set(e.key, {
        amount: this._get(e.key) + amount,
        until: Date.now() + ttlMs,
      });
    return Promise.resolve(true);
  }

  close() {
    return Promise.resolve();
  }

  private _get(key: string) {
    const v = this._v.get(key);
    return v && v.until > Date.now() ? v.amount : 0;
  }
}
