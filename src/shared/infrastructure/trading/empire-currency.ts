import type { Page, Response } from 'playwright';
import { assertNoVerification } from './empire-auto-login.js';

/** Use the site's currency dialog so its own security flow issues the new JWT. */
export async function selectUsdSession(
  page: Page,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();
  await assertNoVerification(page);
  if (new URL(page.url()).origin !== 'https://csgoempire.com')
    throw new Error('CSGOEMPIRE_LOGIN_ORIGIN_INVALID');

  let resolveResponse!: (response: Response) => void;
  let rejectResponse!: (error: unknown) => void;
  const response = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  void response.catch(() => undefined);
  const onResponse = (candidate: Response) => {
    void (async () => {
      const url = new URL(candidate.url());
      if (
        url.origin !== 'https://csgoempire.com' ||
        !/^\/api\/v2\/match-betting\/betby\/user-session\/[^/]+\/USD\/EMP\/?$/.test(
          url.pathname,
        )
      )
        return;
      if (!candidate.ok()) return resolveResponse(candidate);
      const body = (await candidate.json()) as {
        success?: boolean;
        data?: { token?: unknown };
      } | null;
      // A guest or an earlier EMP response must not complete this step.
      if (
        body?.success === true &&
        typeof body.data?.token === 'string' &&
        body.data.token.trim()
      )
        resolveResponse(candidate);
    })().catch(rejectResponse);
  };
  const onAbort = () => rejectResponse(signal.reason);
  const onClose = () => rejectResponse(new Error('CSGOEMPIRE_BROWSER_CLOSED'));
  const timeout = setTimeout(
    () => rejectResponse(new Error('CSGOEMPIRE_CURRENCY_SWITCH_FAILED')),
    30_000,
  );
  // Subscribe before Apply: the new session can arrive before click resolves.
  page.on('response', onResponse);
  page.on('close', onClose);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    signal.throwIfAborted();
    await page
      .locator('[data-testid="balance"]:visible .caret')
      .first()
      .click({ timeout: 10_000 });
    signal.throwIfAborted();
    await page
      .locator('[data-testid="currency-option-USD"]:visible')
      .click({ timeout: 10_000 });
    signal.throwIfAborted();
    await page
      .locator('[data-testid="apply-button"]:visible')
      .click({ timeout: 10_000 });
    return await response;
  } catch (error) {
    signal.throwIfAborted();
    if (page.isClosed())
      throw new Error('CSGOEMPIRE_BROWSER_CLOSED', { cause: error });
    await assertNoVerification(page);
    throw new Error('CSGOEMPIRE_CURRENCY_SWITCH_FAILED', { cause: error });
  } finally {
    clearTimeout(timeout);
    page.off('response', onResponse);
    page.off('close', onClose);
    signal.removeEventListener('abort', onAbort);
  }
}
