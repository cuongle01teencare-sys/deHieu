'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtMargin, fmtSince, fmtStamp } from '@/lib/format';
import type { TradeAttempt, TradeStats, TradeStatus, TraderProfile } from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useIsMobile } from '@/hooks/use-media';
import { useNow } from '@/hooks/use-now';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Segmented, Select } from '../ui/controls';
import { Confirm } from '../ui/panel';
import { Section } from '../ui/layout';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Stat, StatStrip } from '../ui/stats';
import { Pill } from '../ui/status';
import { ListRow, Table, TD, TH, THead, TR } from '../ui/table';
import { Hint } from '../ui/tooltip';
import { REASON_LABEL, reasonText, TRADE_STATUS, TradeDetailPanel } from './trade-detail';
import { SOURCE_LABEL, SourceBreakdown, type TradeSource } from './trade-sources';
import { PurgeTradesDialog } from './trade-purge';

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
  const [source, setSource] = useState<TradeSource>('');
  const now = useNow(30_000);
  const mobile = useIsMobile();

  // mốc thời gian làm tròn theo phút để URL không đổi mỗi lần render
  const since = PERIODS[period] ? Math.floor((now - PERIODS[period]) / 60_000) * 60_000 : 0;
  const q = (extra: Record<string, string | number>) =>
    new URLSearchParams(
      Object.entries({ ...(profileId ? { profileId } : {}), ...extra }).map(([k, v]) => [k, String(v)]),
    ).toString();
  const stats = useApi<TradeStats>(`trading/trades/stats?${q({ ...(since ? { since } : {}), ...(source ? { source } : {}) })}`, 15_000);
  const page = useApi<TradeAttempt[]>(`trading/trades?${q({ limit: PAGE, ...(status ? { status } : {}), ...(source ? { source } : {}) })}`, 10_000);
  const [older, setOlder] = useState<TradeAttempt[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<TradeAttempt | null>(null);
  const [purging, setPurging] = useState(false);
  const [removing, setRemoving] = useState<TradeAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = useGuard('trading:manage');
  const mutate = useMutate();
  useEffect(() => setOlder([]), [profileId, status, source]);

  const refresh = () => {
    setOlder([]);
    void page.reload();
    void stats.reload();
  };

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
      const more = await api<TradeAttempt[]>(`trading/trades?${q({ limit: PAGE, before: last.createdAt, ...(status ? { status } : {}), ...(source ? { source } : {}) })}`);
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
        <Segmented<TradeSource>
          value={source}
          onChange={setSource}
          options={[
            { value: '', label: 'Tất cả' },
            { value: 'bot', label: 'Auto trade' },
            { value: 'manual', label: 'On click' },
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

      <SourceBreakdown className="mb-8" profileId={profileId || undefined} since={since || undefined} active={source} />
      <p className="-mt-5 mb-6 text-caption text-faint">
        Lãi giả định theo nguồn trong khoảng đã chọn. Bên dưới: thống kê chi tiết của nguồn đang chọn ({SOURCE_LABEL[source]}).
      </p>

      <StatStrip className="mb-10">
        <Stat label="Lãi giả định" value={s ? usd(s.profit) : '—'} tone={s && s.profit > 0 ? 'ok' : s && s.profit < 0 ? 'critical' : undefined} sub={roi !== null ? fmtMargin(roi) : undefined} />
        <Stat label="Tiền vào (2 chân)" value={s ? usd(s.totalCost) : '—'} />
        <Stat label="Lệnh vào" value={s ? s.filled : '—'} sub={s ? `/ ${s.attempts} kèo` : undefined} />
        <Stat label="Bỏ qua" value={s ? s.skipped : '—'} sub={s && (s.cancelled || s.errors) ? `· ${s.cancelled} hủy · ${s.errors} lỗi` : undefined} />
      </StatStrip>
      <p className="-mt-6 mb-6 text-caption text-faint">
        Thống kê tính từ lịch sử lệnh còn lưu. Hạn mức và số lệnh trader thật sự dùng (Redis): tab Giới hạn chung → Sổ phơi nhiễm.
      </p>
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
          <div className="flex items-center gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value as TradeStatus | '')} className="w-40" aria-label="Trạng thái">
              <option value="">Mọi trạng thái</option>
              {(Object.keys(STATUS) as TradeStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS[k].label}
                </option>
              ))}
            </Select>
            <Button variant="danger-ghost" size="sm" disabledReason={manage} onClick={() => setPurging(true)}>
              <Trash2 aria-hidden /> Xóa lệnh…
            </Button>
          </div>
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
                    {(t.detail as { manual?: { by: string } }).manual ? (
                      <span className="mt-0.5 block text-caption text-muted-fg">vào tay bởi {(t.detail as { manual: { by: string } }).manual.by}</span>
                    ) : null}
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
      <TradeDetailPanel
        trade={selected}
        profileName={name}
        onClose={() => setSelected(null)}
        onDelete={setRemoving}
        deleteDisabledReason={manage}
      />
      <PurgeTradesDialog
        open={purging}
        onOpenChange={setPurging}
        profileId={profileId}
        profileName={profileId ? name(profileId) : null}
        initialStatus={status}
        onDone={() => {
          setSelected(null);
          refresh();
        }}
      />
      <Confirm
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        tone="danger"
        title="Xóa lệnh này?"
        description={removing ? `${removing.teams[0]} vs ${removing.teams[1]} · ${STATUS[removing.status].label} · ${fmtStamp(removing.createdAt)}. Xóa vĩnh viễn kèm các chân lệnh.` : undefined}
        confirmLabel="Xóa lệnh"
        loading={busy}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          const r = await mutate(`trading/trades/${encodeURIComponent(removing.id)}`, { method: 'DELETE' }, 'Đã xóa lệnh');
          setBusy(false);
          if (r !== null) {
            setRemoving(null);
            setSelected(null);
            refresh();
          }
        }}
      />
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
