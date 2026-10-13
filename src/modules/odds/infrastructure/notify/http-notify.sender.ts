import type {
  NotifyKind,
  NotifyMessage,
  NotifySender,
} from '../../application/notify/notify.ports.js';
import type { NotifyChannel } from '../../domain/notify-channel.js';

export interface HttpNotifySenderOptions {
  readonly timeoutMs: number;
  /** Bị giới hạn tốc độ (429) thì chờ theo server rồi thử lại tối đa ngần này lần. */
  readonly maxRetries: number;
  /** Chờ tối đa cho một lần 429 (server bảo chờ lâu hơn → bỏ). */
  readonly maxRetryWaitMs: number;
  readonly telegramApi: string;
  readonly fetch: typeof fetch;
}

const DEFAULTS: HttpNotifySenderOptions = {
  timeoutMs: 10_000,
  maxRetries: 3,
  maxRetryWaitMs: 30_000,
  telegramApi: 'https://api.telegram.org',
  fetch: (...a) => fetch(...a),
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Màu thanh bên của embed Discord theo loại tin. */
const DISCORD_COLOR: Record<NotifyKind, number> = {
  issued: 0x22c55e, // xanh lá: kèo mới
  updated: 0x3b82f6, // xanh dương: kèo ghi đè
  cancelled: 0x6b7280, // xám: kèo hủy
  test: 0xa855f7,
};

const MARK: Record<NotifyKind, string> = {
  issued: '🟢',
  updated: '🔵',
  cancelled: '⚪',
  test: '🟣',
};

const cut = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** **đậm** + [nhãn](url) → cú pháp từng nền tảng (nội dung do app tạo, không phải người dùng). */
const toTelegram = (s: string) =>
  escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[(.+?)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
const toSlack = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[(.+?)\]\((https?:[^)\s]+)\)/g, '<$2|$1>');

/** Định dạng theo từng nền tảng. */
export const formatMessage = {
  /** Discord: embed có màu, các cửa cược đặt cạnh nhau. */
  discord: (m: NotifyMessage) => ({
    embeds: [
      {
        title: cut(`${MARK[m.kind]} ${m.title}`, 256),
        ...(m.description ? { description: cut(m.description, 4096) } : {}),
        color: DISCORD_COLOR[m.kind],
        fields: m.fields.slice(0, 25).map((f) => ({
          name: cut(f.name, 256),
          value: cut(f.value, 1024),
          inline: f.inline ?? false,
        })),
        ...(m.footer ? { footer: { text: cut(m.footer, 2048) } } : {}),
        timestamp: new Date(m.at).toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  }),
  slack: (m: NotifyMessage) =>
    [
      `${MARK[m.kind]} *${m.title}*`,
      ...(m.description ? [toSlack(m.description)] : []),
      '',
      ...m.fields.flatMap((f) => [`*${f.name}*`, toSlack(f.value), '']),
      ...(m.footer ? [`_${m.footer}_`] : []),
    ].join('\n'),
  telegram: (m: NotifyMessage) =>
    [
      `${MARK[m.kind]} <b>${escapeHtml(m.title)}</b>`,
      ...(m.description ? [toTelegram(m.description)] : []),
      '',
      ...m.fields.flatMap((f) => [
        `<b>${escapeHtml(f.name)}</b>`,
        toTelegram(f.value),
        '',
      ]),
      ...(m.footer ? [`<i>${escapeHtml(m.footer)}</i>`] : []),
    ].join('\n'),
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
  }
}

/** Gửi tới Discord webhook / Telegram Bot API / Slack incoming webhook bằng fetch. */
export class HttpNotifySender implements NotifySender {
  private readonly _opts: HttpNotifySenderOptions;

  constructor(opts: Partial<HttpNotifySenderOptions> = {}) {
    this._opts = { ...DEFAULTS, ...opts };
  }

  async send(channel: NotifyChannel, message: NotifyMessage): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this._sendOnce(channel, message);
      } catch (e: unknown) {
        const wait = e instanceof HttpError ? e.retryAfterMs : null;
        if (
          wait === null ||
          attempt >= this._opts.maxRetries ||
          wait > this._opts.maxRetryWaitMs
        )
          throw e;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  private async _sendOnce(ch: NotifyChannel, m: NotifyMessage) {
    const c = ch.config;
    if (c.type === 'discord')
      return this._post(c.webhookUrl, formatMessage.discord(m));
    if (c.type === 'slack')
      return this._post(c.webhookUrl, { text: formatMessage.slack(m) });
    return this._post(
      `${this._opts.telegramApi}/bot${c.botToken}/sendMessage`,
      {
        chat_id: c.chatId,
        text: formatMessage.telegram(m).slice(0, 4096),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      // không để lộ bot token trong thông báo lỗi
      'Telegram',
    );
  }

  private async _post(url: string, body: unknown, label?: string) {
    const res = await this._opts.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this._opts.timeoutMs),
    });
    if (res.ok) return;
    const text = await res.text().catch(() => '');
    let retryAfterMs: number | null = null;
    if (res.status === 429) {
      const header = Number(res.headers.get('retry-after'));
      let fromBody: number | undefined;
      try {
        const j = JSON.parse(text) as {
          retry_after?: number;
          parameters?: { retry_after?: number };
        };
        fromBody = j.retry_after ?? j.parameters?.retry_after;
      } catch {
        /* không phải JSON */
      }
      const sec = fromBody ?? (Number.isFinite(header) ? header : 1);
      retryAfterMs = Math.ceil(sec * 1000);
    }
    const where = label ?? new URL(url).host;
    throw new HttpError(
      res.status,
      `${where} HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      retryAfterMs,
    );
  }
}
