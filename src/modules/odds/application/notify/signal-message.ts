import type { ArbitrageSignal } from '../../domain/arbitrage-signal.js';
import type { CancelReason } from '../../domain/signal-policy.js';
import type { SignalCloseDetail } from '../../domain/signal-close-detail.js';
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
  better_opportunity: 'có kèo tốt hơn',
  margin_decreased: 'kèo không còn tốt nữa',
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

/** Giờ + ngày theo giờ Việt Nam, vd "10:45 15/10". */
const CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
});
const clock = (ms: number) => {
  const p = Object.fromEntries(
    CLOCK.formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  return `${p.hour}:${p.minute} ${p.day}/${p.month}`;
};

/** ms → "45 phút" / "1 giờ 20 phút" / "30 giây". */
export const fmtDrift = (ms: number): string => {
  const min = Math.round(ms / 60_000);
  if (min < 1) return `${Math.round(ms / 1000)} giây`;
  const h = Math.floor(min / 60);
  return h ? `${h} giờ${min % 60 ? ` ${min % 60} phút` : ''}` : `${min} phút`;
};

/**
 * Dòng giờ bắt đầu cho tin hủy: lúc phát (theo kèo) → lúc hủy (theo room), kèm độ lệch.
 * Không có dữ liệu thì trả null.
 */
export function startTimesField(
  s: ArbitrageSignal | undefined,
  d: SignalCloseDetail | null | undefined,
): { name: string; value: string } | null {
  if (!d?.startTimes.length) return null;
  const lines = d.startTimes.map((t) => {
    const before = s?.legs.find((l) => l.tenant === t.tenant)?.startsAt;
    const moved = before !== undefined && before !== t.startsAt;
    return `${t.tenant}: **${clock(t.startsAt)}**${moved ? ` (lúc phát ${clock(before)})` : ''}`;
  });
  if (d.startDriftMs !== null)
    lines.push(
      `Lệch **${fmtDrift(d.startDriftMs)}** · cho phép ≤ ${fmtDrift(d.maxStartDriftMs)}`,
    );
  return { name: 'Giờ bắt đầu lúc hủy', value: lines.join('\n') };
}

const matchLine = (s: ArbitrageSignal) =>
  `**${SPORT[s.sport] ?? s.sport}** · **${s.teams[0]}** vs **${s.teams[1]}**`;

const phaseLabel = (s: ArbitrageSignal) =>
  s.phase === 'live' ? 'Đang đánh (live)' : 'Trước trận';

/** Link trang trận của từng cửa — chỉ dùng khi CẢ HAI cửa đều có, để không dẫn lệch về một bên. */
const legUrls = (s: ArbitrageSignal): [string, string] | null => {
  const urls = s.legs.map((l) =>
    l.ref.url?.startsWith('http') ? l.ref.url : null,
  );
  return urls[0] && urls[1] ? [urls[0], urls[1]] : null;
};

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
  const urls = legUrls(s);
  const legField = (i: 0 | 1) => {
    const l = s.legs[i];
    return {
      name: `Cửa ${i + 1} · ${l.tenant}`,
      value: [
        `**${l.pick}**  ·  odds **${l.odds.toFixed(3)}**  ·  vốn **${split.shares[i].toFixed(1)}%**`,
        ...(urls ? [`[Mở trang ${l.tenant}](${urls[i]})`] : []),
      ].join('\n'),
    };
  };
  return {
    kind: replaces ? 'updated' : 'issued',
    title: `${replaces ? 'Kèo cập nhật' : 'Kèo mới'}${tier ? ` · ${tier.name}` : ''} · +${pct(s.margin)}`,
    description: [
      matchLine(s),
      `${marketLabel(s.market)} · ${phaseLabel(s)}`,
    ].join('\n'),
    fields: [
      legField(0),
      legField(1),
      {
        name: 'Lợi nhuận',
        value: `**+${pct(s.margin)}**  ·  đặt 100 nhận về **${split.payoutPer100.toFixed(2)}**`,
      },
    ],
    links: urls
      ? s.legs.map((l, i) => ({ label: l.tenant, url: urls[i] }))
      : [],
    footer: `Hết hạn ${time(s.expiresAt)}  ·  id ${s.signalId}`,
    at: s.issuedAt,
  };
}

export function cancelledMessage(
  s: ArbitrageSignal | undefined,
  signalId: string,
  reason: CancelReason,
  at: number = Date.now(),
  detail: SignalCloseDetail | null = null,
): NotifyMessage {
  // chỉ kèm giờ khi lý do liên quan tới giờ (tránh làm rối tin hủy thường)
  const times =
    reason === 'start_time_mismatch' ? startTimesField(s, detail) : null;
  return {
    kind: 'cancelled',
    title: 'Kèo đã hủy',
    description: s
      ? [
          matchLine(s),
          `${marketLabel(s.market)} · ${phaseLabel(s)} · trước đó +${pct(s.margin)}`,
        ].join('\n')
      : '',
    fields: [
      { name: 'Lý do', value: CANCEL[reason] ?? reason },
      ...(times ? [times] : []),
    ],
    links: [],
    footer: `id ${signalId}`,
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
