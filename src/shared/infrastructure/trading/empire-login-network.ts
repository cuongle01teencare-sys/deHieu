import type { Page, Request, Response } from 'playwright';
import type { EmpireLoginDiagnostic } from '../../application/empire-login.js';

/** Observe authentication metadata only. Never read bodies, cookies or headers. */
export function observeLoginNetwork(
  page: Page,
  report: (diagnostic: EmpireLoginDiagnostic) => void,
) {
  const started = Date.now();
  let authentication: Request | undefined;
  let loginRequest: NonNullable<EmpireLoginDiagnostic['loginRequest']> =
    'not_observed';
  let verificationRequest: EmpireLoginDiagnostic['verificationRequest'];
  let httpStatus: number | undefined;
  const snapshot = () =>
    report({
      step: 'login',
      loginRequest,
      elapsedMs: Date.now() - started,
      ...(verificationRequest ? { verificationRequest } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    });
  const isVerification = (request: Request) => {
    const { hostname, pathname } = new URL(request.url());
    return (
      hostname === 'challenges.cloudflare.com' ||
      hostname === 'hcaptcha.com' ||
      hostname.endsWith('.hcaptcha.com') ||
      ((hostname === 'www.google.com' || hostname === 'www.recaptcha.net') &&
        pathname.startsWith('/recaptcha/'))
    );
  };
  const request = (request: Request) => {
    const { origin, pathname } = new URL(request.url());
    if (
      request.method() === 'POST' &&
      origin === 'https://csgoempire.com' &&
      /\/(?:login|sign-in|signin|authenticate)(?:\/|$)/i.test(pathname)
    ) {
      authentication = request;
      loginRequest = 'pending';
      httpStatus = undefined;
      snapshot();
    } else if (isVerification(request)) {
      verificationRequest = 'observed';
      snapshot();
    }
  };
  const response = (response: Response) => {
    if (response.request() === authentication) {
      loginRequest = 'completed';
      httpStatus = response.status();
      snapshot();
    } else if (isVerification(response.request()) && response.status() >= 400) {
      verificationRequest = 'failed';
      snapshot();
    }
  };
  const failed = (request: Request) => {
    // Navigating away after authentication can cancel outstanding iframe/XHR
    // requests. That cancellation is not a connection failure.
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
    if (request === authentication) {
      loginRequest = 'failed';
      snapshot();
    } else if (isVerification(request)) {
      verificationRequest = 'failed';
      snapshot();
    }
  };
  page.on('request', request);
  page.on('response', response);
  page.on('requestfailed', failed);
  const timer = setInterval(snapshot, 1_000);
  snapshot();
  return {
    assertHealthy() {
      if (loginRequest === 'failed')
        throw new Error('CSGOEMPIRE_LOGIN_NETWORK_FAILED');
      if (httpStatus !== undefined && httpStatus >= 400)
        throw new Error('CSGOEMPIRE_LOGIN_REQUEST_REJECTED');
    },
    close() {
      clearInterval(timer);
      page.off('request', request);
      page.off('response', response);
      page.off('requestfailed', failed);
      snapshot();
    },
  };
}
