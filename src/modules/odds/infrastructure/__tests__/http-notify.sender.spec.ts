import {
  HttpNotifySender,
  formatMessage,
} from '../notify/http-notify.sender.js';
import type { NotifyChannel } from '../../domain/notify-channel.js';

import { issuedMessage } from '../../application/notify/signal-message.js';
import type { NotifyMessage } from '../../application/notify/notify.ports.js';
import type { ArbitrageSignal } from '../../domain/arbitrage-signal.js';

const msg: NotifyMessage = {
  kind: 'issued',
  title: 'Kèo mới · VIP · +5.00%',
  description: '**CS2** · a <b> vs b',
  fields: [
    {
      name: '1. polymarket',
      value: '**a** @ **2.100**\n[Mở trận](https://polymarket.com/event/x)',
      inline: true,
    },
  ],
  links: [{ label: 'polymarket', url: 'https://polymarket.com/event/x' }],
  footer: 'Hết hạn 15:00:00 · s1',
  at: 0,
};

describe('HttpNotifySender', () => {
  it('Discord: embed có màu theo loại tin, field cạnh nhau, không ping ai', () => {
    const body = formatMessage.discord(msg);
    const [e] = body.embeds;
    expect(e?.title).toBe('🟢 Kèo mới · VIP · +5.00%');
    expect(e?.color).toBe(0x22c55e);
    expect(e).not.toHaveProperty('url'); // tiêu đề không dẫn lệch về một sàn
    expect(e?.fields[0]).toMatchObject({ name: '1. polymarket', inline: true });
    expect(e?.footer?.text).toContain('s1');
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(
      formatMessage.discord({ ...msg, kind: 'cancelled' }).embeds[0]?.color,
    ).toBe(0x6b7280);
  });

  it('Telegram (HTML) và Slack (mrkdwn): chuyển chữ đậm + link, escape HTML', () => {
    const tg = formatMessage.telegram(msg);
    expect(tg).toContain('<b>CS2</b> · a &lt;b&gt; vs b');
    expect(tg).toContain(
      '<a href="https://polymarket.com/event/x">Mở trận</a>',
    );
    const sl = formatMessage.slack(msg);
    expect(sl).toContain('*CS2*');
    expect(sl).toContain('<https://polymarket.com/event/x|Mở trận>');
  });

  it('kèo mới: chia vốn đúng để lời bằng nhau, đủ thông tin hai cửa', () => {
    const sig: ArbitrageSignal = {
      signalId: 's1',
      room: 'room:cs2:a~b:game-winner',
      sport: 'cs2',
      market: 'game-winner',
      teams: ['a', 'b'],
      comboId: 'x',
      phase: 'prematch',
      margin: 1 / (1 / 2.2 + 1 / 2.2) - 1,
      legs: [
        { tenant: 'sptpub', side: 0, pick: 'a', odds: 2.2, ref: {} },
        {
          tenant: 'polymarket',
          side: 1,
          pick: 'b',
          odds: 2.2,
          ref: { url: 'https://polymarket.com/event/x' },
        },
      ],
      issuedAt: 0,
      expiresAt: 30_000,
    };
    const m = issuedMessage(
      sig,
      { id: 't', name: 'VIP', minMargin: 0.05, maxMargin: null },
      false,
    );
    expect(m.title).toBe('Kèo mới · VIP · +10.00%');
    expect(m.fields.map((f) => f.name)).toEqual([
      'Cửa 1 · sptpub',
      'Cửa 2 · polymarket',
      'Lợi nhuận',
    ]);
    expect(m.fields[0]?.value).toContain('vốn **50.0%**');
    // chỉ polymarket có link → không gắn link nào (không dẫn lệch về một sàn)
    expect(m.links).toEqual([]);
    expect(m.fields.some((f) => f.value.includes('Mở trang'))).toBe(false);
    expect(m.fields[2]?.value).toContain('nhận về **110.00**');

    const both = issuedMessage(
      {
        ...sig,
        legs: [
          { ...sig.legs[0], ref: { url: 'https://csgoempire.com/x' } },
          sig.legs[1],
        ],
      },
      null,
      false,
    );
    expect(both.links.map((l) => l.label)).toEqual(['sptpub', 'polymarket']);
    expect(both.fields[0]?.value).toContain(
      '[Mở trang sptpub](https://csgoempire.com/x)',
    );
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
