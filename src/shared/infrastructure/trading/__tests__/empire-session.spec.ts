import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserSlotUsage,
  closeAllProfiles,
  closeProfile,
  EmpireSessions,
  launchProfile,
} from '../empire-session.js';
import type { AccountLock } from '../account-lock.js';
import type { Response as BrowserResponse } from 'playwright';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  nativeLaunch: vi.fn(),
  revision: vi.fn(() => Promise.resolve('revision-1')),
  selectUsd: vi.fn(),
}));
vi.mock('playwright', () => ({
  chromium: { launchPersistentContext: mocks.nativeLaunch },
}));
vi.mock('../selenium-browser.js', () => ({
  launchSeleniumContext: mocks.launch,
}));
vi.mock('../empire-currency.js', () => ({
  selectUsdSession: mocks.selectUsd,
}));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: mocks.revision,
  writeFile: vi.fn(),
}));

function setup(lifetimeMinutes = 30) {
  let sequence = 0;
  const close = vi.fn(() => Promise.resolve());
  const absent = {
    first: () => absent,
    filter: () => absent,
    isVisible: () => Promise.resolve(false),
  };
  const page = {
    on: vi.fn(),
    off: vi.fn(),
    getByRole: (_role: string) => absent,
    getByText: (_text: RegExp) => absent,
    locator: (_selector: string) => absent,
    goto: vi.fn(() => Promise.resolve()),
    waitForResponse: vi.fn(
      (
        _predicate: (response: BrowserResponse) => boolean | Promise<boolean>,
      ) => {
        const iat = Math.floor(Date.now() / 1000);
        const body = Buffer.from(
          JSON.stringify({
            iat,
            exp: iat + lifetimeMinutes * 60,
            currency: 'USD',
          }),
        ).toString('base64url');
        const token = `test.${body}.signature-${++sequence}`;
        return Promise.resolve({
          ok: () => true,
          status: () => 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { token },
            }),
        });
      },
    ),
  };
  mocks.launch.mockImplementation(() =>
    Promise.resolve({
      pages: () => [page],
      cookies: () => Promise.resolve([{ name: 'unit-session', value: 'test' }]),
      close,
      once: vi.fn(),
    }),
  );
  const identify = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    () => Promise.resolve(Response.json({ currency: 'USD' })),
  );
  vi.stubGlobal('fetch', identify);
  const locks = {
    with: vi.fn((_keys: readonly string[], run: () => Promise<unknown>) =>
      run(),
    ),
  };
  return {
    sessions: new EmpireSessions(locks as unknown as AccountLock),
    locks,
    close,
    identify,
    page,
  };
}

beforeEach(() => {
  vi.stubEnv('TRADING_BROWSER_ENGINE', 'seleniumbase');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('browser profile lifecycle', () => {
  it('starts SeleniumBase only on demand and closes the same profile once', async () => {
    const s = setup();
    const context = await launchProfile('lifecycle');
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.stringContaining('lifecycle'),
      expect.objectContaining({
        headless: true,
        signal: expect.any(AbortSignal) as unknown,
      }),
    );
    expect(() => launchProfile('lifecycle')).toThrow('BROWSER_PROFILE_IN_USE');
    await Promise.all([context.close(), closeProfile('lifecycle')]);
    expect(s.close).toHaveBeenCalledOnce();
    await closeProfile('lifecycle');
    mocks.revision.mockResolvedValueOnce('{}');
    const reopened = await launchProfile('lifecycle', {
      login: true,
      port: 9222,
    });
    expect(mocks.launch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ headless: false, port: 9222 }),
    );
    await reopened.close();
    expect(s.close).toHaveBeenCalledTimes(2);
  });

  it('cancels startup and releases the profile for another launch', async () => {
    const s = setup();
    let entered: () => void = () => undefined;
    const launching = new Promise<void>((resolve) => {
      entered = resolve;
    });
    mocks.launch.mockImplementationOnce(
      (_path: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          );
          entered();
        }),
    );
    const starting = launchProfile('startup-cancel');
    const rejected = expect(starting).rejects.toThrow('cancelled');
    await launching;
    await closeProfile('startup-cancel');
    await rejected;
    await (await launchProfile('startup-cancel')).close();
    expect(s.close).toHaveBeenCalledOnce();
  });

  it('closes all active profiles without keeping browsers idle', async () => {
    const s = setup();
    await Promise.all([launchProfile('all-a'), launchProfile('all-b')]);
    await closeAllProfiles();
    await closeAllProfiles();
    expect(s.close).toHaveBeenCalledTimes(2);
  });

  it('keeps native Playwright for HAR capture', async () => {
    setup();
    mocks.nativeLaunch.mockImplementation(
      mocks.launch.getMockImplementation()!,
    );
    const context = await launchProfile('har-profile', { har: 'unit.har' });
    expect(mocks.nativeLaunch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        recordHar: { path: 'unit.har', mode: 'full' },
      }),
    );
    expect(mocks.launch).not.toHaveBeenCalled();
    await context.close();
  });
});

describe('csgoempire session refresh', () => {
  it.each(['EMP', 'EUR', 'GBP'])(
    'switches %s through the site UI and identifies only the replacement USD token',
    async (currency) => {
      const s = setup();
      const normal = s.page.waitForResponse.getMockImplementation()!;
      const usd = await normal(() => true);
      const initialToken = `test.${Buffer.from(
        JSON.stringify({
          exp: 4_000_000_000,
          currency,
        }),
      ).toString('base64url')}.old`;
      s.page.waitForResponse.mockResolvedValueOnce({
        ok: () => true,
        status: () => 200,
        json: () =>
          Promise.resolve({ success: true, data: { token: initialToken } }),
      });
      mocks.selectUsd.mockResolvedValueOnce(usd);
      const diagnostic = vi.fn();
      const session = await s.sessions.get('switch-currency', {
        onDiagnostic: diagnostic,
      });
      expect(mocks.selectUsd).toHaveBeenCalledOnce();
      expect(diagnostic).toHaveBeenCalledWith({ step: 'currency' });
      expect(session.token).toBe((await usd.json()).data.token);
      expect(s.identify.mock.lastCall?.[1].headers).toMatchObject({
        Authorization: `Bearer ${session.token}`,
      });
      expect(s.close).toHaveBeenCalledOnce();
    },
  );

  it('does not reopen the currency picker when the saved profile already returns USD', async () => {
    const s = setup();
    await s.sessions.get('already-usd');
    expect(mocks.selectUsd).not.toHaveBeenCalled();
  });

  it('still rejects a non-USD token after the currency switch', async () => {
    const s = setup();
    const token = `test.${Buffer.from(
      JSON.stringify({
        exp: 4_000_000_000,
        currency: 'EMP',
      }),
    ).toString('base64url')}.old`;
    const response = {
      ok: () => true as const,
      status: () => 200 as const,
      json: () => Promise.resolve({ success: true, data: { token } }),
    };
    s.page.waitForResponse.mockResolvedValueOnce(response);
    mocks.selectUsd.mockResolvedValueOnce(response);
    await expect(s.sessions.get('still-emp')).rejects.toThrow(
      'CSGOEMPIRE_SESSION_INVALID',
    );
    expect(mocks.selectUsd).toHaveBeenCalledOnce();
    expect(s.identify).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledOnce();
  });

  it.each([
    { currency: 'USD', issue: 'expiry_invalid' },
    { currency: 'USD', exp: 'invalid', issue: 'expiry_invalid' },
    { currency: 'USD', exp: 1, issue: 'expiry_too_short' },
    { exp: 4_000_000_000, issue: 'currency_missing' },
    { exp: 4_000_000_000, currency: 'JPY', issue: 'currency_unsupported' },
  ])(
    'explains a rejected JWT as $issue without exposing the token',
    async ({ issue, ...claims }) => {
      const s = setup();
      const token = `test.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.private-signature`;
      s.page.waitForResponse.mockResolvedValueOnce({
        ok: () => true,
        status: () => 200,
        json: () => Promise.resolve({ success: true, data: { token } }),
      });
      const diagnostic = vi.fn();
      await expect(
        s.sessions.get('invalid-claims', { onDiagnostic: diagnostic }),
      ).rejects.toThrow('CSGOEMPIRE_SESSION_INVALID');
      expect(diagnostic).toHaveBeenLastCalledWith({
        step: 'jwt',
        httpStatus: 200,
        sessionIssue: issue,
      });
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
        'private-signature',
      );
      expect(s.identify).not.toHaveBeenCalled();
      expect(s.close).toHaveBeenCalledOnce();
    },
  );

  it('reports malformed token payloads as session validation errors', async () => {
    const s = setup();
    s.page.waitForResponse.mockResolvedValueOnce({
      ok: () => true,
      status: () => 200,
      json: () =>
        Promise.resolve({ success: true, data: { token: 'not-a-jwt' } }),
    });
    const diagnostic = vi.fn();
    await expect(
      s.sessions.get('malformed-claims', { onDiagnostic: diagnostic }),
    ).rejects.toThrow('CSGOEMPIRE_SESSION_INVALID');
    expect(diagnostic).toHaveBeenLastCalledWith({
      step: 'jwt',
      httpStatus: 200,
      sessionIssue: 'token_malformed',
    });
    expect(s.close).toHaveBeenCalledOnce();
  });

  it('distinguishes identify currency errors from JWT claim errors', async () => {
    const s = setup();
    s.identify.mockResolvedValueOnce(Response.json({ currency: 'EUR' }));
    const diagnostic = vi.fn();
    await expect(
      s.sessions.get('identify-currency', { onDiagnostic: diagnostic }),
    ).rejects.toThrow('CSGOEMPIRE_SESSION_INVALID');
    expect(diagnostic).toHaveBeenLastCalledWith({
      step: 'identify',
      httpStatus: 200,
      sessionIssue: 'identify_currency_unsupported',
    });
    expect(s.close).toHaveBeenCalledOnce();
  });
  it('starts the JWT timeout after slow navigation, then closes the browser and clears timers', async () => {
    const s = setup();
    s.page.goto.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 40_000)),
    );
    s.page.waitForResponse.mockImplementation(
      () => new Promise(() => undefined),
    );
    const diagnostic = vi.fn();
    const session = s.sessions.get('jwt-timeout', { onDiagnostic: diagnostic });
    const rejected = expect(session).rejects.toThrow(
      'CSGOEMPIRE_SESSION_RESPONSE_FAILED',
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(diagnostic).toHaveBeenLastCalledWith({ step: 'page' });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(diagnostic).toHaveBeenLastCalledWith({ step: 'jwt' });
    expect(s.page.waitForResponse).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 0,
    });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(s.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(s.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reuses the in-memory JWT, then refreshes with 10 minutes left and identifies the new token', async () => {
    const s = setup();
    const start = Date.now();
    const first = await s.sessions.get('empire-test');
    vi.setSystemTime(start + 20 * 60_000 - 1);
    expect(await s.sessions.get('empire-test')).toBe(first);
    expect(mocks.launch).toHaveBeenCalledOnce();

    vi.setSystemTime(start + 20 * 60_000);
    const next = await s.sessions.get('empire-test');
    expect(next.token).not.toBe(first.token);
    expect(next.expiresAt).toBe(start + 50 * 60_000);
    expect(s.identify.mock.lastCall?.[0]).toContain('/identify');
    expect(s.identify.mock.lastCall?.[1].headers).toMatchObject({
      Authorization: `Bearer ${next.token}`,
    });
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(s.close).toHaveBeenCalledTimes(2);
    expect(await s.sessions.get('empire-test')).toBe(next);
  });

  it('does not open Chromium on every poll for tokens with a lifetime below 10 minutes', async () => {
    const s = setup(5);
    const start = Date.now();
    const first = await s.sessions.get('empire-short');
    vi.setSystemTime(start + 4 * 60_000 - 1);
    expect(await s.sessions.get('empire-short')).toBe(first);
    vi.setSystemTime(start + 4 * 60_000);
    expect((await s.sessions.get('empire-short')).token).not.toBe(first.token);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });

  it('reuses saved browser cookies after a backend restart but obtains a fresh JWT', async () => {
    const s = setup();
    const first = await s.sessions.get('empire-test');
    const restarted = new EmpireSessions(s.locks as unknown as AccountLock);
    const next = await restarted.get('empire-test');
    expect(next.token).not.toBe(first.token);
    expect(next.cookie).toBe('unit-session=test');
    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });

  it('reports navigation failures instead of claiming that the login expired', async () => {
    const s = setup();
    s.page.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_RESET'));
    const diagnostic = vi.fn();
    await expect(
      s.sessions.get('empire-test', { onDiagnostic: diagnostic }),
    ).rejects.toThrow('CSGOEMPIRE_PAGE_NAVIGATION_FAILED');
    expect(diagnostic).toHaveBeenLastCalledWith({ step: 'page' });
    expect(s.close).toHaveBeenCalledOnce();
  });

  it('distinguishes an identify rejection from an expired login and exposes only the HTTP status', async () => {
    const s = setup();
    s.identify.mockResolvedValue(Response.json({}, { status: 403 }));
    const diagnostic = vi.fn();
    await expect(
      s.sessions.get('empire-test', { onDiagnostic: diagnostic }),
    ).rejects.toThrow('CSGOEMPIRE_SESSION_IDENTIFY_FAILED');
    expect(diagnostic).toHaveBeenLastCalledWith({
      step: 'identify',
      httpStatus: 403,
    });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(
      /signature|Bearer|unit-session/,
    );
  });

  it('reports a real HTTP 401 as an expired session', async () => {
    const s = setup();
    s.identify.mockResolvedValue(Response.json({}, { status: 401 }));
    await expect(s.sessions.get('empire-test')).rejects.toThrow(
      'CSGOEMPIRE_SESSION_EXPIRED',
    );
  });

  it('does not call an access restriction an expired token', async () => {
    const s = setup();
    s.identify.mockResolvedValue(
      Response.json({ currency: 'USD', geo: { blocked: true } }),
    );
    await expect(s.sessions.get('empire-test')).rejects.toThrow(
      'CSGOEMPIRE_SESSION_ACCESS_BLOCKED',
    );
  });

  it.each(['', '   ', null, undefined])(
    'ignores HTTP 200 guest responses with token %s and waits for a real JWT',
    async (guestToken) => {
      const s = setup();
      const normalResponse = s.page.waitForResponse.getMockImplementation()!;
      s.page.waitForResponse.mockImplementation(async (predicate) => {
        const guest = {
          url: () =>
            'https://csgoempire.com/api/v2/match-betting/betby/user-session/en/USD/EMP',
          ok: () => true,
          json: () =>
            Promise.resolve({ success: true, data: { token: guestToken } }),
        };
        expect(await predicate(guest as unknown as BrowserResponse)).toBe(
          false,
        );
        const response = await normalResponse(predicate);
        const loggedIn = {
          ...response,
          url: guest.url,
        };
        expect(await predicate(loggedIn as unknown as BrowserResponse)).toBe(
          true,
        );
        return loggedIn;
      });
      expect((await s.sessions.get('empire-test')).token).toMatch(/^test\./);
      expect(s.identify).toHaveBeenCalledOnce();
    },
  );

  it('keeps typing and submitting after a guest response, then verifies the actual authenticated JWT', async () => {
    const s = setup();
    const normalResponse = s.page.waitForResponse.getMockImplementation()!;
    type StubResponse = Awaited<ReturnType<typeof normalResponse>>;
    let match: (response: BrowserResponse) => boolean | Promise<boolean> = () =>
      false;
    let received: (response: StubResponse) => void = () => {
      throw new Error('Session response listener was not installed');
    };
    s.page.waitForResponse.mockImplementation((predicate) => {
      match = predicate;
      return new Promise<StubResponse>((resolve) => {
        received = resolve;
      });
    });
    const sessionUrl = () =>
      'https://csgoempire.com/api/v2/match-betting/betby/user-session/en/USD/EMP';
    s.page.goto.mockImplementation(async () => {
      const guest = {
        url: sessionUrl,
        ok: () => true,
        json: () => Promise.resolve({ success: true, data: { token: '' } }),
      };
      expect(await match(guest as unknown as BrowserResponse)).toBe(false);
    });
    const element = (visible: boolean) => {
      const locator = {
        first: () => locator,
        or: () => locator,
        filter: () => locator,
        isVisible: () => Promise.resolve(visible),
        fill: vi.fn((_text: string) => Promise.resolve()),
        pressSequentially: vi.fn((_text: string, _options: { delay: number }) =>
          Promise.resolve(),
        ),
        count: () => Promise.resolve(1),
        click: vi.fn(() => Promise.resolve()),
      };
      return locator;
    };
    const username = element(true);
    const password = element(true);
    const absent = element(false);
    const submit = element(true);
    submit.click.mockImplementation(async () => {
      const response = await normalResponse(match);
      const authenticated = { ...response, url: sessionUrl };
      expect(await match(authenticated as unknown as BrowserResponse)).toBe(
        true,
      );
      received(authenticated);
    });
    const page = {
      ...s.page,
      url: () => 'https://csgoempire.com/match-betting',
      isClosed: () => false,
      getByText: () => absent,
      getByRole: (role: string) => (role === 'textbox' ? username : absent),
      locator: (selector: string) =>
        selector === '#auth-login-submit:visible'
          ? submit
          : selector.includes('input[type="password"]')
            ? password
            : absent,
      waitForTimeout: () => Promise.resolve(),
    };
    mocks.launch.mockResolvedValue({
      pages: () => [page],
      cookies: () => Promise.resolve([{ name: 'unit-session', value: 'test' }]),
      close: s.close,
      once: vi.fn(),
    });
    s.identify.mockImplementation((url) =>
      Promise.resolve(
        Response.json(
          url.endsWith('/identify')
            ? { currency: 'USD' }
            : { success: true, email: 'unit@example.test' },
        ),
      ),
    );
    const result = await s.sessions.get('empire-test', {
      credentials: { username: 'unit@example.test', password: 'unit-password' },
    });
    expect(username.pressSequentially).toHaveBeenCalledWith(
      'unit@example.test',
      { delay: 70 },
    );
    expect(password.pressSequentially).toHaveBeenCalledWith('unit-password', {
      delay: 70,
    });
    expect(submit.click).toHaveBeenCalledOnce();
    expect(result.token).toMatch(/^test\./);
    expect(s.identify).toHaveBeenCalledTimes(2);
    expect(s.close).toHaveBeenCalledOnce();
  });
});

describe('nhiều tài khoản / nhiều lời gọi cùng lúc', () => {
  it('hai lời gọi trùng một hồ sơ dùng chung MỘT lần làm mới (một Chrome)', async () => {
    const s = setup();
    const [a, b] = await Promise.all([
      s.sessions.get('same-profile'),
      s.sessions.get('same-profile'),
    ]);
    expect(a).toBe(b);
    expect(mocks.launch).toHaveBeenCalledOnce();
    expect(s.locks.with).toHaveBeenCalledOnce();
  });

  it('hai tài khoản khác nhau: mỗi cái một Chrome, một hồ sơ, một khóa riêng', async () => {
    const s = setup();
    const [a, b] = await Promise.all([
      s.sessions.get('empire-a'),
      s.sessions.get('empire-b'),
    ]);
    expect(a.browserProfile).toBe('empire-a');
    expect(b.browserProfile).toBe('empire-b');
    expect(a.token).not.toBe(b.token);
    const dirs = mocks.launch.mock.calls.map((c) => String(c[0]));
    expect(dirs).toHaveLength(2);
    expect(new Set(dirs).size).toBe(2);
    const keys = s.locks.with.mock.calls.map((c) => c[0][0]);
    expect(new Set(keys).size).toBe(2);
    expect(browserSlotUsage().inUse).toBe(0);
  });

  it('giới hạn số Chrome: hồ sơ thứ hai chờ chỗ, hết hạn chờ thì báo BROWSER_SLOTS_BUSY', async () => {
    const s = setup();
    vi.stubEnv('TRADING_MAX_BROWSERS', '1');
    const first = await launchProfile('cap-a');
    expect(browserSlotUsage()).toMatchObject({ max: 1, inUse: 1 });
    const timedOut = expect(
      launchProfile('cap-b', { slotWaitMs: 1_000 }),
    ).rejects.toThrow('BROWSER_SLOTS_BUSY');
    const waiting = launchProfile('cap-c');
    await vi.advanceTimersByTimeAsync(1_000);
    await timedOut;
    expect(mocks.launch).toHaveBeenCalledOnce();
    await first.close();
    const third = await waiting;
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    await third.close();
    expect(browserSlotUsage()).toMatchObject({ inUse: 0, waiting: 0 });
    expect(s.close).toHaveBeenCalledTimes(2);
  });

  it('làm mới lỗi tạm thời mà token cũ còn hạn: dùng tiếp token cũ, thử lại sau 1 phút', async () => {
    const s = setup();
    const stale = vi.fn();
    const sessions = new EmpireSessions(
      s.locks as unknown as AccountLock,
      stale,
    );
    const start = Date.now();
    const first = await sessions.get('flaky');
    vi.setSystemTime(start + 20 * 60_000);
    s.page.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_RESET'));
    expect(await sessions.get('flaky')).toBe(first);
    expect(stale).toHaveBeenCalledWith(
      'flaky',
      'CSGOEMPIRE_PAGE_NAVIGATION_FAILED',
    );
    // trong 1 phút: không mở Chrome lại
    expect(await sessions.get('flaky')).toBe(first);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    // sau 1 phút: thử lại, mạng đã ổn → token mới
    s.page.goto.mockResolvedValue(undefined);
    vi.setSystemTime(start + 21 * 60_000);
    const next = await sessions.get('flaky');
    expect(next.token).not.toBe(first.token);
    expect(mocks.launch).toHaveBeenCalledTimes(3);
  });

  it('tài khoản đang bận (khóa) khi làm mới: dùng tiếp token cũ thay vì đứng yên', async () => {
    const s = setup();
    const start = Date.now();
    const first = await s.sessions.get('busy');
    vi.setSystemTime(start + 20 * 60_000);
    s.locks.with.mockRejectedValueOnce(new Error('ACCOUNT_BUSY: bận'));
    expect(await s.sessions.get('busy')).toBe(first);
  });

  it('không dùng token cũ khi lỗi là lâu dài (phiên hết hạn) hoặc token sắp hết', async () => {
    const s = setup();
    const start = Date.now();
    await s.sessions.get('expired');
    await s.sessions.get('ending');
    vi.setSystemTime(start + 20 * 60_000);
    s.identify.mockResolvedValue(Response.json({}, { status: 401 }));
    await expect(s.sessions.get('expired')).rejects.toThrow(
      'CSGOEMPIRE_SESSION_EXPIRED',
    );

    s.identify.mockResolvedValue(Response.json({ currency: 'USD' }));
    // còn dưới 2 phút: không đủ an toàn để vào lệnh bằng token cũ
    vi.setSystemTime(start + 29 * 60_000);
    s.page.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_RESET'));
    await expect(s.sessions.get('ending')).rejects.toThrow(
      'CSGOEMPIRE_PAGE_NAVIGATION_FAILED',
    );
  });

  it('đăng nhập tay (force) chờ lần làm mới nền xong rồi mới mở Chrome của mình', async () => {
    const s = setup();
    let open = 0;
    let maxOpen = 0;
    const impl = mocks.launch.getMockImplementation()!;
    mocks.launch.mockImplementation((...args: unknown[]) => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      return (
        impl as (...a: unknown[]) => Promise<{ close: () => Promise<void> }>
      )(...args).then((ctx) => ({
        ...ctx,
        close: () => {
          open--;
          return ctx.close();
        },
      }));
    });
    const [bg, manual] = await Promise.all([
      s.sessions.get('ordered'),
      s.sessions.get('ordered', { force: true }),
    ]);
    expect(manual.token).not.toBe(bg.token);
    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(maxOpen).toBe(1);
  });
});
