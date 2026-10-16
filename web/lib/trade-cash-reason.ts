import type { TradeDetail } from './trading-types';

const venueName = (venue: string) =>
  venue === 'polymarket' ? 'Polymarket' : venue;
const usd = (amount: number) => `${amount.toFixed(2)} USD`;

function shortages(cash: TradeDetail['cash']) {
  return (cash ?? []).filter(
    (c) =>
      Number.isFinite(c.available) &&
      Number.isFinite(c.required) &&
      c.available + 1e-9 < c.required,
  );
}

export function insufficientCashLabel(cash?: TradeDetail['cash']): string {
  const venues = shortages(cash).map((c) => venueName(c.venue));
  return `Không đủ số dư${venues.length ? `: ${venues.join(', ')}` : ''} — hủy cả hai chân`;
}

export function insufficientCashExplanation(
  cash?: TradeDetail['cash'],
): string {
  const details = shortages(cash).map(
    (c) =>
      `${venueName(c.venue)} có ${usd(c.available)}, cần ${usd(c.required)} (thiếu ${usd(c.required - c.available)})`,
  );
  return `${details.length ? details.join('; ') : 'Cash hiện có của ít nhất một tài khoản không đủ số tiền cần cho lệnh'}. Hủy cả hai chân trước khi gửi lệnh.`;
}
