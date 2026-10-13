import { randomUUID } from 'node:crypto';
import type { OperationStatus } from '../../../../shared/domain/domain-repository.js';
import type {
  NotifyChannel,
  NotifyChannelConfig,
  NotifyChannelType,
  SignalTier,
} from '../../domain/notify-channel.js';
import type { NotifyConfigRepository } from './notify.ports.js';
import type { NotifyChannelStatus, SignalNotifier } from './signal-notifier.js';

export interface TierInput {
  readonly name: string;
  readonly minMargin: number;
  readonly maxMargin: number | null;
}

/** Bí mật (webhookUrl, botToken) bỏ trống khi sửa = giữ giá trị cũ. */
export type ChannelConfigInput =
  | { readonly type: 'discord'; readonly webhookUrl?: string }
  | { readonly type: 'slack'; readonly webhookUrl?: string }
  | {
      readonly type: 'telegram';
      readonly botToken?: string;
      readonly chatId: string;
    };

export interface ChannelInput {
  readonly name: string;
  readonly config: ChannelConfigInput;
  readonly enabled: boolean;
  readonly tierIds: readonly string[];
}

/** Kênh trả về cho web: che bí mật. */
export interface NotifyChannelView {
  readonly id: string;
  readonly name: string;
  readonly type: NotifyChannelType;
  readonly enabled: boolean;
  readonly tierIds: readonly string[];
  /** vd "https://discord.com/api/webhooks/…a1b2" hoặc "chat -100123 · bot …xyz9". */
  readonly target: string;
  readonly status: NotifyChannelStatus;
}

const mask = (s: string) => (s.length <= 4 ? '…' : `…${s.slice(-4)}`);

const targetOf = (c: NotifyChannelConfig): string => {
  if (c.type === 'telegram')
    return `chat ${c.chatId} · bot ${mask(c.botToken)}`;
  try {
    const u = new URL(c.webhookUrl);
    return `${u.origin}/…${c.webhookUrl.slice(-4)}`;
  } catch {
    return mask(c.webhookUrl);
  }
};

const fail = (reason: string) => ({ status: 'FAILED' as const, reason });

/** Use case quản trị hạng kèo + kênh thông báo. Mọi thay đổi ghi Postgres rồi nạp lại notifier. */
export class NotifyAdmin {
  constructor(
    private readonly _repo: NotifyConfigRepository,
    private readonly _notifier: SignalNotifier,
  ) {}

  // ------------------------------------------------------------- hạng kèo

  async listTiers(): Promise<SignalTier[]> {
    return sortTiers(await this._repo.listTiers());
  }

  async saveTier(
    id: string | null,
    input: TierInput,
  ): Promise<OperationStatus<SignalTier>> {
    const name = input.name.trim();
    if (!name) return fail('TIER_NAME_REQUIRED');
    if (input.maxMargin !== null && input.maxMargin <= input.minMargin)
      return fail('TIER_RANGE_INVALID: mức tối đa phải lớn hơn mức tối thiểu');
    const tiers = await this._repo.listTiers();
    if (id && !tiers.some((t) => t.id === id)) return { status: 'NOT_FOUND' };
    if (
      tiers.some(
        (t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase(),
      )
    )
      return fail(`TIER_NAME_TAKEN: đã có hạng "${name}"`);
    const tier: SignalTier = {
      id: id ?? randomUUID(),
      name,
      minMargin: input.minMargin,
      maxMargin: input.maxMargin,
    };
    await this._repo.saveTier(tier);
    await this._notifier.reload();
    return { status: 'SUCEED', data: tier };
  }

  async deleteTier(id: string): Promise<OperationStatus<true>> {
    if (!(await this._repo.deleteTier(id))) return { status: 'NOT_FOUND' };
    await this._notifier.reload();
    return { status: 'SUCEED', data: true };
  }

  // ------------------------------------------------------------- kênh

  async listChannels(): Promise<NotifyChannelView[]> {
    return (await this._repo.listChannels()).map((c) => this._view(c));
  }

  async saveChannel(
    id: string | null,
    input: ChannelInput,
  ): Promise<OperationStatus<NotifyChannelView>> {
    const name = input.name.trim();
    if (!name) return fail('CHANNEL_NAME_REQUIRED');
    const [channels, tiers] = await Promise.all([
      this._repo.listChannels(),
      this._repo.listTiers(),
    ]);
    const old = id ? channels.find((c) => c.id === id) : undefined;
    if (id && !old) return { status: 'NOT_FOUND' };
    const unknown = input.tierIds.filter((t) => !tiers.some((x) => x.id === t));
    if (unknown.length) return fail(`UNKNOWN_TIER: ${unknown.join(', ')}`);

    const config = mergeConfig(input.config, old?.config);
    if (typeof config === 'string') return fail(config);
    const channel: NotifyChannel = {
      id: id ?? randomUUID(),
      name,
      config,
      enabled: input.enabled,
      tierIds: [...new Set(input.tierIds)],
    };
    await this._repo.saveChannel(channel);
    await this._notifier.reload();
    return { status: 'SUCEED', data: this._view(channel) };
  }

  async deleteChannel(id: string): Promise<OperationStatus<true>> {
    if (!(await this._repo.deleteChannel(id))) return { status: 'NOT_FOUND' };
    await this._notifier.reload();
    return { status: 'SUCEED', data: true };
  }

  async testChannel(id: string): Promise<OperationStatus<true>> {
    const ch = (await this._repo.listChannels()).find((c) => c.id === id);
    if (!ch) return { status: 'NOT_FOUND' };
    try {
      await this._notifier.sendTest(ch);
      return { status: 'SUCEED', data: true };
    } catch (e: unknown) {
      return fail(`SEND_FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private _view(c: NotifyChannel): NotifyChannelView {
    return {
      id: c.id,
      name: c.name,
      type: c.config.type,
      enabled: c.enabled,
      tierIds: c.tierIds,
      target: targetOf(c.config),
      status: this._notifier.status(c.id),
    };
  }
}

export const sortTiers = (tiers: SignalTier[]): SignalTier[] =>
  [...tiers].sort(
    (a, b) => a.minMargin - b.minMargin || a.name.localeCompare(b.name),
  );

/** Ghép cấu hình mới với cũ (bí mật bỏ trống = giữ cũ). Lỗi → chuỗi lý do. */
function mergeConfig(
  input: ChannelConfigInput,
  old: NotifyChannelConfig | undefined,
): NotifyChannelConfig | string {
  const same = old?.type === input.type ? old : undefined;
  if (input.type === 'telegram') {
    const botToken =
      input.botToken?.trim() ||
      (same?.type === 'telegram' ? same.botToken : '');
    if (!botToken) return 'BOT_TOKEN_REQUIRED';
    const chatId = input.chatId.trim();
    if (!chatId) return 'CHAT_ID_REQUIRED';
    return { type: 'telegram', botToken, chatId };
  }
  const webhookUrl =
    input.webhookUrl?.trim() ||
    (same && same.type !== 'telegram' ? same.webhookUrl : '');
  if (!webhookUrl) return 'WEBHOOK_URL_REQUIRED';
  if (!/^https:\/\//.test(webhookUrl))
    return 'WEBHOOK_URL_INVALID: phải là https://';
  return { type: input.type, webhookUrl };
}
