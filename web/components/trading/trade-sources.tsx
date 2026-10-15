'use client';

import { fmtMargin } from '@/lib/format';
import type { TradeStats } from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';

/** Nguồn lệnh: bot (Auto trade) hoặc người vào tay ở On click. '' = gộp cả hai. */
export type TradeSource = '' | 'bot' | 'manual';
export const SOURCE_LABEL: Record<TradeSource, string> = { '': 'Tổng (gộp)', bot: 'Auto trade', manual: 'On click' };

const usd = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}$`;

/** Query thống kê theo profile / mốc / nguồn. */
export const statsPath = (o: { profileId?: string; since?: number; source?: TradeSource }) => {
  const q = new URLSearchParams();
  if (o.profileId) q.set('profileId', o.profileId);
  if (o.since) q.set('since', String(o.since));
  if (o.source) q.set('source', o.source);
  return `trading/trades/stats?${q}`;
};

function Card({ label, s, active }: { label: string; s: TradeStats | null; active?: boolean }) {
  const roi = s && s.totalCost > 0 ? s.profit / s.totalCost : null;
  return (
    <div className={cn('rounded-[8px] border p-4', active ? 'border-accent' : 'border-line')}>
      <div className="text-caption text-muted-fg">{label}</div>
      <div className={cn('num mt-1 text-[20px] font-semibold', !s ? 'text-faint' : s.profit > 0 ? 'text-ok' : s.profit < 0 ? 'text-critical' : 'text-fg')}>{s ? usd(s.profit) : '—'}</div>
      <div className="num mt-1 text-caption text-muted-fg">
        {s ? (
          <>
            {roi !== null ? `${fmtMargin(roi)} · ` : ''}
            {s.filled} lệnh vào · {usd(s.totalCost)} tiền vào
          </>
        ) : (
          'đang tải…'
        )}
      </div>
    </div>
  );
}

/** Lãi giả định tách theo nguồn: Auto trade, On click và tổng (cùng profile, cùng khoảng thời gian). */
export function SourceBreakdown({ profileId, since, active, className }: { profileId?: string; since?: number; active?: TradeSource; className?: string }) {
  const bot = useApi<TradeStats>(statsPath({ profileId, since, source: 'bot' }), 15_000);
  const manual = useApi<TradeStats>(statsPath({ profileId, since, source: 'manual' }), 15_000);
  const all = useApi<TradeStats>(statsPath({ profileId, since }), 15_000);
  return (
    <div className={cn('grid grid-cols-1 gap-3 md:grid-cols-3', className)}>
      <Card label="Auto trade (bot tự vào)" s={bot.data} active={active === 'bot'} />
      <Card label="On click (người vào tay)" s={manual.data} active={active === 'manual'} />
      <Card label="Tổng (gộp cả hai)" s={all.data} active={active === ''} />
    </div>
  );
}
