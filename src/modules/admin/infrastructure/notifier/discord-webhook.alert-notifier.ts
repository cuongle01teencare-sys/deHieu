import type { AlertNotifier } from '../../application/alert-notifier.js';
import type { Incident } from '../../domain/incident.js';

const COLORS = { critical: 0xe03131, warning: 0xf08c00, resolved: 0x2f9e44 };

/**
 * Gửi cảnh báo qua Discord webhook. Gửi tuần tự (giữ thứ tự mở/đóng), tôn trọng 429 retry_after,
 * timeout 10s; lỗi chỉ ghi log, không bao giờ ném ra (cảnh báo hỏng không được làm hỏng app).
 * URL webhook là bí mật: không ghi vào log.
 */
export class DiscordWebhookAlertNotifier implements AlertNotifier {
  private _chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly _url: string,
    private readonly _onError: (message: string) => void,
    private readonly _username = 'Arbitrage Ops',
    private readonly _fetch: typeof fetch = fetch,
  ) {}

  notify(change: 'opened' | 'resolved', i: Incident): Promise<void> {
    this._chain = this._chain.then(() => this._send(change, i));
    return this._chain;
  }

  private async _send(change: 'opened' | 'resolved', i: Incident) {
    const body = JSON.stringify(this._payload(change, i));
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this._fetch(this._url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return;
        if (res.status === 429) {
          const j = (await res.json().catch(() => ({}))) as {
            retry_after?: number;
          };
          await new Promise((r) =>
            setTimeout(r, Math.min((j.retry_after ?? 1) * 1000, 10_000)),
          );
          continue;
        }
        this._onError(`Discord webhook trả ${res.status} (${i.key})`);
        return;
      } catch (e: unknown) {
        if (attempt === 2)
          this._onError(
            `Discord webhook lỗi (${i.key}): ${e instanceof Error ? e.message : String(e)}`,
          );
      }
    }
  }

  private _payload(change: 'opened' | 'resolved', i: Incident) {
    const resolved = change === 'resolved';
    const durationS =
      resolved && i.resolvedAt
        ? Math.round((i.resolvedAt - i.openedAt) / 1000)
        : null;
    return {
      username: this._username,
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title:
            `${resolved ? '✅ Đã hết' : i.severity === 'critical' ? '🔴 CRITICAL' : '🟠 WARNING'}: ${i.title}`.slice(
              0,
              256,
            ),
          description: (resolved
            ? `Kéo dài ${durationS}s. Lý do đóng: ${i.resolution ?? 'recovered'}`
            : i.message
          ).slice(0, 4000),
          color: resolved ? COLORS.resolved : COLORS[i.severity],
          fields: [
            { name: 'Loại', value: i.kind, inline: true },
            { name: 'Key', value: i.key.slice(0, 1000), inline: true },
          ],
          timestamp: new Date(
            resolved ? (i.resolvedAt ?? Date.now()) : i.openedAt,
          ).toISOString(),
        },
      ],
    };
  }
}
