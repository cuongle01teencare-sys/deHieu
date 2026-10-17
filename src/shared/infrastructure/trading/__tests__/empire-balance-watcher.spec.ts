import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmpireBalanceWatcher } from '../empire-balance-watcher.js';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  closeProfile: vi.fn((_name: string) => Promise.resolve()),
}));
vi.mock('../empire-session.js', async (original) => ({
  ...(await original<object>()),
  launchProfile: mocks.launch,
  closeProfile: mocks.closeProfile,
}));

const meta = {
  user: {
    default_balance_type: 1,
    balance: 10000,
    balances: [{ balance_type: 1, balance_coins: '100.00' }],
    id: 4242,
    steam_name: 'Trader One',
    email: 'me@example.test',
  },
};
const rates = { rates: { USD: 1, CSGOEMPIRE_COIN: 2 } };
type Scenario = { meta?: [number, unknown]; rates?: [number, unknown] };
const ok: Scenario = { meta: [200, meta], rates: [200, rates] };

function response(path: string, [status, json]: [number, unknown]) {
  return {
    url: () => `https://csgoempire.com${path}`,
    status: () => status,
    json: () =>
      json === null
        ? Promise.reject(new Error('not json'))
        : Promise.resolve(json),
    headers: () => ({
      'content-type':
        json === null ? 'text/html; charset=UTF-8' : 'application/json',
    }),
    request: () => ({
      method: () => 'GET',
      allHeaders: () =>
        Promise.resolve({
          accept: 'application/json',
          cookie: 'secret',
          'x-empire-device-identifier': 'dev-123',
          'x-env-class': 'blue',
        }),
    }),
  };
}

/** Trang giả: mỗi lần goto, "trang" tự gọi các API theo kịch bản kế tiếp. */
function browser(...scenarios: Scenario[]) {
  type R = ReturnType<typeof response>;
  let waiters: {
    pred: (r: R) => boolean;
    ok: (r: R) => void;
    fail: (e: Error) => void;
  }[] = [];
  let n = 0;
  const page = {
    goto: vi.fn((url: string, _o?: unknown) => {
      page.current = url;
      const sc = scenarios[Math.min(n++, scenarios.length - 1)] ?? ok;
      const out: R[] = [];
      if (sc.meta) out.push(response('/api/v2/metadata', sc.meta));
      if (sc.rates)
        out.push(response('/api/v2/metadata/exchange-rates', sc.rates));
      const pending = waiters;
      waiters = [];
      for (const w of pending) {
        const hit = out.find((r) => w.pred(r));
        if (hit) w.ok(hit);
        else w.fail(new Error('Timeout'));
      }
      return Promise.resolve();
    }),
    waitForResponse: vi.fn(
      (pred: (r: R) => boolean) =>
        new Promise<R>((ok, fail) => waiters.push({ pred, ok, fail })),
    ),
    /** fetch trong trang: chỉ được khi có header riêng của trang và `fetchOk` (sàn chưa đổi ý). */
    fetchOk: true,
    evaluate: vi.fn(
      (_fn: unknown, arg: { url: string; headers: Record<string, string> }) => {
        // như Chrome thật: trang trắng không fetch được đường dẫn tương đối
        if (!page.current.includes('csgoempire.com'))
          return Promise.reject(
            new TypeError(
              `Failed to execute 'fetch' on 'Window': Failed to parse URL from ${arg.url}`,
            ),
          );
        const allowed =
          page.fetchOk &&
          arg.headers['x-empire-device-identifier'] === 'dev-123';
        if (!allowed)
          return Promise.resolve({
            status: 403,
            json: null,
            type: 'text/html',
          });
        return Promise.resolve({
          status: 200,
          json: arg.url.endsWith('exchange-rates') ? rates : meta,
          type: 'application/json',
        });
      },
    ),
    /** Địa chỉ hiện tại: about:blank tới khi goto. */
    current: 'about:blank',
    url: () => page.current,
    waitForTimeout: vi.fn(() => Promise.resolve()),
    bringToFront: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    isClosed: () => false,
  };
  const context = {
    route: vi.fn((_match: (u: URL) => boolean, _handler: unknown) =>
      Promise.resolve(),
    ),
    pages: () => [page],
    newPage: () => Promise.resolve(page),
    close: vi.fn(() => Promise.resolve()),
  };
  mocks.launch.mockResolvedValue(context);
  return { page, context };
}
function sink() {
  return {
    saveEmpireBalance: vi.fn((_r: string, _s: unknown) => Promise.resolve()),
    saveEmpireBalanceError: vi.fn((_r: string, _e: string) =>
      Promise.resolve(),
    ),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Chrome nền đọc số dư csgoempire', () => {
  it('lần đầu mở trang Match betting và lấy phản hồi metadata trang tự gọi; ghi Redis không có email', async () => {
    const b = browser(ok);
    const s = sink();
    const log = vi.fn();
    const w = new EmpireBalanceWatcher(s, log);
    const r = await w.readNow('empire-1');
    expect(r).toMatchObject({ cash: 50, coins: 100, email: 'me@example.test' });
    expect(b.page.goto.mock.calls[0][0]).toBe(
      'https://csgoempire.com/match-betting',
    );
    expect(b.page.evaluate).not.toHaveBeenCalled();
    expect(mocks.launch).toHaveBeenCalledWith('empire-1', {
      slotWaitMs: 15_000,
      visible: true,
    });
    const saved = s.saveEmpireBalance.mock.calls[0];
    expect(saved[0]).toMatch(/^csgoempire:/);
    expect(saved[1]).toMatchObject({ cash: 50, coins: 100 });
    expect(JSON.stringify(saved[1])).not.toContain('me@example.test');
    await w.closeAll();
  });

  it('metadata đầu tiên còn guest ngay sau login: đọc lại trước khi báo phiên hết hạn', async () => {
    const b = browser({ meta: [200, {}], rates: [200, rates] });
    const s = sink();
    const w = new EmpireBalanceWatcher(s);
    const r = await w.readNow('empire-guest-race');
    expect(r).toMatchObject({ cash: 50, email: 'me@example.test' });
    expect(b.page.waitForTimeout).toHaveBeenCalledWith(750);
    expect(b.page.evaluate).toHaveBeenCalledOnce();
    expect(s.saveEmpireBalanceError).not.toHaveBeenCalled();
    await w.closeAll();
  });

  it('các lần sau: fetch trong trang kèm ĐÚNG header riêng của trang (không cookie), không mở lại trang; không log giá trị header', async () => {
    const b = browser(ok);
    const log = vi.fn();
    const w = new EmpireBalanceWatcher(sink(), log);
    await w.readNow('empire-7');
    expect((await w.readNow('empire-7')).cash).toBe(50);
    expect(b.page.goto).toHaveBeenCalledOnce();
    // chỉ gọi metadata: tỷ giá (gần như cố định) dùng lại từ lần đọc trước trong 60 giây
    expect(b.page.evaluate).toHaveBeenCalledOnce();
    const sent = b.page.evaluate.mock.calls[0][1];
    expect(sent.url).toBe('/api/v2/metadata');
    expect(sent.headers).toEqual({
      'x-empire-device-identifier': 'dev-123',
      'x-env-class': 'blue',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('dev-123');
    await w.closeAll();
  });

  it('fetch kèm header bị từ chối: mở lại trang, lấy header mới rồi đọc tiếp', async () => {
    const b = browser(ok);
    const w = new EmpireBalanceWatcher(sink());
    await w.readNow('empire-8');
    b.page.fetchOk = false;
    expect((await w.readNow('empire-8')).cash).toBe(50);
    expect(b.page.goto).toHaveBeenCalledTimes(2);
    await w.closeAll();
  });

  it('sai tài khoản (sàn trả email khác tài khoản đã lưu): lưu lỗi để worker từ chối vào lệnh', async () => {
    browser(ok);
    const s = sink();
    const w = new EmpireBalanceWatcher(s);
    await expect(w.readNow('empire-9', 'other@example.test')).rejects.toThrow(
      'CSGOEMPIRE_ACCOUNT_MISMATCH',
    );
    expect(s.saveEmpireBalance).not.toHaveBeenCalled();
    expect(s.saveEmpireBalanceError).toHaveBeenCalledWith(
      expect.stringMatching(/^csgoempire:/),
      expect.stringContaining('CSGOEMPIRE_ACCOUNT_MISMATCH'),
    );
    // đúng tài khoản (khác hoa/thường, khoảng trắng) thì đọc bình thường
    expect((await w.readNow('empire-9', ' Me@Example.test ')).cash).toBe(50);
    await w.closeAll();
  });

  it('Chrome mở lại sau khi nhường hồ sơ: không fetch trên about:blank bằng header cũ, mở lại trang Match betting', async () => {
    const b = browser(ok);
    const w = new EmpireBalanceWatcher(sink());
    await w.readNow('empire-10');
    w.want('empire-10');
    await w.pause('empire-10');
    w.resume('empire-10');
    // Chrome mới: trang trắng
    b.page.current = 'about:blank';
    b.page.evaluate.mockClear();
    b.page.goto.mockClear();
    expect((await w.readNow('empire-10')).cash).toBe(50);
    expect(b.page.goto).toHaveBeenCalledWith(
      'https://csgoempire.com/match-betting',
      expect.anything(),
    );
    await w.closeAll();
  });

  it('fetch trong trang ném lỗi (trang đổi): không báo lỗi ngay mà mở lại trang và đọc', async () => {
    const b = browser(ok);
    const w = new EmpireBalanceWatcher(sink());
    await w.readNow('empire-11');
    b.page.evaluate.mockRejectedValueOnce(
      new TypeError("Failed to execute 'fetch' on 'Window'"),
    );
    expect((await w.readNow('empire-11')).cash).toBe(50);
    expect(b.page.goto).toHaveBeenCalledTimes(2);
    await w.closeAll();
  });

  it('Chrome nền chặn đúng endpoint cấp phiên BetBy mới, vẫn cho API số dư và Sptpub tải giao diện', async () => {
    const b = browser(ok);
    const w = new EmpireBalanceWatcher(sink());
    await w.readNow('empire-12');
    expect(b.context.route).toHaveBeenCalledOnce();
    const match = b.context.route.mock.calls[0][0];
    const blocked = (u: string) => match(new URL(u));
    expect(
      blocked(
        'https://csgoempire.com/api/v2/match-betting/betby/user-session/abc',
      ),
    ).toBe(true);
    expect(
      blocked(
        'https://api-h-c7818b61-608.sptpub.com/api/v2/auth/brand/1/identify',
      ),
    ).toBe(false);
    expect(blocked('https://csgoempire.com/api/v2/metadata')).toBe(false);
    expect(
      blocked('https://csgoempire.com/api/v2/metadata/exchange-rates'),
    ).toBe(false);
    expect(blocked('https://csgoempire.com/match-betting')).toBe(false);
    await w.closeAll();
  });

  it('đóng tab roulette được profile khôi phục và chỉ dùng tab mới có route bảo vệ', async () => {
    const b = browser(ok);
    const restored = { close: vi.fn(() => Promise.resolve()) };
    b.context.pages = () => [restored as never];
    const w = new EmpireBalanceWatcher(sink());
    await w.readNow('empire-restored-roulette');
    expect(restored.close).toHaveBeenCalledOnce();
    expect(b.page.bringToFront).toHaveBeenCalledOnce();
    expect(b.page.goto).toHaveBeenCalledWith(
      'https://csgoempire.com/match-betting',
      expect.anything(),
    );
    await w.closeAll();
  });

  it('đọc nhanh (mặc định 2 giây); lỗi liên tiếp thì giãn nhịp 4s → 8s… để không dội sàn, đọc được thì về nhịp thường', async () => {
    vi.useFakeTimers();
    browser({ meta: [403, null] });
    const s = sink();
    const w = new EmpireBalanceWatcher(s, () => undefined, 2_000, 600_000);
    w.want('empire-13');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.launch).toHaveBeenCalledTimes(1); // lần 1 lỗi → chờ 4s
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.launch).toHaveBeenCalledTimes(1); // nhịp 2s bị bỏ qua vì đang giãn
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.launch).toHaveBeenCalledTimes(2); // lần 2 lỗi → chờ 8s
    await vi.advanceTimersByTimeAsync(6_000);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    // sàn hết từ chối
    browser(ok);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.launch).toHaveBeenCalledTimes(3);
    expect(s.saveEmpireBalance).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.saveEmpireBalance).toHaveBeenCalledTimes(2); // về nhịp 2 giây
    await w.closeAll();
  });

  it('trang không tự gọi tỷ giá: lấy tỷ giá bằng fetch trong trang', async () => {
    const b = browser({ meta: [200, meta] });
    const w = new EmpireBalanceWatcher(sink());
    expect((await w.readNow('empire-2')).cash).toBe(50);
    expect(b.page.evaluate).toHaveBeenCalledOnce();
    await w.closeAll();
  });

  it('trang không gọi metadata: báo rõ, không đoán số dư', async () => {
    browser({ rates: [200, rates] });
    const w = new EmpireBalanceWatcher(sink());
    await expect(w.readNow('empire-6')).rejects.toThrow(
      'không gọi /api/v2/metadata',
    );
    await w.closeAll();
  });

  it('đọc lỗi: ghi lý do vào Redis (worker báo đúng), đóng Chrome để lần sau mở lại sạch', async () => {
    const b = browser({ meta: [403, null], rates: [200, rates] });
    const s = sink();
    const log = vi.fn();
    const w = new EmpireBalanceWatcher(s, log);
    await expect(w.readNow('empire-3')).rejects.toThrow(
      'CSGOEMPIRE_BALANCE_READ_FAILED: metadata (trang tự gọi) HTTP 403 (text/html',
    );
    expect(s.saveEmpireBalanceError).toHaveBeenCalledWith(
      expect.stringMatching(/^csgoempire:/),
      expect.stringContaining('metadata (trang tự gọi) HTTP 403'),
    );
    expect(b.context.close).toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
    await w.closeAll();
  });

  it('nhường hồ sơ khi làm mới phiên: đóng Chrome, không mở lại khi đang nhường, mở lại sau đó', async () => {
    vi.useFakeTimers();
    const b = browser(ok);
    const w = new EmpireBalanceWatcher(sink(), undefined, 1_000, 60_000);
    w.want('empire-4');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.launch).toHaveBeenCalledOnce();
    await w.pause('empire-4');
    expect(b.context.close).toHaveBeenCalledOnce();
    expect(mocks.closeProfile).toHaveBeenCalledWith('empire-4');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocks.launch).toHaveBeenCalledOnce();
    await expect(w.readNow('empire-4')).rejects.toThrow(
      'CSGOEMPIRE_LOGIN_IN_PROGRESS',
    );
    w.resume('empire-4');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    await w.closeAll();
  });

  it('không còn profile chạy thật nào cần: tự đóng Chrome sau thời gian chờ', async () => {
    vi.useFakeTimers();
    const b = browser(ok);
    const w = new EmpireBalanceWatcher(sink(), undefined, 1_000, 5_000);
    w.want('empire-5');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.openCount).toBe(1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(b.context.close).toHaveBeenCalled();
    expect(w.openCount).toBe(0);
    await w.closeAll();
  });
});
