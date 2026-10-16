import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  closeAllProfiles,
  closeProfile,
  launchProfile,
} from '../src/shared/infrastructure/trading/empire-session.js';

// Uses a disposable profile and local content; never accesses trading accounts.
const runtimeRoot = resolve('.trading');
await mkdir(runtimeRoot, { recursive: true });
const root = await mkdtemp(resolve(runtimeRoot, 'browser-smoke-'));
process.env.TRADING_BROWSER_ROOT = root;
process.env.TRADING_BROWSER_ENGINE = 'seleniumbase';
try {
  const first = await launchProfile('smoke');
  const page = first.pages()[0] ?? (await first.newPage());
  await page.goto('data:text/html,<title>CDP smoke</title>');
  assert.equal(await page.title(), 'CDP smoke');
  assert.equal(await page.evaluate(() => navigator.webdriver), false);
  await first.addCookies([
    {
      name: 'smoke-cookie',
      value: 'persisted',
      domain: 'example.test',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);
  assert.throws(() => launchProfile('smoke'), /BROWSER_PROFILE_IN_USE/);
  await Promise.all([first.close(), closeProfile('smoke')]);
  console.log('CDP attach, page control, and idempotent teardown: OK');

  const second = await launchProfile('smoke');
  assert.equal(
    (await second.cookies('https://example.test')).find(
      (cookie) => cookie.name === 'smoke-cookie',
    )?.value,
    'persisted',
  );
  await closeAllProfiles();
  console.log('Restart and persistent cookies: OK');

  const controller = new AbortController();
  const starting = launchProfile('cancelled', { signal: controller.signal });
  const rejected = assert.rejects(starting);
  const timer = setTimeout(() => controller.abort(), 250);
  try {
    await rejected;
  } finally {
    clearTimeout(timer);
  }
  await closeAllProfiles();
  console.log('Cancellation and shutdown: OK');
} finally {
  await closeAllProfiles();
  assert.equal(dirname(root), runtimeRoot);
  await rm(root, { recursive: true, force: true });
}
