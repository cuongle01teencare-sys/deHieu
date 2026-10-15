import { Redis } from 'ioredis';

/**
 * Sổ phơi nhiễm theo trận, DÙNG CHUNG mọi task trader (Redis) để giới hạn tổng theo trận
 * áp cho MỌI tài khoản. Không có Redis → bộ nhớ trong task (chỉ đúng cho một trader).
 */
export interface ExposureLedger {
  /** Đánh dấu kèo đã xử lý (chống xử lý lại khi hub gửi lại sau khi task khởi động lại). false = đã có. */
  claim(profileId: string, signalId: string, ttlMs: number): Promise<boolean>;
  /** Ghi kết quả lần xử lý vào dấu "đã xử lý" (để task khởi động lại vẫn biết). Chỉ khi dấu còn. */
  note(
    profileId: string,
    signalId: string,
    value: string,
    ttlMs: number,
  ): Promise<void>;
  /** Kết quả đã ghi; '1' = dấu cũ chưa có kết quả; null = chưa xử lý. */
  recall(profileId: string, signalId: string): Promise<string | null>;
  /** Đã dùng bao nhiêu (USD) ở từng khóa. */
  used(keys: readonly string[]): Promise<number[]>;
  /** Giữ `amount` trên mọi khóa nếu không khóa nào vượt giới hạn (cap ≤ 0 = không giới hạn). Nguyên tử. */
  reserve(
    entries: readonly { key: string; cap: number }[],
    amount: number,
    ttlMs: number,
  ): Promise<boolean>;
  /** Lấy một suất của khóa nếu còn (< max), nguyên tử. false = đã đủ suất. */
  acquire(key: string, max: number, ttlMs: number): Promise<boolean>;
  /** Số suất đã dùng. */
  count(key: string): Promise<number>;
  /** Trả lại một suất (vào lệnh thất bại sau khi đã lấy suất). */
  giveBack(key: string): Promise<void>;
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

const ACQUIRE_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`;

const GIVE_BACK_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur > 0 then redis.call('DECR', KEYS[1]) end
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

  async note(
    profileId: string,
    signalId: string,
    value: string,
    ttlMs: number,
  ) {
    await this._redis.set(
      `${this._ns}:done:${profileId}:${signalId}`,
      value,
      'PX',
      Math.max(1_000, Math.round(ttlMs)),
      'XX',
    );
  }

  recall(profileId: string, signalId: string) {
    return this._redis.get(`${this._ns}:done:${profileId}:${signalId}`);
  }

  async acquire(key: string, max: number, ttlMs: number) {
    const r = await this._redis.eval(
      ACQUIRE_LUA,
      1,
      `${this._ns}:slot:${key}`,
      String(max),
      String(Math.max(1_000, Math.round(ttlMs))),
    );
    return r === 1;
  }

  async count(key: string) {
    return Number((await this._redis.get(`${this._ns}:slot:${key}`)) ?? 0) || 0;
  }

  async giveBack(key: string) {
    await this._redis.eval(GIVE_BACK_LUA, 1, `${this._ns}:slot:${key}`);
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
  private readonly _done = new Map<string, { until: number; value: string }>();
  private readonly _slots = new Map<string, { n: number; until: number }>();

  acquire(key: string, max: number, ttlMs: number) {
    const n = this._slot(key);
    if (n >= max) return Promise.resolve(false);
    this._slots.set(key, { n: n + 1, until: Date.now() + ttlMs });
    return Promise.resolve(true);
  }

  count(key: string) {
    return Promise.resolve(this._slot(key));
  }

  giveBack(key: string) {
    const v = this._slots.get(key);
    if (v && v.n > 0) this._slots.set(key, { ...v, n: v.n - 1 });
    return Promise.resolve();
  }

  claim(profileId: string, signalId: string, ttlMs: number) {
    const k = `${profileId}:${signalId}`;
    const now = Date.now();
    for (const [x, d] of this._done) if (d.until <= now) this._done.delete(x);
    if (this._done.has(k)) return Promise.resolve(false);
    this._done.set(k, { until: now + ttlMs, value: '1' });
    return Promise.resolve(true);
  }

  note(profileId: string, signalId: string, value: string, ttlMs: number) {
    const k = `${profileId}:${signalId}`;
    if (this._done.has(k))
      this._done.set(k, { until: Date.now() + ttlMs, value });
    return Promise.resolve();
  }

  recall(profileId: string, signalId: string) {
    const d = this._done.get(`${profileId}:${signalId}`);
    return Promise.resolve(d && d.until > Date.now() ? d.value : null);
  }

  private _slot(key: string) {
    const v = this._slots.get(key);
    return v && v.until > Date.now() ? v.n : 0;
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
