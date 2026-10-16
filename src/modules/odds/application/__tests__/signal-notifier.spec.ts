import { SignalNotifier } from '../notify/signal-notifier.js';
import { NotifyAdmin } from '../notify/notify-admin.js';
import type {
  NotifyConfigRepository,
  NotifyMessage,
  NotifySender,
} from '../notify/notify.ports.js';
import type { NotifyChannel, SignalTier } from '../../domain/notify-channel.js';
import type { ArbitrageSignal } from '../../domain/arbitrage-signal.js';
import {
  ArbitrageSignalCancelled,
  ArbitrageSignalIssued,
  ArbitrageSignalRefreshed,
} from '../../domain/events/arbitrage-signal.events.js';

class MemRepo implements NotifyConfigRepository {
  tiers: SignalTier[] = [];
  channels: NotifyChannel[] = [];
  listTiers() {
    return Promise.resolve([...this.tiers]);
  }
  saveTier(t: SignalTier) {
    this.tiers = [...this.tiers.filter((x) => x.id !== t.id), t];
    return Promise.resolve();
  }
  deleteTier(id: string) {
    const had = this.tiers.some((t) => t.id === id);
    this.tiers = this.tiers.filter((t) => t.id !== id);
    this.channels = this.channels.map((c) => ({
      ...c,
      tierIds: c.tierIds.filter((x) => x !== id),
    }));
    return Promise.resolve(had);
  }
  listChannels() {
    return Promise.resolve([...this.channels]);
  }
  saveChannel(c: NotifyChannel) {
    this.channels = [...this.channels.filter((x) => x.id !== c.id), c];
    return Promise.resolve();
  }
  deleteChannel(id: string) {
    const had = this.channels.some((c) => c.id === id);
    this.channels = this.channels.filter((c) => c.id !== id);
    return Promise.resolve(had);
  }
}

class FakeSender implements NotifySender {
  sent: { channel: string; message: NotifyMessage }[] = [];
  failFor = new Set<string>();
  send(channel: NotifyChannel, message: NotifyMessage) {
    if (this.failFor.has(channel.id))
      return Promise.reject(new Error('HTTP 404'));
    this.sent.push({ channel: channel.name, message });
    return Promise.resolve();
  }
}

const signal = (id: string, margin: number): ArbitrageSignal => ({
  signalId: id,
  room: 'room:cs2:a~b:game-winner',
  sport: 'cs2',
  market: 'game-winner',
  teams: ['a', 'b'],
  comboId: 'sptpub>0|polymarket>1',
  phase: 'prematch',
  margin,
  legs: [
    { tenant: 'sptpub', side: 0, pick: 'a', odds: 2.2, ref: {}, startsAt: 0 },
    {
      tenant: 'polymarket',
      side: 1,
      startsAt: 0,
      pick: 'b',
      odds: 2.2,
      ref: { url: 'https://polymarket.com/event/x' },
    },
  ],
  issuedAt: Date.now(),
  expiresAt: Date.now() + 30_000,
});

const setup = async () => {
  const repo = new MemRepo();
  const sender = new FakeSender();
  const notifier = new SignalNotifier(repo, sender);
  const admin = new NotifyAdmin(repo, notifier);
  const vip = await admin.saveTier(null, {
    name: 'Kim cương',
    minMargin: 0.05,
    maxMargin: null,
  });
  const sup = await admin.saveTier(null, {
    name: 'Siêu cấp',
    minMargin: 0.1,
    maxMargin: null,
  });
  if (vip.status !== 'SUCEED' || sup.status !== 'SUCEED') throw new Error();
  const add = async (name: string, tierIds: string[]) => {
    const r = await admin.saveChannel(null, {
      name,
      enabled: true,
      tierIds,
      config: {
        type: 'discord',
        webhookUrl: `https://discord.com/api/webhooks/${name}`,
      },
    });
    if (r.status !== 'SUCEED') throw new Error(JSON.stringify(r));
    return r.data.id;
  };
  return { repo, sender, notifier, admin, vip: vip.data, sup: sup.data, add };
};

describe('SignalNotifier — phân kênh theo hạng kèo admin tự đặt', () => {
  it('kèo 6% chỉ tới kênh chọn hạng ≥5% và kênh nhận mọi kèo; kèo 12% tới cả kênh hạng ≥10%', async () => {
    const t = await setup();
    await t.add('vip', [t.vip.id]);
    await t.add('super', [t.sup.id]);
    await t.add('all', []);

    await t.notifier.publish([new ArbitrageSignalIssued(signal('s1', 0.06))]);
    await t.notifier.drain();
    expect(t.sender.sent.map((s) => s.channel).sort()).toEqual(['all', 'vip']);
    expect(t.sender.sent[0]?.message.title).toContain('Kim cương');

    t.sender.sent = [];
    await t.notifier.publish([new ArbitrageSignalIssued(signal('s2', 0.12))]);
    await t.notifier.drain();
    expect(t.sender.sent.map((s) => s.channel).sort()).toEqual([
      'all',
      'super',
      'vip',
    ]);
    // kênh nhận mọi kèo ghi hạng khớp cao nhất
    expect(
      t.sender.sent.find((s) => s.channel === 'all')!.message.title,
    ).toContain('Siêu cấp');
  });

  it('chỉ gửi kèo mới + hủy; bỏ qua refreshed; hủy chỉ tới kênh đã nhận kèo', async () => {
    const t = await setup();
    await t.add('vip', [t.vip.id]);
    await t.add('super', [t.sup.id]);
    const s = signal('s1', 0.06);
    await t.notifier.publish([new ArbitrageSignalIssued(s)]);
    await t.notifier.publish([new ArbitrageSignalRefreshed(s)]);
    await t.notifier.publish([
      new ArbitrageSignalCancelled('s1', s.room, s.comboId, 'below_threshold'),
    ]);
    await t.notifier.drain();
    expect(t.sender.sent.map((x) => `${x.channel}:${x.message.title}`)).toEqual(
      ['vip:New signal · Kim cương · +6.00%', 'vip:Signal cancelled'],
    );
  });

  it('kèo ghi đè (supersedes) → "Kèo cập nhật", không gửi tin hủy cho kèo cũ', async () => {
    const t = await setup();
    await t.add('vip', [t.vip.id]);
    await t.notifier.publish([new ArbitrageSignalIssued(signal('s1', 0.06))]);
    await t.notifier.publish([
      new ArbitrageSignalIssued(signal('s2', 0.07), 's1'),
    ]);
    await t.notifier.drain();
    expect(t.sender.sent.map((x) => x.message.title)).toEqual([
      'New signal · Kim cương · +6.00%',
      'Updated signal · Kim cương · +7.00%',
    ]);
  });

  it('hủy vì có kèo tốt hơn → kênh không nhận tin hủy; kèo mới hiện "Kèo cập nhật"', async () => {
    const t = await setup();
    await t.add('vip', [t.vip.id]);
    const s1 = signal('s1', 0.06);
    await t.notifier.publish([new ArbitrageSignalIssued(s1)]);
    await t.notifier.publish([
      new ArbitrageSignalCancelled(
        's1',
        s1.room,
        s1.comboId,
        'better_opportunity',
      ),
      new ArbitrageSignalIssued(signal('s2', 0.07)),
    ]);
    // lý do khác vẫn báo hủy
    await t.notifier.publish([
      new ArbitrageSignalCancelled('s2', s1.room, s1.comboId, 'leg_removed'),
    ]);
    await t.notifier.drain();
    expect(t.sender.sent.map((x) => x.message.title)).toEqual([
      'New signal · Kim cương · +6.00%',
      'Updated signal · Kim cương · +7.00%',
      'Signal cancelled',
    ]);
  });

  it('kênh tắt không nhận; kênh lỗi được ghi nhận vào trạng thái', async () => {
    const t = await setup();
    const off = await t.add('off', []);
    const bad = await t.add('bad', []);
    await t.admin.saveChannel(off, {
      name: 'off',
      enabled: false,
      tierIds: [],
      config: { type: 'discord' }, // bỏ trống webhook = giữ cũ
    });
    t.sender.failFor.add(bad);
    await t.notifier.publish([new ArbitrageSignalIssued(signal('s1', 0.03))]);
    await t.notifier.drain();
    expect(t.sender.sent).toEqual([]);
    const views = await t.admin.listChannels();
    expect(views.find((v) => v.id === bad)!.status).toMatchObject({
      failed: 1,
      lastError: 'HTTP 404',
    });
    expect(views.find((v) => v.id === off)!.enabled).toBe(false);
  });

  it('xóa hạng → gỡ khỏi kênh; tên hạng trùng / khoảng sai → lỗi', async () => {
    const t = await setup();
    const id = await t.add('vip', [t.vip.id]);
    await t.admin.deleteTier(t.vip.id);
    expect(
      (await t.admin.listChannels()).find((c) => c.id === id)!.tierIds,
    ).toEqual([]);
    const dup = await t.admin.saveTier(null, {
      name: 'siêu cấp',
      minMargin: 0.2,
      maxMargin: null,
    });
    expect(dup.status === 'FAILED' && dup.reason).toContain('TIER_NAME_TAKEN');
    const bad = await t.admin.saveTier(null, {
      name: 'x',
      minMargin: 0.1,
      maxMargin: 0.05,
    });
    expect(bad.status).toBe('FAILED');
  });

  it('không trả bí mật ra ngoài', async () => {
    const t = await setup();
    const r = await t.admin.saveChannel(null, {
      name: 'tg',
      enabled: true,
      tierIds: [],
      config: {
        type: 'telegram',
        botToken: '123456:SECRETTOKENxyz9',
        chatId: '-100123',
      },
    });
    expect(r.status === 'SUCEED' && r.data.target).toBe(
      'chat -100123 · bot …xyz9',
    );
    expect(JSON.stringify(await t.admin.listChannels())).not.toContain(
      'SECRET',
    );
  });
});
