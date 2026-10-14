'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtMargin, fmtSince, fmtStamp } from '@/lib/format';
import type { TradeAttempt, TradeStats, TradeStatus, TraderProfile } from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useIsMobile } from '@/hooks/use-media';
import { useNow } from '@/hooks/use-now';
import { Button } from '../ui/button';
import { Segmented, Select } from '../ui/controls';
import { Section } from '../ui/layout';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Stat, StatStrip } from '../ui/stats';
import { Pill } from '../ui/status';
import { ListRow, Table, TD, TH, THead, TR } from '../ui/table';
import { Hint } from '../ui/tooltip';
import { REASON_LABEL, reasonText, TRADE_STATUS, TradeDetailPanel } from './trade-detail';

const STATUS = TRADE_STATUS;
const REASON = REASON_LABEL;
const reasonLabel = (r: string | null) => reasonText({ reason: r });

const usd = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}$`;
const PERIODS = { '24h': 86_400_000, '7d': 7 * 86_400_000, all: 0 } as const;
type Period = keyof typeof PERIODS;
const PAGE = 100;

export function PaperTrades() {
  const profiles = useApi<TraderProfile[]>('trading/profiles');
  const [profileId, setProfileId] = useState('');
  const [period, setPeriod] = useState<Period>('24h');
  const [status, setStatus] = useState<TradeStatus | ''>('');
  const now = useNow(30_000);
  const mobile = useIsMobile();

  // mốc thời gian làm tròn theo phút để URL không đổi mỗi lần render
  const since = PERIODS[period] ? Math.floor((now - PERIODS[period]) / 60_000) * 60_000 : 0;
  const q = (extra: Record<string, string | number>) =>
    new URLSearchParams(
      Object.entries({ ...(profileId ? { profileId } : {}), ...extra }).map(([k, v]) => [k, String(v)]),
    ).toString();
  const stats = useApi<TradeStats>(`trading/trades/stats?${q(since ? { since } : {})}`, 15_000);
  const page = useApi<TradeAttempt[]>(`trading/trades?${q({ limit: PAGE, ...(status ? { status } : {}) })}`, 10_000);
  const [older, setOlder] = useState<TradeAttempt[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<TradeAttempt | null>(null);
  useEffect(() => setOlder([]), [profileId, status]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return [...(page.data ?? []), ...older].filter((t) => !seen.has(t.id) && seen.add(t.id));
  }, [page.data, older]);
  const name = (id: string) => profiles.data?.find((p) => p.id === id)?.name ?? id.slice(0, 8);

  const loadMore = async () => {
    const last = rows.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const more = await api<TradeAttempt[]>(`trading/trades?${q({ limit: PAGE, before: last.createdAt, ...(status ? { status } : {}) })}`);
      setOlder((o) => [...o, ...more]);
    } finally {
      setLoadingMore(false);
    }
  };

  const s = stats.data;
  const topSkips = s ? Object.entries(s.skipReasons).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];
  const roi = s && s.totalCost > 0 ? s.profit / s.totalCost : null;

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Segmented<Period>
          value={period}
          onChange={setPeriod}
          options={[
            { value: '24h', label: '24 giờ' },
            { value: '7d', label: '7 ngày' },
            { value: 'all', label: 'Tất cả' },
          ]}
        />
        <Select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="w-48" aria-label="Profile">
          <option value="">Mọi profile</option>
          {profiles.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      <StatStrip className="mb-10">
        <Stat label="Lãi giả định" value={s ? usd(s.profit) : '—'} tone={s && s.profit > 0 ? 'ok' : s && s.profit < 0 ? 'critical' : undefined} sub={roi !== null ? fmtMargin(roi) : undefined} />
        <Stat label="Tiền vào (2 chân)" value={s ? usd(s.totalCost) : '—'} />
        <Stat label="Lệnh vào" value={s ? s.filled : '—'} sub={s ? `/ ${s.attempts} kèo` : undefined} />
        <Stat label="Bỏ qua" value={s ? s.skipped : '—'} sub={s && (s.cancelled || s.errors) ? `· ${s.cancelled} hủy · ${s.errors} lỗi` : undefined} />
      </StatStrip>
      {topSkips.length ? (
        <p className="-mt-6 mb-10 text-caption text-muted-fg">
          Lý do bỏ qua nhiều nhất:{' '}
          {topSkips.map(([code, n], i) => (
            <span key={code}>
              {i ? ' · ' : ''}
              {REASON[code] ?? code} <span className="num text-fg">{n}</span>
            </span>
          ))}
        </p>
      ) : null}

      <Section
        title="Lệnh giấy"
        description="Mỗi dòng = một profile xử lý một kèo. Giá và phí lấy từ sổ lệnh Polymarket thật lúc nhận kèo; không có lệnh nào được đặt."
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value as TradeStatus | '')} className="w-40" aria-label="Trạng thái">
            <option value="">Mọi trạng thái</option>
            {(Object.keys(STATUS) as TradeStatus[]).map((k) => (
              <option key={k} value={k}>
                {STATUS[k].label}
              </option>
            ))}
          </Select>
        }
      >
        {page.error && !page.data ? <ErrorState message={page.error} onRetry={page.reload} /> : null}
        {!page.data && !page.error ? <SkeletonRows rows={6} /> : null}
        {page.data && !rows.length ? (
          <Empty icon={Receipt}>Chưa có lệnh nào. Chạy một profile ở tab Profile; mỗi kèo mới sẽ hiện ở đây.</Empty>
        ) : null}
        {rows.length && mobile ? (
          <div>
            {rows.map((t) => (
              <ListRow key={t.id} interactive onClick={() => setSelected(t)}>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-body text-fg">
                    {t.teams[0]} vs {t.teams[1]}
                  </span>
                  <Pill tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Pill>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-caption text-muted-fg">
                  <span className="truncate">
                    {t.sport} · {t.market} · {name(t.profileId)} · {fmtSince(t.createdAt, now)}
                  </span>
                  {t.status === 'paper_filled' ? (
                    <span className={cn('num', t.profit >= 0 ? 'text-ok' : 'text-critical')}>{usd(t.profit)}</span>
                  ) : (
                    <span className="truncate">{reasonLabel(t.reason)}</span>
                  )}
                </div>
              </ListRow>
            ))}
          </div>
        ) : rows.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Lúc</TH>
                <TH>Trận · market</TH>
                <TH>Profile</TH>
                <TH numeric>Kèo</TH>
                <TH>Kết quả</TH>
                <TH numeric>csgoempire</TH>
                <TH numeric>Polymarket</TH>
                <TH numeric>Lãi</TH>
                <TH numeric>Độ trễ</TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((t) => (
                <TR key={t.id} interactive onClick={() => setSelected(t)}>
                  <TD className="text-caption text-muted-fg">
                    <Hint content={fmtStamp(t.createdAt)}>
                      <span className="num cursor-default">{fmtSince(t.createdAt, now)}</span>
                    </Hint>
                  </TD>
                  <TD className="max-w-72">
                    <span className="block truncate text-fg">
                      {t.teams[0]} vs {t.teams[1]}
                    </span>
                    <span className="block truncate text-caption text-muted-fg">
                      {t.sport} · {t.market} · {t.phase}
                    </span>
                  </TD>
                  <TD className="text-muted-fg">{name(t.profileId)}</TD>
                  <TD numeric>
                    <span className="block text-fg">{fmtMargin(t.signalMargin)}</span>
                    <span className="block text-caption text-muted-fg">{t.tierName ?? '—'}</span>
                  </TD>
                  <TD>
                    <Pill tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Pill>
                    {t.status !== 'paper_filled' && t.reason ? (
                      <Hint content={t.reason}>
                        <span className="mt-0.5 block max-w-48 cursor-default truncate text-caption text-muted-fg">{reasonLabel(t.reason)}</span>
                      </Hint>
                    ) : null}
                  </TD>
                  <TD numeric>
                    {t.book && t.status === 'paper_filled' ? (
                      <>
                        <span className="block text-fg">{usd(t.book.stake)}</span>
                        <span className="block text-caption text-muted-fg">
                          {t.book.pick} @ {t.book.odds.toFixed(2)}
                        </span>
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </TD>
                  <TD numeric>
                    {t.polymarket && t.status === 'paper_filled' ? (
                      <Hint content={`${t.polymarket.shares} share × ${t.polymarket.avgPrice.toFixed(3)} + phí ${usd(t.polymarket.fee)}`}>
                        <span className="cursor-default">
                          <span className="block text-fg">{usd(t.polymarket.cost)}</span>
                          <span className="block text-caption text-muted-fg">
                            {t.polymarket.pick} · {+t.polymarket.shares.toFixed(2)} @ {t.polymarket.avgPrice.toFixed(3)}
                          </span>
                        </span>
                      </Hint>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </TD>
                  <TD numeric>
                    {t.status === 'paper_filled' ? (
                      <>
                        <span className={cn('block', t.profit >= 0 ? 'text-ok' : 'text-critical')}>{usd(t.profit)}</span>
                        <span className="block text-caption text-muted-fg">{fmtMargin(t.netMargin)}</span>
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </TD>
                  <TD numeric>
                    <Delay t={t} />
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        ) : null}
        {rows.length >= PAGE && rows.length % PAGE === 0 ? (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => void loadMore()} loading={loadingMore}>
              Xem cũ hơn
            </Button>
          </div>
        ) : null}
      </Section>
      <TradeDetailPanel trade={selected} profileName={name} onClose={() => setSelected(null)} />
    </>
  );
}

/** Kèo phát → worker nhận (đường truyền) và nhận → quyết định (đọc sổ lệnh + tính). */
function Delay({ t }: { t: TradeAttempt }) {
  const tm = t.timing;
  if (!tm) return <span className="text-faint">—</span>;
  const transit = Math.max(0, tm.receivedAt - tm.signalIssuedAt);
  const total = Math.max(0, tm.decidedAt - tm.signalIssuedAt);
  const book = tm.marketDataAt !== null ? tm.marketDataAt - tm.receivedAt : null;
  return (
    <Hint
      content={`Kèo phát → nhận ${transit}ms${book !== null ? ` · đọc sổ lệnh ${book}ms` : ''} · tới khi quyết định ${total}ms`}
    >
      <span className="cursor-default">
        <span className="block text-fg">{total}ms</span>
        <span className="block text-caption text-muted-fg">nhận {transit}ms</span>
      </span>
    </Hint>
  );
}
