import type { ArbitrageSignal } from '../../domain/arbitrage-signal.js';
import type { CancelReason } from '../../domain/signal-policy.js';
import type { SignalTier } from '../../domain/notify-channel.js';
import type { NotifyMessage } from './notify.ports.js';

const SPORT: Readonly<Record<string, string>> = {
  cs2: 'CS2',
  lol: 'LoL',
  dota2: 'Dota 2',
  valorant: 'Valorant',
};

const CANCEL: Readonly<Record<CancelReason, string>> = {
  below_threshold: 'lợi nhuận tụt dưới ngưỡng',
  leg_suspended: 'một bên đang khóa odds',
  leg_removed: 'một bên đã gỡ odds',
  start_time_mismatch: 'giờ bắt đầu hai bên lệch nhau',
  publisher_stopped: 'nguồn dữ liệu bị dừng',
  phase_disabled: 'kênh live/prematch đang tắt',
  match_expired: 'trận đã kết thúc',
  missing_from_listing: 'market không còn trong danh sách',
};

export const marketLabel = (market: string): string => {
  if (market === 'game-winner') return 'Thắng trận';
  const map = /^map-(\d+)-winner$/.exec(market);
  if (map) return `Thắng map ${map[1]}`;
  const hcp = /^map-handicap-([mp])([\d.]+)$/.exec(market);
  if (hcp) return `Chấp map ${hcp[1] === 'm' ? '-' : '+'}${hcp[2]}`;
  const total = /^total-maps-([\d.]+)$/.exec(market);
  if (total) return `Tổng map ${total[1]}`;
  return market;
};

export const pct = (margin: number): string => `${(margin * 100).toFixed(2)}%`;

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false,
  });

const matchLine = (s: ArbitrageSignal) =>
  `**${SPORT[s.sport] ?? s.sport}** · ${s.teams[0]} vs ${s.teams[1]}`;

/**
 * Chia vốn để lời bằng nhau dù cửa nào thắng: tỉ lệ cửa i = (1/odds_i) / Σ(1/odds).
 * Trả về phần trăm vốn từng cửa và số tiền nhận về trên 100 vốn.
 */
export function stakeSplit(odds: readonly [number, number]): {
  readonly shares: readonly [number, number];
  readonly payoutPer100: number;
} {
  const inv = [1 / odds[0], 1 / odds[1]] as const;
  const sum = inv[0] + inv[1];
  return {
    shares: [(inv[0] / sum) * 100, (inv[1] / sum) * 100],
    payoutPer100: 100 / sum,
  };
}

export function issuedMessage(
  s: ArbitrageSignal,
  tier: SignalTier | null,
  replaces: boolean,
): NotifyMessage {
  const split = stakeSplit([s.legs[0].odds, s.legs[1].odds]);
  const legField = (i: 0 | 1) => {
    const l = s.legs[i];
    const url = l.ref.url?.startsWith('http') ? l.ref.url : null;
    return {
      name: `${i + 1}. ${l.tenant}`,
      value: [
        `**${l.pick}** @ **${l.odds.toFixed(3)}**`,
        `Vốn ${split.shares[i].toFixed(1)}%`,
        ...(url ? [`[Mở trận](${url})`] : []),
      ].join('\n'),
      inline: true,
    };
  };
  return {
    kind: replaces ? 'updated' : 'issued',
    title: `${replaces ? 'Kèo cập nhật' : 'Kèo mới'}${tier ? ` · ${tier.name}` : ''} · +${pct(s.margin)}`,
    description: [
      matchLine(s),
      `${marketLabel(s.market)} · ${s.phase === 'live' ? 'Live' : 'Prematch'}`,
    ].join('\n'),
    fields: [
      legField(0),
      legField(1),
      {
        name: 'Lời',
        value: `**+${pct(s.margin)}**\n100 → ${split.payoutPer100.toFixed(2)}`,
        inline: true,
      },
    ],
    links: s.legs
      .filter((l) => l.ref.url?.startsWith('http'))
      .map((l) => ({ label: l.tenant, url: l.ref.url })),
    footer: `Hết hạn ${time(s.expiresAt)} · ${s.signalId}`,
    at: s.issuedAt,
  };
}

export function cancelledMessage(
  s: ArbitrageSignal | undefined,
  signalId: string,
  reason: CancelReason,
  at: number = Date.now(),
): NotifyMessage {
  return {
    kind: 'cancelled',
    title: 'Kèo đã hủy',
    description: s
      ? [
          matchLine(s),
          `${marketLabel(s.market)} · trước đó +${pct(s.margin)}`,
        ].join('\n')
      : '',
    fields: [{ name: 'Lý do', value: CANCEL[reason] ?? reason }],
    links: [],
    footer: signalId,
    at,
  };
}

export function testMessage(
  channelName: string,
  at: number = Date.now(),
): NotifyMessage {
  return {
    kind: 'test',
    title: 'Kiểm tra kết nối',
    description: `Kênh **${channelName}** đã kết nối với hệ thống kèo.`,
    fields: [],
    links: [],
    at,
  };
}
