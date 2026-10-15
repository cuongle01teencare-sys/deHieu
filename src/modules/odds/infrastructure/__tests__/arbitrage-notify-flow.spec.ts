import { ArbitrageEvaluator } from '../../application/arbitrage-evaluator.js';
import { SignalNotifier } from '../../application/notify/signal-notifier.js';
import type {
  NotifyConfigRepository,
  NotifyMessage,
} from '../../application/notify/notify.ports.js';
import type { NotifyChannel, SignalTier } from '../../domain/notify-channel.js';
import { MatchKey } from '../../domain/match-key.js';
import { OddsLine } from '../../domain/odds-line.js';
import { InMemoryOddsRoomStore } from '../persistence/in-memory/in-memory-odds-room.store.js';
import { InMemorySignalStateStore } from '../persistence/in-memory/in-memory-signal-state.store.js';
import { InMemoryArbitrageSettingsStore } from '../settings/in-memory-arbitrage-settings.store.js';

describe('Arbitrage notification routing', () => {
  it('5% -> 9% -> 5% -> 6%: cancel in old channels, issue in matching channels', async () => {
    const tiers: SignalTier[] = [
      { id: 'vip', name: 'VIP', minMargin: 0.05, maxMargin: 0.09 },
      { id: 'super', name: 'SVIP', minMargin: 0.09, maxMargin: null },
    ];
    const channels: NotifyChannel[] = ['vip', 'super'].map((id) => ({
      id,
      name: id,
      enabled: true,
      tierIds: [id],
      config: {
        type: 'discord',
        webhookUrl: `https://discord.com/api/webhooks/${id}`,
      },
    }));
    const repo: NotifyConfigRepository = {
      listTiers: () => Promise.resolve(tiers),
      listChannels: () => Promise.resolve(channels),
      saveTier: () => Promise.resolve(),
      deleteTier: () => Promise.resolve(false),
      saveChannel: () => Promise.resolve(),
      deleteChannel: () => Promise.resolve(false),
    };
    const sent: { channel: string; message: NotifyMessage }[] = [];
    const notifier = new SignalNotifier(repo, {
      send: (channel, message) => {
        sent.push({ channel: channel.id, message });
        return Promise.resolve();
      },
    });
    await notifier.reload();
    const rooms = new InMemoryOddsRoomStore();
    const signals = new InMemorySignalStateStore();
    const evaluator = new ArbitrageEvaluator(
      rooms,
      signals,
      new InMemoryArbitrageSettingsStore(),
      notifier,
    );
    const key = MatchKey.of({
      sport: 'cs2',
      teamX: 'a',
      teamY: 'b',
      market: 'game-winner',
    });
    const evaluateMargin = async (margin: number) => {
      const odds = 2 * (1 + margin);
      for (const [tenant, prices] of [
        ['sptpub', [odds, 1.01]],
        ['polymarket', [1.01, odds]],
      ] as const) {
        await rooms.setLine(
          key,
          OddsLine.create({
            tenant,
            odds: prices,
            status: 'open',
            phase: 'prematch',
            startsAt: 0,
            updatedAt: Date.now(),
            ref: {},
          }),
        );
      }
      await evaluator.evaluate(key);
      await notifier.drain();
      const active = await signals.activeSignals();
      expect(active).toHaveLength(1);
      expect(active[0].margin).toBeCloseTo(margin, 12);
      return active[0].signalId;
    };
    const ids = [];
    for (const margin of [0.05, 0.09, 0.05, 0.06])
      ids.push(await evaluateMargin(margin));
    expect(new Set(ids).size).toBe(4);
    expect(
      sent.map(({ channel, message }) => `${channel}:${message.kind}`),
    ).toEqual([
      'vip:issued',
      'super:issued',
      // 9% không tới kênh vip (khác hạng) → kênh vip vẫn được báo hủy kèo 5%
      'vip:cancelled',
      'super:cancelled',
      'vip:issued',
      // 5% → 6% cùng kênh: không báo hủy, kèo mới hiện là cập nhật
      'vip:updated',
    ]);
    expect(
      sent
        .filter(({ message }) => message.kind !== 'cancelled')
        .map(({ message }) => message.title),
    ).toEqual([
      'K\u00e8o m\u1edbi \u00b7 VIP \u00b7 +5.00%',
      'K\u00e8o m\u1edbi \u00b7 SVIP \u00b7 +9.00%',
      'K\u00e8o m\u1edbi \u00b7 VIP \u00b7 +5.00%',
      'K\u00e8o c\u1eadp nh\u1eadt \u00b7 VIP \u00b7 +6.00%',
    ]);
    expect(
      sent
        .filter(({ message }) => message.kind === 'cancelled')
        .map(({ message }) => message.fields[0].value),
    ).toEqual([
      // 5% → 9% sang kênh khác hạng: kênh cũ vẫn được báo hủy để không treo kèo
      'c\u00f3 k\u00e8o t\u1ed1t h\u01a1n',
      'k\u00e8o kh\u00f4ng c\u00f2n t\u1ed1t n\u1eefa',
    ]);
    expect(evaluator.stats()).toMatchObject({ issued: 4, cancelled: 3 });
  });
});
