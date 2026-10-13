import { asc, eq } from 'drizzle-orm';
import type { TransactionContext } from '../../../../../shared/infrastructure/database/transaction-context.js';
import type { NotifyConfigRepository } from '../../../application/notify/notify.ports.js';
import {
  NOTIFY_CHANNEL_TYPES,
  type NotifyChannel,
  type NotifyChannelConfig,
  type NotifyChannelType,
  type SignalTier,
} from '../../../domain/notify-channel.js';
import {
  drizzleNotifyChannelsTable as ch,
  drizzleSignalTiersTable as tiers,
} from './drizzle-notify.schema.js';

const toConfig = (
  type: string,
  c: Record<string, string>,
): NotifyChannelConfig | null => {
  if (!NOTIFY_CHANNEL_TYPES.includes(type as NotifyChannelType)) return null;
  if (type === 'telegram')
    return { type, botToken: c.botToken ?? '', chatId: c.chatId ?? '' };
  return { type: type as 'discord' | 'slack', webhookUrl: c.webhookUrl ?? '' };
};

export class DrizzleNotifyConfigRepository implements NotifyConfigRepository {
  constructor(private readonly _tx: TransactionContext) {}

  async listTiers(): Promise<SignalTier[]> {
    const rows = await this._tx.executor
      .select()
      .from(tiers)
      .orderBy(asc(tiers.minMargin));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      minMargin: r.minMargin,
      maxMargin: r.maxMargin,
    }));
  }

  async saveTier(t: SignalTier): Promise<void> {
    const values = {
      id: t.id,
      name: t.name,
      minMargin: t.minMargin,
      maxMargin: t.maxMargin,
    };
    await this._tx.executor
      .insert(tiers)
      .values(values)
      .onConflictDoUpdate({
        target: tiers.id,
        set: { ...values, updatedAt: new Date() },
      });
  }

  deleteTier(id: string): Promise<boolean> {
    return this._tx.run(async () => {
      const rows = await this._tx.executor
        .delete(tiers)
        .where(eq(tiers.id, id))
        .returning({ id: tiers.id });
      if (!rows.length) return false;
      // gỡ hạng khỏi mọi kênh đang chọn nó
      for (const c of await this._tx.executor.select().from(ch))
        if (c.tierIds.includes(id))
          await this._tx.executor
            .update(ch)
            .set({ tierIds: c.tierIds.filter((x) => x !== id) })
            .where(eq(ch.id, c.id));
      return true;
    });
  }

  async listChannels(): Promise<NotifyChannel[]> {
    const rows = await this._tx.executor
      .select()
      .from(ch)
      .orderBy(asc(ch.createdAt));
    return rows.flatMap((r) => {
      const config = toConfig(r.type, r.config);
      return config
        ? [
            {
              id: r.id,
              name: r.name,
              config,
              enabled: r.enabled,
              tierIds: r.tierIds,
            },
          ]
        : [];
    });
  }

  async saveChannel(c: NotifyChannel): Promise<void> {
    const { type, ...config } = c.config;
    const values = {
      id: c.id,
      name: c.name,
      type,
      config: config as Record<string, string>,
      enabled: c.enabled,
      tierIds: [...c.tierIds],
    };
    await this._tx.executor
      .insert(ch)
      .values(values)
      .onConflictDoUpdate({
        target: ch.id,
        set: { ...values, updatedAt: new Date() },
      });
  }

  async deleteChannel(id: string): Promise<boolean> {
    const rows = await this._tx.executor
      .delete(ch)
      .where(eq(ch.id, id))
      .returning({ id: ch.id });
    return rows.length > 0;
  }
}
