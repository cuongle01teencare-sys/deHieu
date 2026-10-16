import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { autoLogin } from '../empire-auto-login.js';

function element(visible: () => boolean = () => false) {
  const result = {
    first: () => result,
    or: () => result,
    filter: () => result,
    isVisible: vi.fn(() => Promise.resolve(visible())),
    fill: vi.fn((_value: string) => Promise.resolve()),
    pressSequentially: vi.fn((_value: string, _options: { delay: number }) =>
      Promise.resolve(),
    ),
    count: vi.fn(() => Promise.resolve(1)),
    click: vi.fn(() => Promise.resolve()),
    getByRole: (_role: string) => result,
  };
  return result;
}
function setup() {
  let submitted = false;
  const username = element(() => true);
  const password = element(() => !submitted);
  const verification = element();
  const alert = element();
  const submit = element(() => true);
  submit.click.mockImplementation(() => {
    submitted = true;
    return Promise.resolve();
  });
  const form = element();
  form.getByRole = () => submit;
  const header = element(() => !submitted);
  const page = {
    on: vi.fn(),
    off: vi.fn(),
    url: vi.fn(() => 'https://csgoempire.com/match-betting'),
    isClosed: () => false,
    locator: (selector: string) =>
      selector === 'form'
        ? form
        : selector === '#auth-login-submit:visible'
          ? submit
          : selector.includes('input[type="password"]')
            ? password
            : verification,
    getByText: () => verification,
    getByRole: (role: string) =>
      role === 'textbox' ? username : role === 'alert' ? alert : header,
    waitForTimeout: (_ms: number): Promise<void> => Promise.resolve(),
    goto: vi.fn(() => Promise.resolve()),
  };
  const options = {
    sessionReceived: () => submitted,
    signal: new AbortController().signal,
    stage: vi.fn<(_stage: string) => void>(),
  };
  return {
    page,
    options,
    username,
    password,
    submit,
    verification,
    alert,
    form,
  };
}
const credentials = {
  username: 'unit-user',
  password: ' password with spaces ',
};
afterEach(() => vi.useRealTimers());
describe('csgoempire automatic UI login', () => {
  it('waits through a slow login response beyond 30 seconds without resubmitting', async () => {
    vi.useFakeTimers();
    const s = setup();
    let received = false;
    let completed = false;
    s.options.sessionReceived = () => received;
    // Keep the modal visible, as with a submit button showing its spinner.
    s.submit.click.mockResolvedValue(undefined);
    s.page.waitForTimeout = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const login = autoLogin(s.page as unknown as Page, credentials, s.options);
    const checked = expect(login).resolves.toBeUndefined();
    void login.then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(completed).toBe(false);
    expect(s.options.stage).toHaveBeenLastCalledWith('signing_in');
    expect(s.page.goto).not.toHaveBeenCalled();
    received = true;
    await vi.advanceTimersByTimeAsync(250);
    await checked;
    expect(s.submit.click).toHaveBeenCalledOnce();
    expect(s.options.stage).toHaveBeenLastCalledWith('obtaining_session');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled submitted form to 90 seconds and does not report rejection', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.options.sessionReceived = () => false;
    s.submit.click.mockResolvedValue(undefined);
    s.page.waitForTimeout = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const login = autoLogin(s.page as unknown as Page, credentials, s.options);
    const rejected = expect(login).rejects.toThrow(
      'CSGOEMPIRE_LOGIN_NOT_CONFIRMED',
    );
    await vi.advanceTimersByTimeAsync(90_000);
    await rejected;
    expect(s.submit.click).toHaveBeenCalledOnce();
    expect(s.page.goto).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('types both fields sequentially, preserves password whitespace, and submits exactly once', async () => {
    const s = setup();
    await autoLogin(s.page as unknown as Page, credentials, s.options);
    expect(s.username.pressSequentially).toHaveBeenCalledWith(
      credentials.username,
      { delay: 70 },
    );
    expect(s.password.pressSequentially).toHaveBeenCalledWith(
      credentials.password,
      { delay: 70 },
    );
    expect(s.submit.click).toHaveBeenCalledOnce();
    expect(s.options.stage.mock.calls.map((c) => c[0])).toEqual([
      'signing_in',
      'obtaining_session',
    ]);
  });
  it('reuses a valid session without typing or submitting again', async () => {
    const s = setup();
    s.options.sessionReceived = () => true;
    await autoLogin(s.page as unknown as Page, credentials, s.options);
    expect(s.password.pressSequentially).not.toHaveBeenCalled();
    expect(s.submit.click).not.toHaveBeenCalled();
  });
  it('submits the observed email modal even when it has no form or dialog role', async () => {
    const s = setup();
    s.form.count.mockResolvedValue(0);
    await autoLogin(s.page as unknown as Page, credentials, s.options);
    expect(s.submit.click).toHaveBeenCalledOnce();
  });
  it('still supports a semantic form when the observed submit ID is absent', async () => {
    const s = setup();
    s.submit.count.mockResolvedValue(0);
    await autoLogin(s.page as unknown as Page, credentials, s.options);
    expect(s.submit.click).toHaveBeenCalledOnce();
  });
  it.each([
    'https://steamcommunity.com/login',
    'http://csgoempire.com/login',
    'https://csgoempire.com:444/login',
  ])('never types credentials on a different origin: %s', async (url) => {
    const s = setup();
    s.page.url.mockReturnValue(url);
    await expect(
      autoLogin(s.page as unknown as Page, credentials, s.options),
    ).rejects.toThrow('CSGOEMPIRE_LOGIN_ORIGIN_INVALID');
    expect(s.username.pressSequentially).not.toHaveBeenCalled();
    expect(s.password.pressSequentially).not.toHaveBeenCalled();
  });
  it('stops at visible CAPTCHA/OTP without submitting', async () => {
    const s = setup();
    s.verification.isVisible.mockResolvedValue(true);
    await expect(
      autoLogin(s.page as unknown as Page, credentials, s.options),
    ).rejects.toThrow('CSGOEMPIRE_VERIFICATION_REQUIRED');
    expect(s.submit.click).not.toHaveBeenCalled();
  });
  it('does not retry when the login form rejects credentials', async () => {
    const s = setup();
    s.options.sessionReceived = () => false;
    s.submit.click.mockImplementation(() => {
      s.alert.isVisible.mockResolvedValue(true);
      return Promise.resolve();
    });
    await expect(
      autoLogin(s.page as unknown as Page, credentials, s.options),
    ).rejects.toThrow('CSGOEMPIRE_LOGIN_REJECTED');
    expect(s.submit.click).toHaveBeenCalledOnce();
  });
  it('honors cancellation before entering any credentials', async () => {
    const s = setup();
    s.options.signal = AbortSignal.abort();
    await expect(
      autoLogin(s.page as unknown as Page, credentials, s.options),
    ).rejects.toThrow();
    expect(s.password.pressSequentially).not.toHaveBeenCalled();
  });
});
