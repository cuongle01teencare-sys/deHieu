import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page, Request, Response } from 'playwright';
import { observeLoginNetwork } from '../empire-login-network.js';

const request = (
  url = 'https://csgoempire.com/api/v2/login?private=secret',
  errorText = 'net::ERR_CONNECTION_RESET',
) =>
  ({
    url: () => url,
    method: () => 'POST',
    failure: () => ({ errorText }),
  }) as unknown as Request;
const response = (request: Request, status: number) =>
  ({
    request: () => request,
    status: () => status,
  }) as unknown as Response;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const page = new EventEmitter();
  const report = vi.fn();
  const observer = observeLoginNetwork(page as unknown as Page, report);
  return { page, report, observer };
}

describe('safe authentication network diagnostics', () => {
  it('distinguishes a pending request from a response without exposing request data', () => {
    const s = setup();
    const login = request();
    s.page.emit('request', login);
    expect(s.report).toHaveBeenLastCalledWith(
      expect.objectContaining({ loginRequest: 'pending' }),
    );
    s.page.emit('response', response(login, 200));
    expect(s.report).toHaveBeenLastCalledWith(
      expect.objectContaining({ loginRequest: 'completed', httpStatus: 200 }),
    );
    expect(() => s.observer.assertHealthy()).not.toThrow();
    s.observer.close();
    expect(JSON.stringify(s.report.mock.calls)).not.toMatch(
      /private|secret|api\/v2|https:/,
    );
    expect(s.page.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports an HTTP rejection without claiming the password is wrong', () => {
    const s = setup();
    const login = request();
    s.page.emit('request', login);
    s.page.emit('response', response(login, 403));
    expect(() => s.observer.assertHealthy()).toThrow(
      'CSGOEMPIRE_LOGIN_REQUEST_REJECTED',
    );
    expect(s.report).toHaveBeenLastCalledWith(
      expect.objectContaining({ httpStatus: 403 }),
    );
    s.observer.close();
  });

  it('identifies a failed authentication connection', () => {
    const s = setup();
    const login = request();
    s.page.emit('request', login);
    s.page.emit('requestfailed', login);
    expect(() => s.observer.assertHealthy()).toThrow(
      'CSGOEMPIRE_LOGIN_NETWORK_FAILED',
    );
    s.observer.close();
  });

  it('records verification loading failures while allowing authentication to continue', () => {
    const s = setup();
    const challenge = request('https://challenges.cloudflare.com/test');
    s.page.emit('request', challenge);
    s.page.emit('requestfailed', challenge);
    expect(s.report).toHaveBeenLastCalledWith(
      expect.objectContaining({
        verificationRequest: 'failed',
        loginRequest: 'not_observed',
      }),
    );
    expect(() => s.observer.assertHealthy()).not.toThrow();
    s.observer.close();
  });

  it('ignores navigation cancellations and unrelated POST requests', () => {
    const s = setup();
    s.page.emit('request', request('https://example.test/login'));
    s.page.emit('request', request('https://csgoempire.com/api/v2/analytics'));
    expect(s.report).toHaveBeenLastCalledWith(
      expect.objectContaining({ loginRequest: 'not_observed' }),
    );
    const login = request(undefined, 'net::ERR_ABORTED');
    s.page.emit('request', login);
    s.page.emit('requestfailed', login);
    expect(() => s.observer.assertHealthy()).not.toThrow();
    s.observer.close();
  });
});
