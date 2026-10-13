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

export function issuedMessage(
  s: ArbitrageSignal,
  tier: SignalTier | null,
  replaces: boolean,
): NotifyMessage {
  const head = replaces ? 'Kèo cập nhật' : 'Kèo mới';
  return {
    title: `${head}${tier ? ` · ${tier.name}` : ''} · +${pct(s.margin)}`,
    lines: [
      `${SPORT[s.sport] ?? s.sport} · ${s.teams[0]} vs ${s.teams[1]}`,
      `${marketLabel(s.market)} · ${s.phase === 'live' ? 'Live' : 'Prematch'}`,
      ...s.legs.map((l) => `${l.tenant}: ${l.pick} @ ${l.odds.toFixed(3)}`),
      `Hết hạn lúc ${time(s.expiresAt)} · id ${s.signalId}`,
    ],
    links: s.legs
      .filter(
        (l) => typeof l.ref.url === 'string' && l.ref.url.startsWith('http'),
      )
      .map((l) => ({ label: l.tenant, url: l.ref.url })),
  };
}

export function cancelledMessage(
  s: ArbitrageSignal | undefined,
  signalId: string,
  reason: CancelReason,
): NotifyMessage {
  return {
    title: 'Kèo đã hủy',
    lines: [
      ...(s
        ? [
            `${SPORT[s.sport] ?? s.sport} · ${s.teams[0]} vs ${s.teams[1]} · ${marketLabel(s.market)} (+${pct(s.margin)})`,
          ]
        : []),
      `Lý do: ${CANCEL[reason] ?? reason} · id ${signalId}`,
    ],
    links: [],
  };
}

export function testMessage(channelName: string): NotifyMessage {
  return {
    title: 'Kiểm tra kết nối',
    lines: [`Kênh "${channelName}" đã kết nối với hệ thống kèo.`],
    links: [],
  };
}
