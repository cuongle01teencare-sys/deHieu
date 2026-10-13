import type {
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

/** Định dạng theo từng nền tảng. */
export const formatMessage = {
  discord: (m: NotifyMessage) =>
    [
      `**${m.title}**`,
      ...m.lines,
      ...(m.links.length
        ? [m.links.map((l) => `[${l.label}](<${l.url}>)`).join(' · ')]
        : []),
    ].join('\n'),
  slack: (m: NotifyMessage) =>
    [
      `*${m.title}*`,
      ...m.lines,
      ...(m.links.length
        ? [m.links.map((l) => `<${l.url}|${l.label}>`).join(' · ')]
        : []),
    ].join('\n'),
  telegram: (m: NotifyMessage) =>
    [
      `<b>${escapeHtml(m.title)}</b>`,
      ...m.lines.map(escapeHtml),
      ...(m.links.length
        ? [
            m.links
              .map(
                (l) =>
                  `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`,
              )
              .join(' · '),
          ]
        : []),
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
      return this._post(c.webhookUrl, {
        content: formatMessage.discord(m).slice(0, 2000),
        allowed_mentions: { parse: [] },
      });
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
