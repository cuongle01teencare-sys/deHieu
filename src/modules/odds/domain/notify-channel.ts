/**
 * Hạng kèo do admin tự đặt (vd "VIP" ≥ 5%, "Super VIP" ≥ 10%) và kênh nhận kèo
 * (Discord webhook, Telegram bot, Slack webhook). Không hardcode tên hạng.
 */
export interface SignalTier {
  readonly id: string;
  readonly name: string;
  /** Lợi nhuận tối thiểu (bao gồm), vd 0.05 = 5%. */
  readonly minMargin: number;
  /** Lợi nhuận tối đa (KHÔNG bao gồm); null = không giới hạn. */
  readonly maxMargin: number | null;
}

export const NOTIFY_CHANNEL_TYPES = ['discord', 'telegram', 'slack'] as const;
export type NotifyChannelType = (typeof NOTIFY_CHANNEL_TYPES)[number];

export type NotifyChannelConfig =
  | { readonly type: 'discord'; readonly webhookUrl: string }
  | { readonly type: 'slack'; readonly webhookUrl: string }
  | {
      readonly type: 'telegram';
      readonly botToken: string;
      /** id chat/nhóm/kênh, vd "-1001234567890" hoặc "@ten_kenh". */
      readonly chatId: string;
    };

export interface NotifyChannel {
  readonly id: string;
  readonly name: string;
  readonly config: NotifyChannelConfig;
  readonly enabled: boolean;
  /** Hạng kèo kênh này nhận. Rỗng = nhận mọi kèo. */
  readonly tierIds: readonly string[];
}

export const tierMatches = (tier: SignalTier, margin: number): boolean =>
  margin >= tier.minMargin &&
  (tier.maxMargin === null || margin < tier.maxMargin);

/**
 * Kênh có nhận kèo lợi nhuận `margin` không; trả về hạng khớp cao nhất (để ghi lên tin nhắn).
 * - kênh tắt → null
 * - kênh không chọn hạng → nhận mọi kèo (tier = hạng khớp cao nhất trong toàn bộ, có thể không có)
 * - kênh chọn hạng → nhận khi khớp ít nhất một hạng đã chọn
 */
export const routeSignal = (
  channel: NotifyChannel,
  tiers: readonly SignalTier[],
  margin: number,
): { readonly tier: SignalTier | null } | null => {
  if (!channel.enabled) return null;
  const pool = channel.tierIds.length
    ? tiers.filter((t) => channel.tierIds.includes(t.id))
    : tiers;
  const matched = pool
    .filter((t) => tierMatches(t, margin))
    .sort((a, b) => b.minMargin - a.minMargin);
  if (channel.tierIds.length && !matched.length) return null;
  return { tier: matched[0] ?? null };
};
