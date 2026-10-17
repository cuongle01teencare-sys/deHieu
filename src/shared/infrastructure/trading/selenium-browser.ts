import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext } from 'playwright';

export interface SeleniumBrowserOptions {
  headless: boolean;
  port?: number;
  signal?: AbortSignal;
}

/** Python owns Chrome. Closing the CDP connection alone does not stop Chrome. */
export async function launchSeleniumContext(
  profile: string,
  options: SeleniumBrowserOptions,
): Promise<BrowserContext> {
  options.signal?.throwIfAborted();
  const child = spawn(
    process.env.TRADING_PYTHON_PATH || 'python',
    [
      '-u',
      fileURLToPath(new URL('./selenium-browser.py', import.meta.url)),
      '--profile',
      profile,
      '--port',
      String(options.port ?? 0),
      ...(options.headless ? ['--headless'] : []),
      ...(process.env.TRADING_EXTERNAL_DISPLAY === '1'
        ? ['--external-display']
        : []),
      ...(process.env.TRADING_CHROMIUM_PATH
        ? ['--binary', process.env.TRADING_CHROMIUM_PATH]
        : []),
    ],
    {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  // Drain diagnostics without retaining logs or exposing profile/session data.
  child.stderr.resume();
  child.stdin.on('error', () => undefined);
  let exited = false;
  const exit = new Promise<void>((resolveExit) => {
    const done = () => {
      exited = true;
      resolveExit();
    };
    child.once('close', done);
    child.once('error', done);
  });
  let stopPromise: Promise<void> | undefined;
  const stop = () =>
    (stopPromise ??= (async () => {
      child.stdin.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          exit,
          new Promise<void>((resolveTimeout) => {
            timer = setTimeout(resolveTimeout, 8_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (!exited && child.pid) {
        if (process.platform === 'win32') {
          await new Promise<void>((resolveKill, rejectKill) => {
            execFile(
              'taskkill',
              ['/PID', String(child.pid), '/T', '/F'],
              { windowsHide: true, timeout: 5_000 },
              (error: Error | null) =>
                error && !exited ? rejectKill(error) : resolveKill(),
            );
          });
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          }
        }
        await exit;
      }
    })());

  let rejectReady: (error: Error) => void = () => undefined;
  const onAbort = () => {
    rejectReady(new Error('CSGOEMPIRE_LOGIN_CANCELLED'));
    void stop().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let buffer = '';
  const onData = (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    if (buffer.length > 8192)
      rejectReady(new Error('SELENIUMBASE_INVALID_READY_MESSAGE'));
    else if (buffer.includes('\n')) {
      try {
        const message = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))) as {
          endpoint?: unknown;
        };
        const port =
          typeof message.endpoint === 'string'
            ? /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(message.endpoint)?.[1]
            : undefined;
        if (!port || Number(port) < 1 || Number(port) > 65535)
          throw new Error('SELENIUMBASE_INVALID_CDP_ENDPOINT');
        resolveReady(`http://127.0.0.1:${Number(port)}`);
      } catch (error) {
        rejectReady(error as Error);
      }
    }
  };
  let resolveReady: (endpoint: string) => void = () => undefined;
  const onError = (error: Error) => rejectReady(error);
  const onExit = () =>
    rejectReady(new Error('SELENIUMBASE_EXITED_BEFORE_READY'));
  try {
    const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
      resolveReady = resolveEndpoint;
      rejectReady = reject;
      child.stdout.on('data', onData);
      child.once('error', onError);
      child.once('exit', onExit);
      startupTimer = setTimeout(
        () => reject(new Error('SELENIUMBASE_STARTUP_TIMEOUT')),
        60_000,
      );
      if (options.signal?.aborted) onAbort();
    });
    clearTimeout(startupTimer);
    child.stdout.off('data', onData);
    child.stdout.resume();
    buffer = '';
    options.signal?.throwIfAborted();
    const browser = await chromium.connectOverCDP(endpoint, {
      timeout: 15_000,
    });
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error('SELENIUMBASE_DEFAULT_CONTEXT_MISSING');
    }
    let closePromise: Promise<void> | undefined;
    context.close = () =>
      (closePromise ??= Promise.resolve().then(async () => {
        options.signal?.removeEventListener('abort', onAbort);
        // This disconnects Playwright; Python then quits its owned Chrome.
        try {
          await browser.close();
        } finally {
          await stop();
        }
      }));
    browser.once('disconnected', () => {
      void context.close().catch(() => undefined);
    });
    void exit.then(() => context.close()).catch(() => undefined);
    if (options.signal?.aborted || exited) {
      await context.close();
      throw new Error('CSGOEMPIRE_LOGIN_CANCELLED');
    }
    return context;
  } catch (error) {
    options.signal?.removeEventListener('abort', onAbort);
    await stop();
    throw error;
  } finally {
    clearTimeout(startupTimer);
    child.stdout.off('data', onData);
    child.off('error', onError);
    child.off('exit', onExit);
  }
}
