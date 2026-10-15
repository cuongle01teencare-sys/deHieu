import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const globals = ['window', 'navigator', 'Notification', 'localStorage'];
const originals = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalAppId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
let moduleId = 0;

afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  if (originalAppId === undefined) delete process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  else process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID = originalAppId;
});

async function setup(appId = 'test-app-id') {
  process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID = appId;
  const scripts = [];
  const storage = new Map();
  const calls = { init: [], permission: 0, optIn: 0, tags: [] };
  const notification = { permission: 'default' };
  const window = {
    isSecureContext: true,
    Notification: notification,
    PushManager: class {},
    location: { hostname: 'localhost' },
    matchMedia: () => ({ matches: false }),
  };
  const navigator = { userAgent: 'test', platform: 'test', maxTouchPoints: 0, serviceWorker: {} };
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  for (const [key, value] of Object.entries({ window, navigator, Notification: notification, localStorage })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const sdk = {
    init: async (options) => { calls.init.push(options); },
    Notifications: {
      requestPermission: async () => { calls.permission++; notification.permission = 'granted'; },
    },
    User: {
      addTags: (tags) => { calls.tags.push(tags); },
      PushSubscription: {
        id: undefined,
        optedIn: false,
        optIn: async () => {
          calls.optIn++;
          sdk.User.PushSubscription.id = 'subscription-id';
          sdk.User.PushSubscription.optedIn = true;
        },
      },
    },
  };
  // Only the loader touches document; keep it scoped to this test and restore afterwards.
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ remove() {} }), head: { appendChild: (script) => scripts.push(script) } },
  });
  const restoreDocument = () => {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else delete globalThis.document;
  };
  const push = await import(`../lib/push.ts?test=${moduleId++}`);
  return { push, scripts, sdk, calls, window, navigator, notification, storage, restoreDocument };
}

test('empty App ID does not load SDK or ask for permission', async (t) => {
  const env = await setup(' ');
  t.after(env.restoreDocument);
  await env.push.initializePush();
  assert.equal(env.push.pushSdkState(), 'disabled');
  assert.equal(env.scripts.length, 0);
  await assert.rejects(env.push.requestPush(), /chưa sẵn sàng/);
  assert.equal(env.calls.permission, 0);
});

test('initializes once, isolates worker scope, and syncs preferences saved before SDK ready', async (t) => {
  const env = await setup();
  t.after(env.restoreDocument);
  env.push.savePrefs({ ...env.push.DEFAULT_PREFS, signalThreshold: 0.05, quietHours: true, actionableOnly: true });
  const first = env.push.initializePush();
  assert.equal(env.push.initializePush(), first);
  assert.equal(env.scripts.length, 1);
  assert.equal(env.calls.tags.length, 0);
  env.window.OneSignalDeferred[0](env.sdk);
  await first;
  assert.equal(env.push.pushSdkState(), 'ready');
  assert.equal(env.calls.init.length, 1);
  const options = env.calls.init[0];
  assert.equal(options.serviceWorkerPath, 'push/onesignal/OneSignalSDKWorker.js');
  assert.equal(options.serviceWorkerParam.scope, '/push/onesignal/');
  assert.equal(options.promptOptions.slidedown.prompts[0].autoPrompt, false);
  assert.equal(env.calls.permission, 0);
  const tags = env.calls.tags.at(-1);
  assert.equal(Object.keys(tags).length, 6);
  assert.equal(tags.signal_threshold, '0.05');
  assert.deepEqual(JSON.parse(tags.delivery_prefs), { quiet: '23:00-07:00', actionable: true });
  await env.push.requestPush();
  assert.equal(env.calls.permission, 1);
  assert.equal(env.calls.optIn, 1);
  assert.equal(env.push.pushSubscribed(), true);
  env.push.savePrefs({ ...env.push.DEFAULT_PREFS, warning: true });
  assert.equal(env.calls.tags.at(-1).warning, '1');
});

test('granted permission alone is not a subscription; optIn restores an opted out device', async (t) => {
  const env = await setup();
  t.after(env.restoreDocument);
  env.notification.permission = 'granted';
  const init = env.push.initializePush();
  env.window.OneSignalDeferred[0](env.sdk);
  await init;
  assert.equal(env.push.pushSubscribed(), false);
  await env.push.requestPush();
  assert.equal(env.calls.permission, 0);
  assert.equal(env.calls.optIn, 1);
  assert.equal(env.push.pushSubscribed(), true);
});

test('script failure reports error and never falls back to a local permission prompt', async (t) => {
  const env = await setup();
  t.after(env.restoreDocument);
  const init = env.push.initializePush();
  const rejected = assert.rejects(init, /Không tải được OneSignal/);
  env.scripts[0].onerror();
  await rejected;
  assert.equal(env.push.pushSdkState(), 'error');
  await assert.rejects(env.push.requestPush(), /chưa sẵn sàng/);
  assert.equal(env.calls.permission, 0);
});

test('SDK init failure is surfaced without treating the device as subscribed', async (t) => {
  const env = await setup();
  t.after(env.restoreDocument);
  env.sdk.init = async () => { throw new Error('invalid app ID'); };
  const init = env.push.initializePush();
  env.window.OneSignalDeferred[0](env.sdk);
  await assert.rejects(init, /invalid app ID/);
  assert.equal(env.push.pushSdkState(), 'error');
  assert.equal(env.push.pushSubscribed(), false);
});

test('iOS outside home screen and insecure contexts do not load the SDK', async (t) => {
  const env = await setup();
  t.after(env.restoreDocument);
  env.navigator.userAgent = 'iPhone';
  assert.equal(env.push.pushSupport(), 'ios-needs-install');
  await env.push.initializePush();
  assert.equal(env.scripts.length, 0);
  env.navigator.userAgent = 'test';
  env.window.isSecureContext = false;
  assert.equal(env.push.pushSupport(), 'unsupported');
  await env.push.initializePush();
  assert.equal(env.scripts.length, 0);
});
