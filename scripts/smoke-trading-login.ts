import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { BrowserContext } from 'playwright';
import { autoLogin } from '../src/shared/infrastructure/trading/empire-auto-login.js';
import { launchSeleniumContext } from '../src/shared/infrastructure/trading/selenium-browser.js';
import type { EmpireLoginDiagnostic } from '../src/shared/application/empire-login.js';

// Every browser request is intercepted. Only dummy credentials are used; this
// exercises the real launcher, DOM, and network events without an external login.
const runtime = resolve('.trading');
await mkdir(runtime, { recursive: true });
const profile = await mkdtemp(resolve(runtime, 'login-smoke-'));
let context: BrowserContext | undefined;
const origin = 'https://csgoempire.com';
const sessionPath = '/api/v2/match-betting/betby/user-session/test';
let status = 200;
let requests = 0;
const html = `<!doctype html><html><body>
  <button id="open" onclick="this.hidden=true;document.querySelector('form').hidden=false">Sign In</button>
  <form hidden>
    <label>Email<input type="email" autocomplete="username" required></label>
    <label>Password<input type="password" required></label>
    <button id="auth-login-submit" type="submit">Log In</button>
  </form>
  <script>
    const form = document.querySelector('form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      document.querySelector('#auth-login-submit').disabled = true;
      const response = await fetch('/api/v2/login', {method:'POST',body:'dummy-only'});
      if (!response.ok) return;
      form.hidden = true;
      await fetch('${sessionPath}');
    });
  </script></body></html>`;

try {
  context = await launchSeleniumContext(profile, { headless: true });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/match-betting')
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: html,
      });
    if (url.pathname === '/api/v2/login') {
      requests++;
      if (status === 0) return route.abort('connectionrefused');
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: '{}',
      });
    }
    if (url.pathname === sessionPath)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"success":true,"data":{"token":"local-test-only"}}',
      });
    return route.abort();
  });
  const page = context.pages()[0] ?? (await context.newPage());
  assert.equal(await page.evaluate(() => navigator.webdriver), false);
  for (const scenario of [200, 403, 0]) {
    status = scenario;
    requests = 0;
    await page.goto(`${origin}/match-betting`);
    const diagnostics: EmpireLoginDiagnostic[] = [];
    let sessionReceived = false;
    const response =
      scenario === 200
        ? page
            .waitForResponse(
              (response) => new URL(response.url()).pathname === sessionPath,
            )
            .then(() => {
              sessionReceived = true;
            })
        : undefined;
    void response?.catch(() => undefined);
    const login = autoLogin(
      page,
      { username: 'test@example.test', password: 'local-test-only' },
      {
        signal: AbortSignal.timeout(15_000),
        sessionReceived: () => sessionReceived,
        stage: () => undefined,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      },
    );
    if (scenario === 200) {
      await login;
      await response;
      assert.ok(sessionReceived);
      assert.ok(
        diagnostics.some((diagnostic) => diagnostic.httpStatus === 200),
      );
    } else {
      await assert.rejects(
        login,
        new RegExp(
          scenario === 403
            ? 'CSGOEMPIRE_LOGIN_REQUEST_REJECTED'
            : 'CSGOEMPIRE_LOGIN_NETWORK_FAILED',
        ),
      );
    }
    assert.equal(requests, 1);
    console.log(
      `Local login flow (${scenario === 0 ? 'connection failure' : `HTTP ${scenario}`}): OK`,
    );
  }
} finally {
  await context?.close();
  assert.equal(dirname(profile), runtime);
  await rm(profile, { recursive: true, force: true });
}
