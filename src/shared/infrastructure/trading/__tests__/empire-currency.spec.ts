import { EventEmitter } from 'node:events';
import type { Page, Response } from 'playwright';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { selectUsdSession } from '../empire-currency.js';

vi.mock('../empire-auto-login.js', () => ({ assertNoVerification: vi.fn() }));

function response(
  currency = 'USD',
  token: unknown = 'test-token',
  origin = 'https://csgoempire.com',
) {
  return {
    url: () =>
      `${origin}/api/v2/match-betting/betby/user-session/en/${currency}/EMP`,
    ok: () => true,
    json: () => Promise.resolve({ success: true, data: { token } }),
  } as unknown as Response;
}
function setup() {
  const events = new EventEmitter();
  const apply = vi.fn(() => Promise.resolve());
  const clicks: string[] = [];
  const page = Object.assign(events, {
    url: () => 'https://csgoempire.com/match-betting',
    isClosed: () => false,
    locator: (selector: string) => {
      const locator = {
        first: () => locator,
        click: async () => {
          clicks.push(selector);
          if (selector.includes('apply-button')) await apply();
        },
      };
      return locator;
    },
  });
  const controller = new AbortController();
  return { events, apply, clicks, page: page as unknown as Page, controller };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('captures the USD response even when it arrives inside the Apply click', async () => {
  const s = setup();
  const usd = response();
  s.apply.mockImplementation(async () => {
    s.events.emit('response', response('EMP'));
    s.events.emit('response', response('USD', '', 'https://csgoempire.com'));
    s.events.emit(
      'response',
      response('USD', 'untrusted', 'https://other.example'),
    );
    s.events.emit('response', usd);
    await Promise.resolve();
  });
  expect(await selectUsdSession(s.page, s.controller.signal)).toBe(usd);
  expect(s.clicks).toEqual([
    '[data-testid="balance"]:visible .caret',
    '[data-testid="currency-option-USD"]:visible',
    '[data-testid="apply-button"]:visible',
  ]);
  expect(s.events.eventNames()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it('times out and removes listeners if Apply never produces a USD session', async () => {
  const s = setup();
  s.apply.mockImplementation(() => {
    s.events.emit('response', response('EMP'));
    return Promise.resolve();
  });
  const pending = selectUsdSession(s.page, s.controller.signal);
  const rejected = expect(pending).rejects.toThrow(
    'CSGOEMPIRE_CURRENCY_SWITCH_FAILED',
  );
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(s.events.eventNames()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it('passes HTTP rejections back to the session validator', async () => {
  const s = setup();
  const rejected = { ...response(), ok: () => false } as Response;
  s.apply.mockImplementation(() => {
    s.events.emit('response', rejected);
    return Promise.resolve();
  });
  expect(await selectUsdSession(s.page, s.controller.signal)).toBe(rejected);
});

it('cleans up when the user cancels while waiting for USD', async () => {
  const s = setup();
  const pending = selectUsdSession(s.page, s.controller.signal);
  const rejected = expect(pending).rejects.toThrow('cancelled');
  await vi.advanceTimersByTimeAsync(0);
  s.controller.abort(new Error('cancelled'));
  await rejected;
  expect(s.events.eventNames()).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not click outside the expected site', async () => {
  const s = setup();
  s.page.url = () => 'https://other.example';
  await expect(selectUsdSession(s.page, s.controller.signal)).rejects.toThrow(
    'CSGOEMPIRE_LOGIN_ORIGIN_INVALID',
  );
  expect(s.clicks).toEqual([]);
});
