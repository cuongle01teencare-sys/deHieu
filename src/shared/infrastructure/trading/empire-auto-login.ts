import type { Page } from 'playwright';
import type {
  EmpireCredentials,
  EmpireLoginStage,
  EmpireLoginDiagnostic,
} from '../../application/empire-login.js';
import { observeLoginNetwork } from './empire-login-network.js';

const loginName = /^(log\s*in|sign\s*in|đăng nhập)$/i;
const visiblePassword = 'input[type="password"]:visible';
const visibleUsername =
  'input[autocomplete="username"]:visible, input[autocomplete="email"]:visible, input[name="username"]:visible, input[name="email"]:visible, input[name="login"]:visible, input[type="email"]:visible';

export async function assertNoVerification(page: Page) {
  if (
    await page
      .getByRole('alert')
      .filter({ hasText: /invalid|incorrect|wrong password|sai mật khẩu/i })
      .first()
      .isVisible()
  )
    throw new Error('CSGOEMPIRE_LOGIN_REJECTED');
  if (
    (await page
      .getByText(
        /verify (?:you are|you're) human|complete the captcha|enter (?:the )?(?:verification|authentication) code|two.factor authentication|xác minh bạn|mã xác thực/i,
      )
      .first()
      .isVisible()) ||
    (await page
      .locator(
        'iframe[src*="recaptcha"]:visible, iframe[src*="hcaptcha"]:visible, iframe[src*="challenges.cloudflare.com"]:visible, input[autocomplete="one-time-code"]:visible',
      )
      .first()
      .isVisible())
  )
    throw new Error('CSGOEMPIRE_VERIFICATION_REQUIRED');
}

/** Ordinary UI typing. No fingerprint changes, CAPTCHA solving, or repeated login attempts. */
export async function autoLogin(
  page: Page,
  credentials: EmpireCredentials,
  options: {
    sessionReceived: () => boolean;
    signal: AbortSignal;
    stage: (stage: EmpireLoginStage) => void;
    confirmationTimeoutMs?: number;
    onDiagnostic?: (diagnostic: EmpireLoginDiagnostic) => void;
  },
) {
  const deadline = Date.now() + 25_000;
  let opened = false;
  let selectedEmail = false;
  while (!options.sessionReceived()) {
    options.signal.throwIfAborted();
    if (page.isClosed()) throw new Error('CSGOEMPIRE_BROWSER_CLOSED');
    if (new URL(page.url()).origin !== 'https://csgoempire.com')
      throw new Error('CSGOEMPIRE_LOGIN_ORIGIN_INVALID');
    await assertNoVerification(page);
    const password = page
      .locator(process.env.TRADING_EMPIRE_PASSWORD_SELECTOR || visiblePassword)
      .first();
    if (await password.isVisible()) {
      const username = process.env.TRADING_EMPIRE_USERNAME_SELECTOR
        ? page.locator(process.env.TRADING_EMPIRE_USERNAME_SELECTOR).first()
        : page
            .getByRole('textbox', {
              name: /username|email|tài khoản|tên đăng nhập/i,
            })
            .or(page.locator(visibleUsername))
            .first();
      if (!(await username.isVisible()))
        throw new Error('CSGOEMPIRE_LOGIN_FORM_UNSUPPORTED');
      options.stage('signing_in');
      const network = observeLoginNetwork(
        page,
        options.onDiagnostic ?? (() => undefined),
      );
      try {
        await username.fill('');
        await username.pressSequentially(credentials.username, { delay: 70 });
        await password.fill('');
        await password.pressSequentially(credentials.password, { delay: 70 });
        // Đọc lại ô đã gõ (chỉ so khớp, không ghi nội dung ra đâu): chữ gõ nhầm sang ô khác / không
        // ăn vào ô thì form thiếu dữ liệu và nút Log In sẽ bị khóa — báo đúng ô nào.
        for (const [field, locator, expected, label] of [
          ['email', username, credentials.username.trim(), 'Ô email'],
          ['password', password, credentials.password, 'Ô mật khẩu'],
        ] as const) {
          let actual: string | null;
          try {
            actual = await locator.inputValue({ timeout: 2_000 });
          } catch {
            actual = null; // không đọc được (không phải ô nhập chuẩn): không kết luận
          }
          if (actual === null) continue;
          if ((field === 'email' ? actual.trim() : actual) !== expected) {
            options.onDiagnostic?.({
              step: 'login',
              cause: `${label} không nhận đúng nội dung đã gõ (đang có ${actual.length} ký tự, cần ${expected.length}). Có thể chữ đã gõ vào ô khác trên trang.`,
            });
            throw new Error(`CSGOEMPIRE_LOGIN_TYPING_FAILED: ${field}`);
          }
        }
        await assertNoVerification(page);
        network.assertHealthy();
        options.signal.throwIfAborted();
        if (new URL(page.url()).origin !== 'https://csgoempire.com')
          throw new Error('CSGOEMPIRE_LOGIN_ORIGIN_INVALID');
        const custom = process.env.TRADING_EMPIRE_SUBMIT_SELECTOR;
        // Verified on the live email/password modal. Its generated input IDs
        // change between visits, but this submit button has a stable ID.
        const emailSubmit = page.locator('#auth-login-submit:visible');
        const form = page.locator('form').filter({ has: password });
        const submit = custom
          ? page.locator(custom).first()
          : (await emailSubmit.count()) === 1
            ? emailSubmit
            : (await form.count()) === 1
              ? form.getByRole('button', { name: loginName }).first()
              : page
                  .getByRole('dialog')
                  .getByRole('button', { name: loginName })
                  .first();
        // Nút bị khóa (trang chờ xác minh kiểu Turnstile/CAPTCHA, hoặc form chưa hợp lệ): báo rõ
        // thay vì để click chờ hết giờ với lỗi chung chung.
        const enabledBy = Date.now() + 10_000;
        for (;;) {
          let enabled: boolean;
          try {
            enabled = await submit.isEnabled({ timeout: 1_000 });
          } catch {
            break; // không đọc được trạng thái: để click tự báo lỗi
          }
          if (enabled) break;
          await assertNoVerification(page);
          if (Date.now() >= enabledBy)
            throw new Error('CSGOEMPIRE_LOGIN_SUBMIT_DISABLED');
          await page.waitForTimeout(250);
        }
        await submit.click({ timeout: 10_000 });
        // Give the submitted form its own budget. Navigation and typing must not
        // consume the time allowed for the site's authentication response.
        const confirmedBy =
          Date.now() + (options.confirmationTimeoutMs ?? 90_000);
        while (!options.sessionReceived()) {
          options.signal.throwIfAborted();
          if (page.isClosed()) throw new Error('CSGOEMPIRE_BROWSER_CLOSED');
          if (new URL(page.url()).origin !== 'https://csgoempire.com')
            throw new Error('CSGOEMPIRE_LOGIN_ORIGIN_INVALID');
          await assertNoVerification(page);
          network.assertHealthy();
          if (
            !(await password.isVisible()) &&
            !(await page
              .getByRole('button', { name: loginName })
              .first()
              .isVisible())
          ) {
            options.stage('obtaining_session');
            await page.goto('https://csgoempire.com/match-betting', {
              waitUntil: 'domcontentloaded',
              timeout: 30_000,
            });
            return;
          }
          if (Date.now() >= confirmedBy)
            throw new Error('CSGOEMPIRE_LOGIN_NOT_CONFIRMED');
          await page.waitForTimeout(250);
        }
        options.stage('obtaining_session');
        return;
      } finally {
        network.close();
      }
    }
    if (!opened) {
      const open = process.env.TRADING_EMPIRE_OPEN_SELECTOR
        ? page.locator(process.env.TRADING_EMPIRE_OPEN_SELECTOR).first()
        : page.getByRole('button', { name: loginName }).first();
      if (await open.isVisible()) {
        await open.click({ timeout: 10_000 });
        opened = true;
      }
    } else if (!selectedEmail) {
      const email = page
        .getByRole('button', {
          name: /^(?:(?:continue|log\s*in|sign\s*in) with )?email$/i,
        })
        .first();
      if (await email.isVisible()) {
        await email.click({ timeout: 10_000 });
        selectedEmail = true;
      }
    }
    if (Date.now() >= deadline)
      throw new Error('CSGOEMPIRE_LOGIN_FORM_UNSUPPORTED');
    await page.waitForTimeout(250);
  }
}
