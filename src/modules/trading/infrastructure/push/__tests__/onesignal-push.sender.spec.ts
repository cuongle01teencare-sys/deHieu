import { describe, expect, it } from 'vitest';
import { OneSignalPushSender } from '../onesignal-push.sender.js';

describe('OneSignalPushSender', () => {
  it('OneSignal: gọi REST API với app id, key, lọc tag "signals" = 1; lỗi HTTP ném rõ', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = new OneSignalPushSender(
      { appId: 'app', apiKey: 'os_v2_app_key' },
      ((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(new Response('{"id":"x"}', { status: 200 }));
      }) as unknown as typeof fetch,
    );
    await ok.send({
      title: 't',
      body: 'b',
      url: 'https://x/on-click',
      collapseId: 'c',
      ttlSec: 60,
    });
    expect(calls[0]?.url).toContain('api.onesignal.com/notifications');
    expect(
      (calls[0]?.init.headers as Record<string, string>).Authorization,
    ).toBe('Key os_v2_app_key');
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({
      app_id: 'app',
      target_channel: 'push',
      filters: [{ field: 'tag', key: 'signals', relation: '=', value: '1' }],
      headings: { en: 't' },
      contents: { en: 'b' },
      url: 'https://x/on-click',
      collapse_id: 'c',
      ttl: 60,
    });
    const bad = new OneSignalPushSender({ appId: 'app', apiKey: 'key' }, () =>
      Promise.resolve(new Response('invalid key', { status: 403 })),
    );
    await expect(
      bad.send({
        title: 't',
        body: 'b',
        url: null,
        collapseId: 'c',
        ttlSec: 60,
      }),
    ).rejects.toThrow(/OneSignal 403/);
  });
});
