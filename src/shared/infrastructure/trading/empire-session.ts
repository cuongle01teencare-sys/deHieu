import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext } from 'playwright';
import type { LiveTradingConfig } from '../../application/live-trading.js';
import { accountResource, type AccountLock } from './account-lock.js';
import { autoLogin, assertNoVerification } from './empire-auto-login.js';
import { launchSeleniumContext } from './selenium-browser.js';
import { selectUsdSession } from './empire-currency.js';
import type {
  EmpireCredentials,
  EmpireLoginStage,
  EmpireLoginDiagnostic,
} from '../../application/empire-login.js';

export const SESSION_EXPIRED =
  'CSGOEMPIRE_SESSION_EXPIRED: Phiên csgoempire hết hạn';
const REFRESH_BEFORE_EXPIRY_MS = 10 * 60_000;
/** Làm mới hỏng vì lý do tạm thời: vẫn dùng token cũ nếu còn ít nhất chừng này. */
const STALE_TOKEN_MARGIN_MS = 2 * 60_000;
/** ...và thử làm mới lại sau chừng này (không mở Chrome liên tục khi sàn / máy đang chập chờn). */
const RETRY_AFTER_FAILURE_MS = 60_000;
/** Chờ khóa tài khoản (vd đang có lệnh đặt) thay vì báo bận ngay. */
const LOCK_WAIT_MS = 20_000;
/** Làm mới nền chờ chỗ mở Chrome tối đa chừng này; đăng nhập tay thì chờ tới khi có chỗ / bị hủy. */
const BACKGROUND_SLOT_WAIT_MS = 60_000;

export interface EmpireSessionOptions {
  credentials?: EmpireCredentials;
  credentialsVersion?: string;
  headed?: boolean;
  force?: boolean;
  signal?: AbortSignal;
  onStage?: (stage: EmpireLoginStage) => void;
  onDiagnostic?: (diagnostic: EmpireLoginDiagnostic) => void;
}
type EmpireSession = LiveTradingConfig['empire'];
const STEP_FAILURE: Record<EmpireLoginDiagnostic['step'], string> = {
  browser: 'CSGOEMPIRE_BROWSER_UNAVAILABLE',
  page: 'CSGOEMPIRE_PAGE_NAVIGATION_FAILED',
  login: 'CSGOEMPIRE_LOGIN_FLOW_FAILED',
  currency: 'CSGOEMPIRE_CURRENCY_SWITCH_FAILED',
  jwt: 'CSGOEMPIRE_SESSION_RESPONSE_FAILED',
  identify: 'CSGOEMPIRE_SESSION_IDENTIFY_FAILED',
  account: 'CSGOEMPIRE_SESSION_ACCOUNT_FAILED',
};
function sessionToken(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as { success?: unknown; data?: { token?: unknown } };
  const token = payload.data?.token;
  return payload.success === true && typeof token === 'string' && token.trim()
    ? token.trim()
    : null;
}
export function profilePath(name: string): string {
  if (!/^[\w.-]{1,64}$/.test(name) || name === '.' || name === '..')
    throw new Error('BROWSER_PROFILE_INVALID');
  const root = resolve(process.env.TRADING_BROWSER_ROOT ?? '.trading/profiles');
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) throw new Error('BROWSER_PROFILE_INVALID');
  return path;
}

export interface LaunchProfileOptions {
  login?: boolean;
  port?: number;
  har?: string;
  signal?: AbortSignal;
  /**
   * Chờ tối đa chừng này để có chỗ mở Chrome (giới hạn TRADING_MAX_BROWSERS). Bỏ trống = chờ tới
   * khi có chỗ hoặc bị hủy (đăng nhập tay); làm mới phiên nền đặt hạn để không treo hàng đợi.
   */
  slotWaitMs?: number;
}

/** Số Chrome tối đa cùng mở trong một tiến trình (mỗi cái vài trăm MB RAM). */
export const maxBrowsers = () => {
  const n = Number(process.env.TRADING_MAX_BROWSERS ?? 2);
  return Number.isInteger(n) && n >= 1 ? n : 2;
};

/** Hàng chờ chỗ mở Chrome: vào trước được trước, hủy/hết hạn thì rời hàng. */
class BrowserSlots {
  private used = 0;
  private readonly queue: (() => void)[] = [];

  get inUse() {
    return this.used;
  }
  get waiting() {
    return this.queue.length;
  }

  acquire(signal: AbortSignal, waitMs?: number): Promise<() => void> {
    signal.throwIfAborted();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next();
      else this.used--;
    };
    if (this.used < maxBrowsers()) {
      this.used++;
      return Promise.resolve(release);
    }
    return new Promise((resolveSlot, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grant = () => {
        cleanup();
        resolveSlot(release);
      };
      const leave = (error: Error) => {
        const i = this.queue.indexOf(grant);
        if (i >= 0) this.queue.splice(i, 1);
        cleanup();
        reject(error);
      };
      const onAbort = () =>
        leave(
          signal.reason instanceof Error
            ? signal.reason
            : new Error('BROWSER_LAUNCH_ABORTED'),
        );
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (waitMs !== undefined)
        timer = setTimeout(
          () => leave(new Error('BROWSER_SLOTS_BUSY')),
          Math.max(0, waitMs),
        );
      // chỗ được chuyển thẳng cho người chờ: `used` giữ nguyên
      this.queue.push(grant);
    });
  }
}
const browserSlots = new BrowserSlots();

/** Số Chrome đang mở / đang chờ chỗ (để theo dõi). */
export const browserSlotUsage = () => ({
  max: maxBrowsers(),
  inUse: browserSlots.inUse,
  waiting: browserSlots.waiting,
});

const runningProfiles = new Map<
  string,
  { controller: AbortController; context: Promise<BrowserContext> }
>();

/** Start on demand. Call context.close() or closeProfile(name) to release RAM. */
export function launchProfile(
  name: string,
  options: LaunchProfileOptions = {},
): Promise<BrowserContext> {
  const path = profilePath(name);
  if (runningProfiles.has(path)) throw new Error('BROWSER_PROFILE_IN_USE');
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 0 ||
      options.port > 65535)
  )
    throw new Error('BROWSER_DEBUG_PORT_INVALID');
  const controller = new AbortController();
  const forget = () => {
    if (runningProfiles.get(path)?.controller === controller)
      runningProfiles.delete(path);
  };
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  let release: (() => void) | undefined;
  const context = browserSlots
    .acquire(signal, options.slotWaitMs)
    .then((r) => {
      release = r;
      return openProfile(path, { ...options, signal });
    })
    .then(async (context) => {
      const originalClose = context.close.bind(context);
      let closing: Promise<void> | undefined;
      context.close = () =>
        (closing ??= Promise.resolve().then(async () => {
          signal.removeEventListener('abort', onAbort);
          try {
            await originalClose();
          } finally {
            release?.();
            forget();
          }
        }));
      const onAbort = () => {
        void context.close().catch(() => undefined);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      context.once('close', onAbort);
      if (signal.aborted) {
        await context.close();
        signal.throwIfAborted();
      }
      return context;
    })
    .catch((error: unknown) => {
      release?.();
      forget();
      throw error;
    });
  runningProfiles.set(path, { controller, context });
  return context;
}

/** Also cancels startup; repeated shutdown calls are safe. Profiles stay on disk. */
export async function closeProfile(name: string): Promise<void> {
  const running = runningProfiles.get(profilePath(name));
  if (!running) return;
  running.controller.abort();
  const context = await running.context.catch(() => undefined);
  await context?.close();
}

export async function closeAllProfiles(): Promise<void> {
  const results = await Promise.allSettled(
    [...runningProfiles.values()].map(async ({ controller, context }) => {
      controller.abort();
      await (await context.catch(() => undefined))?.close();
    }),
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length)
    throw new AggregateError(
      failed.map((r) => r.reason as unknown),
      'BROWSER_CLOSE_FAILED',
    );
}

async function openProfile(
  path: string,
  options: LaunchProfileOptions & { signal: AbortSignal },
): Promise<BrowserContext> {
  options.signal.throwIfAborted();
  const engine = process.env.TRADING_BROWSER_ENGINE ?? 'seleniumbase';
  if (engine !== 'seleniumbase' && engine !== 'playwright')
    throw new Error('BROWSER_ENGINE_INVALID');
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (options.login) {
    const defaults = resolve(path, 'Default');
    await mkdir(defaults, { recursive: true, mode: 0o700 });
    const preferencesPath = resolve(defaults, 'Preferences');
    const preferences = JSON.parse(
      await readFile(preferencesPath, 'utf8').catch(() => '{}'),
    ) as Record<string, unknown>;
    preferences.credentials_enable_service = false;
    preferences.profile = {
      ...(preferences.profile as Record<string, unknown> | undefined),
      password_manager_enabled: false,
    };
    await writeFile(preferencesPath, JSON.stringify(preferences), {
      mode: 0o600,
    });
  }
  options.signal.throwIfAborted();
  // HAR recording must be configured at context creation, unavailable on CDP's
  // existing persistent context. Keep the native Playwright path for --har.
  if (engine === 'seleniumbase' && !options.har)
    return launchSeleniumContext(path, {
      headless: !options.login && process.env.TRADING_BROWSER_HEADED !== '1',
      port: options.port,
      signal: options.signal,
    });
  return chromium.launchPersistentContext(path, {
    headless: !options.login && process.env.TRADING_BROWSER_HEADED !== '1',
    executablePath: process.env.TRADING_CHROMIUM_PATH || undefined,
    acceptDownloads: false,
    args: [
      '--disable-save-password-bubble',
      '--disable-features=PasswordManagerOnboarding,PasswordLeakDetection',
      ...(options.login && options.port !== undefined
        ? [
            `--remote-debugging-port=${options.port ?? 9222}`,
            '--remote-debugging-address=127.0.0.1',
          ]
        : []),
    ],
    ...(options.har
      ? { recordHar: { path: options.har, mode: 'full' as const } }
      : {}),
  });
}

async function readRevision(name: string) {
  return readFile(resolve(profilePath(name), '.login-ready'), 'utf8').catch(
    () => '',
  );
}
export async function loginReady(name: string) {
  await writeFile(resolve(profilePath(name), '.login-ready'), randomUUID(), {
    mode: 0o600,
  });
}

/** Refresh by letting the site's own session flow obtain its security token. No CAPTCHA bypass. */
export class EmpireSessions {
  private readonly cache = new Map<string, CacheEntry>();
  /** Lần làm mới đang chạy theo hồ sơ: lời gọi trùng dùng chung, không mở Chrome thứ hai. */
  private readonly inflight = new Map<string, Promise<EmpireSession>>();
  constructor(
    private readonly locks: AccountLock,
    /** Báo khi làm mới hỏng tạm thời và đang dùng tiếp token cũ (để ghi log). */
    private readonly onStaleToken?: (
      browserProfile: string,
      error: string,
    ) => void,
  ) {}

  async get(
    browserProfile: string,
    options: EmpireSessionOptions = {},
  ): Promise<EmpireSession> {
    const revision = `${await readRevision(browserProfile)}:${options.credentialsVersion ?? ''}`;
    const cached = this.cache.get(browserProfile);
    const now = Date.now();
    if (!options.force && cached?.revision === revision) {
      if (cached.error) throw new Error(cached.error);
      if (cached.session && now < cached.refreshAt) return cached.session;
      // vừa làm mới hỏng: chưa thử lại, dùng tiếp token cũ còn hạn
      if (
        cached.session &&
        now < (cached.retryAt ?? 0) &&
        usable(cached.session, now)
      )
        return cached.session;
    }
    let running = this.inflight.get(browserProfile);
    if (running && !options.force) return running;
    // đăng nhập tay (force) đợi lần làm mới nền xong rồi mới mở Chrome của mình
    while (running) {
      await running.catch(() => undefined);
      running = this.inflight.get(browserProfile);
    }
    const job = this.refresh(
      browserProfile,
      revision,
      options,
      this.cache.get(browserProfile),
    );
    this.inflight.set(browserProfile, job);
    try {
      return await job;
    } finally {
      if (this.inflight.get(browserProfile) === job)
        this.inflight.delete(browserProfile);
    }
  }

  /**
   * Làm mới; hỏng vì lý do TẠM THỜI (tài khoản bận, hết chỗ mở Chrome, trang / mạng lỗi) mà token cũ
   * còn hạn thì trả token cũ và hẹn thử lại. Lỗi được phân loại là lâu dài (cần đăng nhập lại, sai
   * tài khoản, phiên hết hạn...) vẫn ném ra như cũ.
   */
  private async refresh(
    browserProfile: string,
    revision: string,
    options: EmpireSessionOptions,
    before: CacheEntry | undefined,
  ): Promise<EmpireSession> {
    try {
      return await this.open(browserProfile, revision, options);
    } catch (e) {
      const keep =
        !options.force &&
        !options.signal?.aborted &&
        before?.session &&
        !before.error &&
        before.revision === revision &&
        // open() không ghi lỗi lâu dài vào cache
        this.cache.get(browserProfile) === before &&
        usable(before.session, Date.now());
      if (!keep) throw e;
      const code =
        e instanceof Error
          ? e.message.split(':')[0].trim()
          : 'CSGOEMPIRE_SESSION_REFRESH_FAILED';
      this.cache.set(browserProfile, {
        ...before,
        retryAt: Date.now() + RETRY_AFTER_FAILURE_MS,
        lastError: code,
      });
      this.onStaleToken?.(browserProfile, code);
      return before.session!;
    }
  }

  private open(
    browserProfile: string,
    revision: string,
    options: EmpireSessionOptions,
  ): Promise<EmpireSession> {
    return this.locks.with(
      [accountResource('csgoempire', browserProfile)],
      async () => {
        let context: BrowserContext | undefined;
        const signal = options.signal ?? new AbortController().signal;
        const stage = options.onStage ?? (() => undefined);
        let step: EmpireLoginDiagnostic['step'] = 'browser';
        const checkpoint = (
          next: EmpireLoginDiagnostic['step'],
          httpStatus?: number,
          sessionIssue?: EmpireLoginDiagnostic['sessionIssue'],
        ) => {
          step = next;
          options.onDiagnostic?.({
            step,
            ...(httpStatus ? { httpStatus } : {}),
            ...(sessionIssue ? { sessionIssue } : {}),
          });
        };
        const onAbort = () => {
          void context?.close().catch(() => undefined);
        };
        try {
          signal.throwIfAborted();
          stage('opening');
          checkpoint('browser');
          context = await launchProfile(browserProfile, {
            login: options.headed,
            signal,
            slotWaitMs: options.headed ? undefined : BACKGROUND_SLOT_WAIT_MS,
          });
          signal.addEventListener('abort', onAbort, { once: true });
          signal.throwIfAborted();
          const page = context.pages()[0] ?? (await context.newPage());
          let sessionReceived = false;
          const response = page.waitForResponse(
            async (r) => {
              const u = new URL(r.url());
              const matches =
                u.origin === 'https://csgoempire.com' &&
                u.pathname.startsWith(
                  '/api/v2/match-betting/betby/user-session/',
                );
              if (!matches) return false;
              if (!r.ok()) return !options.credentials;
              const payload: unknown = await r.json().catch(() => null);
              // An unauthenticated page can reply HTTP 200 / success:true
              // with an empty token. That must not skip the login form.
              if (!sessionToken(payload)) return false;
              sessionReceived = true;
              return true;
            },
            // Listen before navigation so early responses are not missed. Each
            // phase below owns its timeout; close() cancels this listener.
            { timeout: 0 },
          );
          // Attach immediately so a failed navigation cannot leave an unhandled rejection.
          void response.catch(() => undefined);
          checkpoint('page');
          await page.goto('https://csgoempire.com/match-betting', {
            waitUntil: 'domcontentloaded',
            timeout: 45_000,
          });
          if (options.credentials) {
            checkpoint('login');
            await autoLogin(page, options.credentials, {
              sessionReceived: () => sessionReceived,
              signal,
              stage,
              onDiagnostic: options.onDiagnostic,
            });
          }
          stage('obtaining_session');
          checkpoint('jwt');
          // Watch only visible verification/error state while awaiting the site's session response.
          let monitor: ReturnType<typeof setInterval> | undefined;
          let sessionTimeout: ReturnType<typeof setTimeout> | undefined;
          let checking = false;
          const verifiedResponse = new Promise<Awaited<typeof response>>(
            (resolveResponse, reject) => {
              void response.then(resolveResponse, reject);
              // Start the JWT budget after UI login completes, not before the
              // initial page load and potentially slow authentication step.
              sessionTimeout = setTimeout(
                () => reject(new Error('CSGOEMPIRE_SESSION_RESPONSE_FAILED')),
                45_000,
              );
              monitor = setInterval(() => {
                if (checking) return;
                checking = true;
                void assertNoVerification(page)
                  .catch(reject)
                  .finally(() => {
                    checking = false;
                  });
              }, 500);
            },
          );
          let res: Awaited<typeof response>;
          try {
            res = await verifiedResponse;
          } finally {
            if (monitor) clearInterval(monitor);
            clearTimeout(sessionTimeout);
          }
          // Saved profiles commonly use coins (EMP). Change the site's display
          // currency and use its replacement session; never relabel an EMP JWT.
          if (res.ok()) {
            const initialToken = sessionToken(await res.json());
            let initialCurrency: unknown;
            try {
              const claims = JSON.parse(
                Buffer.from(
                  initialToken?.split('.')[1] ?? '',
                  'base64url',
                ).toString(),
              ) as { currency?: unknown } | null;
              initialCurrency = claims?.currency;
            } catch {
              // The validation below reports malformed tokens precisely.
            }
            if (['EMP', 'EUR', 'GBP'].includes(String(initialCurrency))) {
              checkpoint('currency');
              res = await selectUsdSession(page, signal);
            }
          }
          checkpoint('jwt', res.status());
          if (res.status() >= 500)
            throw new Error('CSGOEMPIRE_SESSION_REFRESH_FAILED');
          if (!res.ok())
            throw new Error(
              res.status() === 401
                ? SESSION_EXPIRED
                : 'CSGOEMPIRE_SESSION_REQUEST_REJECTED',
            );
          const data: unknown = await res.json();
          const token = sessionToken(data);
          if (!token) throw new Error('CSGOEMPIRE_SESSION_REQUEST_REJECTED');
          function invalidSession(
            issue: NonNullable<EmpireLoginDiagnostic['sessionIssue']>,
            httpStatus = res.status(),
          ): never {
            checkpoint(step, httpStatus, issue);
            throw new Error('CSGOEMPIRE_SESSION_INVALID');
          }
          let claims: unknown;
          try {
            claims = JSON.parse(
              Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
            );
          } catch {
            invalidSession('token_malformed');
          }
          if (!claims || typeof claims !== 'object' || Array.isArray(claims))
            invalidSession('token_malformed');
          const payload = claims as {
            exp?: unknown;
            iat?: unknown;
            currency?: unknown;
          };
          if (
            typeof payload.exp !== 'number' ||
            !Number.isFinite(payload.exp) ||
            !Number.isFinite(payload.exp * 1000)
          )
            invalidSession('expiry_invalid');
          const expiresAt = payload.exp * 1000;
          if (expiresAt < Date.now() + 60_000)
            invalidSession('expiry_too_short');
          if (
            payload.currency === undefined ||
            payload.currency === null ||
            payload.currency === ''
          )
            invalidSession('currency_missing');
          if (payload.currency !== 'USD')
            invalidSession('currency_unsupported');
          const sessionId = randomUUID();
          // Origin/brand observed in the supplied HAR. No request data or secrets imported from the HAR.
          const apiUrl = 'https://api-h-c7818b61-608.sptpub.com';
          const brandId = '2432911154364948480';
          checkpoint('identify');
          const identify = await fetch(
            `${apiUrl}/api/v2/auth/brand/${brandId}/identify`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'X-Session-Id': sessionId,
                Origin: 'https://csgoempire.com',
                Referer: 'https://csgoempire.com/',
              },
              signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
              redirect: 'error',
            },
          );
          checkpoint('identify', identify.status);
          if (identify.status >= 500)
            throw new Error('CSGOEMPIRE_SESSION_REFRESH_FAILED');
          if (!identify.ok)
            throw new Error(
              identify.status === 401
                ? SESSION_EXPIRED
                : 'CSGOEMPIRE_SESSION_IDENTIFY_FAILED',
            );
          const who = (await identify.json()) as {
            currency?: string;
            currency_detail?: { min_bet?: string };
            geo?: { blocked?: boolean };
            blocked_rm?: boolean;
          };
          if (who.geo?.blocked || who.blocked_rm)
            throw new Error('CSGOEMPIRE_SESSION_ACCESS_BLOCKED');
          if (who.currency !== 'USD')
            invalidSession('identify_currency_unsupported', identify.status);
          const cookie = (await context.cookies('https://csgoempire.com'))
            .map((c) => `${c.name}=${c.value}`)
            .join('; ');
          if (!cookie) throw new Error('CSGOEMPIRE_SESSION_COOKIE_MISSING');
          if (options.credentials) {
            checkpoint('account');
            const accountResponse = await fetch(
              'https://csgoempire.com/api/v2/user',
              {
                headers: { Cookie: cookie },
                signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
                redirect: 'error',
              },
            );
            checkpoint('account', accountResponse.status);
            if (!accountResponse.ok)
              throw new Error(
                accountResponse.status === 401
                  ? SESSION_EXPIRED
                  : 'CSGOEMPIRE_SESSION_ACCOUNT_FAILED',
              );
            const account = (await accountResponse.json()) as {
              success?: boolean;
              username?: string;
              email?: string;
            };
            const expected = options.credentials.username.trim().toLowerCase();
            if (
              !account.success ||
              ![account.username, account.email].some(
                (value) =>
                  typeof value === 'string' &&
                  value.trim().toLowerCase() === expected,
              )
            )
              throw new Error('CSGOEMPIRE_LOGIN_ACCOUNT_MISMATCH');
          }
          const session = {
            browserProfile,
            token,
            expiresAt,
            apiUrl,
            brandId,
            sessionId,
            minBet: Number(who.currency_detail?.min_bet ?? '0.1'),
            cookie,
          };
          const issued =
            typeof payload.iat === 'number' && Number.isFinite(payload.iat)
              ? payload.iat * 1000
              : Date.now();
          if (options.headed) await loginReady(browserProfile);
          this.cache.set(browserProfile, {
            revision: options.headed
              ? `${await readRevision(browserProfile)}:${options.credentialsVersion ?? ''}`
              : revision,
            session,
            // Refresh normal 30-minute tokens with 10 minutes left. If the
            // provider issues a shorter token, avoid refreshing on every poll.
            refreshAt:
              expiresAt - REFRESH_BEFORE_EXPIRY_MS > issued
                ? expiresAt - REFRESH_BEFORE_EXPIRY_MS
                : issued + (expiresAt - issued) * 0.8,
          });
          stage('ready');
          return session;
        } catch (e) {
          if (signal.aborted)
            throw new Error('CSGOEMPIRE_LOGIN_CANCELLED', { cause: e });
          if (
            e instanceof Error &&
            /^CSGOEMPIRE_(VERIFICATION_REQUIRED|LOGIN_|BROWSER_CLOSED)/.test(
              e.message,
            )
          ) {
            this.cache.set(browserProfile, {
              revision,
              refreshAt: 0,
              error: e.message,
            });
            throw e;
          }
          // Do not turn navigation errors, timeouts, or invalid API responses
          // into a false diagnosis that the user's login has expired.
          if (!context)
            throw new Error(
              e instanceof Error && e.message === 'BROWSER_SLOTS_BUSY'
                ? 'CSGOEMPIRE_BROWSER_SLOTS_BUSY'
                : 'CSGOEMPIRE_BROWSER_UNAVAILABLE',
              { cause: e },
            );
          if (!(e instanceof Error && e.message.startsWith('CSGOEMPIRE_'))) {
            throw new Error(STEP_FAILURE[step], { cause: e });
          }
          if (e.message === 'CSGOEMPIRE_SESSION_REFRESH_FAILED')
            throw new Error('CSGOEMPIRE_SESSION_REFRESH_FAILED', { cause: e });
          const error = e.message;
          this.cache.set(browserProfile, { revision, refreshAt: 0, error });
          throw new Error(error, { cause: e });
        } finally {
          signal.removeEventListener('abort', onAbort);
          await context?.close();
        }
      },
      { waitMs: LOCK_WAIT_MS, signal: options.signal },
    );
  }
}

interface CacheEntry {
  revision: string;
  refreshAt: number;
  session?: EmpireSession;
  error?: string;
  /** Lần làm mới vừa hỏng tạm thời: chưa thử lại trước mốc này. */
  retryAt?: number;
  lastError?: string;
}

const usable = (s: EmpireSession, now: number) =>
  s.expiresAt > now + STALE_TOKEN_MARGIN_MS;
