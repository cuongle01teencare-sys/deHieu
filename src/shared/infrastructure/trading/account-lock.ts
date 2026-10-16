import { createHash, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

export const accountResource = (venue: string, identity: string) =>
  `${venue}:${createHash('sha256').update(identity).digest('hex')}`;

/** Shared by login, session refresh, and order execution on all worker processes. */
export class AccountLock {
  private readonly redis: Redis;
  constructor(url: string, redis?: Redis) {
    this.redis =
      redis ??
      new Redis(url, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
    this.redis.on('error', () => undefined);
  }

  async connect() {
    if (this.redis.status !== 'ready')
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          cleanup();
          resolve();
        };
        const error = () => {
          cleanup();
          reject(new Error('TRADING_REDIS_UNAVAILABLE'));
        };
        const cleanup = () => {
          this.redis.off('ready', ready);
          this.redis.off('error', error);
        };
        this.redis.once('ready', ready);
        this.redis.once('error', error);
      });
  }

  async halt(resources: readonly string[], reason: string) {
    for (const r of resources) await this.redis.set(`trade:halt:${r}`, reason);
  }
  async halted(resources: readonly string[]): Promise<string | null> {
    for (const r of resources) {
      const reason = await this.redis.get(`trade:halt:${r}`);
      if (reason) return reason;
    }
    return null;
  }
  async resume(resource: string) {
    await this.redis.del(`trade:halt:${resource}`);
  }
  async clearHalt(resources: readonly string[], expected: string) {
    for (const resource of resources)
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        `trade:halt:${resource}`,
        expected,
      );
  }
  async saveResult(id: string, result: unknown) {
    await this.redis.set(`trade:result:${id}`, JSON.stringify(result));
  }
  async claim(id: string): Promise<boolean> {
    // Persistent: deleting trade history or restarting must never replay a real order.
    return (await this.redis.set(`trade:executed:${id}`, '1', 'NX')) === 'OK';
  }
  /**
   * Chạy `fn` khi giữ được khóa của MỌI tài nguyên (thứ tự cố định → không khóa chéo).
   * `waitMs` > 0: tài nguyên đang bận thì nhả phần đã giữ và thử lại tới hết hạn, thay vì báo
   * ACCOUNT_BUSY ngay. Đặt lệnh dùng mặc định (0) để không vào lệnh trễ trên odds cũ.
   */
  async with<T>(
    resources: readonly string[],
    fn: (check: () => Promise<void>) => Promise<T>,
    options: { waitMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    await this.connect();
    const owner = randomUUID();
    const keys = [...new Set(resources)].sort().map((r) => `trade:lock:${r}`);
    const acquired: string[] = [];
    let lost = false;
    const renew = async () => {
      try {
        for (const key of acquired)
          if (
            (await this.redis.eval(
              "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], 120000) end return 0",
              1,
              key,
              owner,
            )) !== 1
          )
            lost = true;
      } catch {
        lost = true;
      }
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    const deadline = Date.now() + Math.max(0, options.waitMs ?? 0);
    const releaseAcquired = async () => {
      for (const key of acquired.splice(0))
        await this.redis
          .eval(
            "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
            1,
            key,
            owner,
          )
          .catch(() => undefined);
    };
    try {
      for (let attempt = 0; ; attempt++) {
        let busy = false;
        for (const key of keys) {
          if (
            (await this.redis.set(key, owner, 'PX', 120_000, 'NX')) !== 'OK'
          ) {
            busy = true;
            break;
          }
          acquired.push(key);
        }
        if (!busy) break;
        // không giữ một phần khóa trong lúc chờ: tránh chặn người khác vô ích
        await releaseAcquired();
        options.signal?.throwIfAborted();
        if (Date.now() >= deadline)
          throw new Error(
            'ACCOUNT_BUSY: tài khoản đang đăng nhập, làm mới phiên hoặc giao dịch',
          );
        await sleep(
          Math.min(
            deadline - Date.now(),
            Math.min(1_000, 100 * 2 ** attempt) * (0.5 + Math.random() / 2),
          ),
          options.signal,
        );
      }
      timer = setInterval(() => {
        void renew();
      }, 20_000);
      timer.unref();
      return await fn(async () => {
        await renew();
        if (lost) throw new Error('ACCOUNT_LOCK_LOST');
      });
    } finally {
      if (timer) clearInterval(timer);
      await releaseAcquired();
    }
  }
  // ------------------------------------------------- số dư csgoempire (Chrome nền đọc, worker dùng)

  /** Số dư Chrome nền vừa đọc (giữ 3 phút; quá cũ thì worker tự từ chối dùng). */
  async saveEmpireBalance(resource: string, snapshot: EmpireBalanceSnapshot) {
    await this.redis.set(
      `trade:empire-balance:${resource}`,
      JSON.stringify(snapshot),
      'PX',
      BALANCE_KEEP_MS,
    );
  }
  /** Lần đọc gần nhất bị lỗi: ghi lý do để worker báo đúng thay vì "không có số dư". */
  async saveEmpireBalanceError(resource: string, error: string) {
    await this.redis.set(
      `trade:empire-balance-error:${resource}`,
      JSON.stringify({ error, at: Date.now() }),
      'PX',
      BALANCE_KEEP_MS,
    );
  }
  async readEmpireBalance(resource: string): Promise<EmpireBalanceRead> {
    const [snap, err] = await this.redis.mget(
      `trade:empire-balance:${resource}`,
      `trade:empire-balance-error:${resource}`,
    );
    const parse = <T>(v: string | null): T | null => {
      try {
        return v ? (JSON.parse(v) as T) : null;
      } catch {
        return null;
      }
    };
    const snapshot = parse<EmpireBalanceSnapshot>(snap);
    let spent = 0;
    if (snapshot) {
      // mọi lần bot cược từ LÚC BẮT ĐẦU đọc (trừ hao 5 giây) có thể chưa có trong số dư đọc được
      const members = await this.redis.zrangebyscore(
        `trade:empire-spends:${resource}`,
        snapshot.at - SPEND_MARGIN_MS,
        '+inf',
      );
      for (const m of members) spent += Number(m.split(':')[2]) || 0;
    }
    return {
      snapshot,
      lastError: parse<{ error: string; at: number }>(err),
      spent,
    };
  }
  /** Ghi nhận bot vừa cược `amount` (theo thời điểm; giữ 10 phút). */
  async spendEmpire(resource: string, amount: number) {
    const key = `trade:empire-spends:${resource}`;
    const now = Date.now();
    await this.redis
      .multi()
      .zadd(key, now, `${now}:${randomUUID()}:${amount}`)
      .zremrangebyscore(key, '-inf', now - SPEND_KEEP_MS)
      .pexpire(key, SPEND_KEEP_MS)
      .exec();
  }

  close() {
    this.redis.disconnect();
  }
}

const BALANCE_KEEP_MS = 180_000;
const SPEND_KEEP_MS = 10 * 60_000;
/** Trừ hao: cược ngay TRƯỚC lúc đọc có thể chưa kịp vào số dư sàn trả về → vẫn trừ (an toàn). */
const SPEND_MARGIN_MS = 5_000;

/** Số dư csgoempire do Chrome nền đọc (không có cookie/token, không có thông tin đăng nhập). */
export interface EmpireBalanceSnapshot {
  /** USD dùng được. */
  cash: number;
  coins: number;
  /** Lúc BẮT ĐẦU đọc (ms): cược từ mốc này trở đi được trừ thêm khi dùng. */
  at: number;
  account: { id: string | null; name: string | null };
}
export interface EmpireBalanceRead {
  snapshot: EmpireBalanceSnapshot | null;
  lastError: { error: string; at: number } | null;
  spent: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    const abort = () => {
      clearTimeout(timer);
      reject(
        signal!.reason instanceof Error
          ? signal!.reason
          : new Error('ACCOUNT_LOCK_ABORTED'),
      );
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
