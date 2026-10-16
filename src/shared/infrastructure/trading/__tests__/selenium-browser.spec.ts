import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchSeleniumContext } from '../selenium-browser.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), connect: vi.fn() }));
vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
  execFile: vi.fn(),
}));
vi.mock('playwright', () => ({ chromium: { connectOverCDP: mocks.connect } }));

function setup() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 12345,
  });
  child.stdin.once('finish', () => {
    queueMicrotask(() => {
      child.emit('exit', 0);
      child.emit('close', 0);
    });
  });
  mocks.spawn.mockReturnValue(child);
  const context = {};
  const browser = Object.assign(new EventEmitter(), {
    contexts: () => [context],
    close: vi.fn(() => {
      browser.emit('disconnected');
      return Promise.resolve();
    }),
  });
  mocks.connect.mockResolvedValue(browser);
  const ready = () =>
    child.stdout.write('{"endpoint":"http://127.0.0.1:9222"}\n');
  return { child, browser, ready };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('SeleniumBase process ownership', () => {
  it('attaches to the existing context and stops Python exactly once on close', async () => {
    const s = setup();
    const starting = launchSeleniumContext('/profiles/unit', {
      headless: true,
    });
    s.ready();
    const context = await starting;
    expect(mocks.connect).toHaveBeenCalledWith('http://127.0.0.1:9222', {
      timeout: 15_000,
    });
    expect(mocks.spawn.mock.calls[0]?.[1]).toContain('--headless');
    await Promise.all([context.close(), context.close()]);
    expect(s.browser.close).toHaveBeenCalledOnce();
    expect(s.child.stdin.writableEnded).toBe(true);
    expect(s.child.stdout.listenerCount('data')).toBe(0);
  });

  it('reaps the helper when CDP cannot connect', async () => {
    const s = setup();
    mocks.connect.mockRejectedValueOnce(new Error('CDP unavailable'));
    const starting = launchSeleniumContext('/profiles/unit', {
      headless: true,
    });
    const rejected = expect(starting).rejects.toThrow('CDP unavailable');
    s.ready();
    await rejected;
    expect(s.child.stdin.writableEnded).toBe(true);
  });

  it('shuts down both Chrome and its CDP connection on an attached abort', async () => {
    const s = setup();
    const controller = new AbortController();
    const starting = launchSeleniumContext('/profiles/unit', {
      headless: true,
      signal: controller.signal,
    });
    s.ready();
    const context = await starting;
    controller.abort();
    await context.close();
    expect(s.browser.close).toHaveBeenCalledOnce();
    expect(s.child.stdin.writableEnded).toBe(true);
  });

  it('cancels before readiness and removes event listeners', async () => {
    const s = setup();
    const controller = new AbortController();
    const starting = launchSeleniumContext('/profiles/unit', {
      headless: true,
      signal: controller.signal,
    });
    const rejected = expect(starting).rejects.toThrow(
      'CSGOEMPIRE_LOGIN_CANCELLED',
    );
    controller.abort();
    await rejected;
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(s.child.stdin.writableEnded).toBe(true);
    expect(s.child.stdout.listenerCount('data')).toBe(0);
  });

  it('times out startup and stops the helper', async () => {
    vi.useFakeTimers();
    const s = setup();
    const starting = launchSeleniumContext('/profiles/unit', {
      headless: true,
    });
    const rejected = expect(starting).rejects.toThrow(
      'SELENIUMBASE_STARTUP_TIMEOUT',
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(s.child.stdin.writableEnded).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a non-local CDP endpoint and stops its helper', async () => {
    const s = setup();
    const starting = launchSeleniumContext('/profiles/unit', {
      headless: true,
    });
    const rejected = expect(starting).rejects.toThrow(
      'SELENIUMBASE_INVALID_CDP_ENDPOINT',
    );
    s.child.stdout.write('{"endpoint":"http://example.test:9222"}\n');
    await rejected;
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(s.child.stdin.writableEnded).toBe(true);
  });
});
