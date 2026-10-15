import type {
  PushMessage,
  PushResult,
  PushSender,
} from '../../application/one-click-notifier.js';

export interface OneSignalOptions {
  readonly appId: string;
  /** REST API Key (OneSignal → Settings → Keys & IDs). Bí mật, chỉ ở backend. */
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
}

/**
 * Gửi push qua OneSignal REST API tới thiết bị đã bật thông báo trên web Arb Ops và để mục
 * "Kèo" bật (tag `signals` = 1, web gắn khi lưu tùy chọn ở trang Thông báo).
 */
export class OneSignalPushSender implements PushSender {
  constructor(
    private readonly _o: OneSignalOptions,
    private readonly _fetch: typeof fetch = fetch,
  ) {}

  async send(m: PushMessage): Promise<PushResult> {
    const res = await this._fetch(
      this._o.endpoint ?? 'https://api.onesignal.com/notifications?c=push',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          // key mới (os_v2_…) dùng "Key", key REST cũ dùng "Basic"
          Authorization: `${this._o.apiKey.startsWith('os_v2_') ? 'Key' : 'Basic'} ${this._o.apiKey}`,
        },
        body: JSON.stringify({
          app_id: this._o.appId,
          target_channel: 'push',
          ...(m.subscriptionIds?.length
            ? { include_subscription_ids: [...m.subscriptionIds] }
            : {
                filters: [
                  { field: 'tag', key: 'signals', relation: '=', value: '1' },
                ],
              }),
          headings: { en: m.title },
          contents: { en: m.body },
          ...(m.url ? { url: m.url } : {}),
          collapse_id: m.collapseId,
          web_push_topic: m.collapseId,
          ttl: m.ttlSec,
          priority: 10,
        }),
        signal: AbortSignal.timeout(this._o.timeoutMs ?? 10_000),
      },
    );
    if (!res.ok)
      throw new Error(
        `OneSignal ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`,
      );
    // OneSignal trả 200 kèm errors khi không có thiết bị nào khớp — không coi là lỗi gửi
    const body = (await res.json().catch(() => ({}))) as {
      id?: unknown;
      errors?: unknown;
    };
    return {
      id: typeof body.id === 'string' && body.id ? body.id : null,
      errors: errorsOf(body.errors),
    };
  }
}

/** errors của OneSignal: mảng chuỗi hoặc object (vd { invalid_player_ids: [...] }). */
function errorsOf(e: unknown): string[] {
  if (!e) return [];
  if (Array.isArray(e)) return e.map(String);
  if (typeof e === 'object')
    return Object.entries(e as Record<string, unknown>).map(
      ([k, v]) => `${k}: ${JSON.stringify(v)}`,
    );
  return [JSON.stringify(e)];
}
