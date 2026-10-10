import type { Incident } from '../../domain/incident.js';
import { DiscordWebhookAlertNotifier } from '../notifier/discord-webhook.alert-notifier.js';

const incident: Incident = {
  id: '1',
  key: 'source.stale:t1',
  kind: 'source.stale',
  severity: 'critical',
  title: 'Nguồn im lặng: t1',
  message: '40s không có dữ liệu',
  details: {},
  openedAt: 1_000,
  lastSeenAt: 1_000,
  resolvedAt: null,
  resolution: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
};

const res = (status: number, body: unknown = {}) =>
  ({ ok: status < 300, status, json: () => Promise.resolve(body) }) as Response;

describe('DiscordWebhookAlertNotifier', () => {
  it('gửi embed, tôn trọng 429 retry_after rồi gửi lại', async () => {
    const calls: { url: string; body: string }[] = [];
    const replies = [res(429, { retry_after: 0.01 }), res(204)];
    const fetchMock = ((url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as string });
      return Promise.resolve(replies.shift()!);
    }) as unknown as typeof fetch;
    const errors: string[] = [];
    const n = new DiscordWebhookAlertNotifier(
      'https://hook',
      (m) => errors.push(m),
      'Ops',
      fetchMock,
    );

    await n.notify('opened', incident);
    expect(calls).toHaveLength(2);
    const body = JSON.parse(calls[1].body) as {
      embeds: { title: string; color: number }[];
    };
    expect(body.embeds[0]?.title).toContain('CRITICAL');
    expect(errors).toEqual([]);
  });

  it('lỗi mạng không ném ra, chỉ báo lỗi (không lộ URL)', async () => {
    const fetchMock = (() =>
      Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch;
    const errors: string[] = [];
    const n = new DiscordWebhookAlertNotifier(
      'https://secret-hook',
      (m) => errors.push(m),
      'Ops',
      fetchMock,
    );
    await expect(
      n.notify('resolved', { ...incident, resolvedAt: 5_000 }),
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain('secret-hook');
  });
});
