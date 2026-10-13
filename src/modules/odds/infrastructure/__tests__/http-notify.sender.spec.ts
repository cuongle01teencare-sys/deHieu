import {
  HttpNotifySender,
  formatMessage,
} from '../notify/http-notify.sender.js';
import type { NotifyChannel } from '../../domain/notify-channel.js';

const msg = {
  title: 'Kèo mới · VIP · +5.00%',
  lines: ['CS2 · a <b> vs b'],
  links: [{ label: 'polymarket', url: 'https://polymarket.com/event/x' }],
};

describe('HttpNotifySender', () => {
  it('định dạng theo từng nền tảng', () => {
    expect(formatMessage.discord(msg)).toContain('**Kèo mới');
    expect(formatMessage.slack(msg)).toContain(
      '<https://polymarket.com/event/x|polymarket>',
    );
    expect(formatMessage.telegram(msg)).toContain('a &lt;b&gt; vs b');
  });

  it('telegram: gọi Bot API sendMessage; 429 → chờ retry_after rồi thử lại', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let first = true;
    const fetchFn = vi.fn((url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(init.body as string) as Record<string, unknown>,
      });
      if (first) {
        first = false;
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: false, parameters: { retry_after: 0.01 } }),
            {
              status: 429,
            },
          ),
        );
      }
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });
    const sender = new HttpNotifySender({
      fetch: fetchFn as unknown as typeof fetch,
    });
    const ch: NotifyChannel = {
      id: '1',
      name: 'tg',
      enabled: true,
      tierIds: [],
      config: { type: 'telegram', botToken: 'TOKEN', chatId: '-100' },
    };
    await sender.send(ch, msg);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    expect(calls[1]?.body).toMatchObject({
      chat_id: '-100',
      parse_mode: 'HTML',
    });
  });

  it('lỗi telegram không làm lộ bot token', async () => {
    const fetchFn = () =>
      Promise.resolve(new Response('Unauthorized', { status: 401 }));
    const sender = new HttpNotifySender({
      fetch: fetchFn as unknown as typeof fetch,
    });
    const ch: NotifyChannel = {
      id: '1',
      name: 'tg',
      enabled: true,
      tierIds: [],
      config: { type: 'telegram', botToken: 'SECRET', chatId: '-100' },
    };
    await expect(sender.send(ch, msg)).rejects.toThrow(/^Telegram HTTP 401/);
    await expect(sender.send(ch, msg)).rejects.not.toThrow(/SECRET/);
  });
});
