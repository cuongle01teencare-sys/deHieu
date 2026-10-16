'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ListX, MoreHorizontal, RefreshCw } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtHM } from '@/lib/format';
import type {
  AccountReport,
  ReportBucket,
  ReportMode,
  ReportPeriod,
  ReportTrade,
  SettleWinner,
  TradingAccountView,
} from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { FilterChip, Segmented } from '../ui/controls';
import { Menu, MenuItem, MenuSeparator } from '../ui/menu';
import { Panel } from '../ui/panel';
import { DrawerSection } from '../room-drawer';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Stat } from '../ui/stats';
import { Pill } from '../ui/status';
import { Table, TD, TH, THead, TR } from '../ui/table';
import {
  AccountCheckButton,
  AccountCheckLine,
  checkAccount,
  shortAddr,
} from './account-check';

const MODE_LABEL: Record<ReportMode, string> = {
  live: 'Thật',
  shadow: 'Giấy đối chiếu',
  paper: 'Giấy',
};
const PERIOD_LABEL: Record<ReportPeriod, string> = {
  day: 'Ngày',
  week: 'Tuần',
  month: 'Tháng',
  quarter: 'Quý',
  year: 'Năm',
};
const VENUE_NAME = { csgoempire: 'csgoempire', polymarket: 'Polymarket' };

const usd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : `${n < 0 ? '−' : n > 0 ? '+' : ''}${Math.abs(n).toFixed(2)}$`;
const money = (n: number) => `${n.toFixed(2)}$`;
const pnlTone = (n: number | null | undefined) =>
  n === null || n === undefined || Math.abs(n) < 0.005
    ? 'text-muted-fg'
    : n > 0
      ? 'text-ok'
      : 'text-critical';

/** Nhãn kỳ ngắn gọn: 16/10, tuần 12/10, 10/2026, Q4 2026, 2026. */
function periodLabel(p: ReportPeriod, key: string): string {
  if (p === 'day' || p === 'week') {
    const [, m, d] = key.split('-');
    return p === 'week' ? `T. ${d}/${m}` : `${d}/${m}`;
  }
  if (p === 'month') {
    const [y, m] = key.split('-');
    return `${m}/${y}`;
  }
  if (p === 'quarter') {
    const [y, q] = key.split('-');
    return `${q} ${y}`;
  }
  return key;
}

/** 16/10 14:05 (giờ Việt Nam). */
const shortStamp = (at: number) =>
  `${new Date(at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })} ${fmtHM(at)}`;

/** Bảng trong panel: không dính header theo trang. */
const STATIC_HEAD = 'lg:[&_th]:static';

const RESULT_PILL: Record<
  'won' | 'lost' | 'void',
  { tone: 'ok' | 'critical' | 'muted'; label: string }
> = {
  won: { tone: 'ok', label: 'Thắng' },
  lost: { tone: 'critical', label: 'Thua' },
  void: { tone: 'muted', label: 'Hoàn' },
};

/** Popup chi tiết một tài khoản: số dư thật, lãi/lỗ theo kỳ, từng lệnh, thật ↔ giấy. */
export function AccountDetail({
  account,
  onClose,
}: {
  account: TradingAccountView | null;
  onClose: () => void;
}) {
  const manage = useGuard('trading:manage');
  const mutate = useMutate();
  const [modes, setModes] = useState<ReportMode[]>(['live']);
  const [period, setPeriod] = useState<ReportPeriod>('day');
  const [running, setRunning] = useState(false);
  const path = account
    ? `trading/accounts/${encodeURIComponent(account.id)}/report?modes=${modes.join(',')}&tz=Asia/Ho_Chi_Minh`
    : null;
  const report = useApi<AccountReport>(path, 60_000);

  // mở popup → đọc số dư thật một lần (cần quyền quản trị: có thể phải mở Chromium lấy phiên)
  const checked = useRef<string | null>(null);
  useEffect(() => {
    if (!account || manage || checked.current === account.id) return;
    if (!account.enabled) return;
    if (account.venue === 'polymarket' && !account.hasSecret) return;
    checked.current = account.id;
    void checkAccount(account.id);
  }, [account, manage]);

  const toggle = (m: ReportMode) =>
    setModes((cur) =>
      cur.includes(m)
        ? cur.length > 1
          ? cur.filter((x) => x !== m)
          : cur
        : [...cur, m],
    );

  const settleNow = async () => {
    setRunning(true);
    const r = await mutate<{ checked: number; settled: number }>(
      'trading/settlements/run',
      { method: 'POST' },
    );
    setRunning(false);
    if (r) {
      void report.reload();
    }
  };

  const setWinner = async (t: ReportTrade, winner: SettleWinner | null) => {
    const r = await mutate(
      `trading/trades/${encodeURIComponent(t.id)}/settlement`,
      winner ? { method: 'PUT', body: { winner } } : { method: 'DELETE' },
      winner ? 'Đã ghi kết quả' : 'Đã bỏ kết quả',
    );
    if (r !== null) void report.reload();
  };

  const d = report.data;
  const venueName = account ? VENUE_NAME[account.venue] : '';
  const otherName = account
    ? VENUE_NAME[account.venue === 'csgoempire' ? 'polymarket' : 'csgoempire']
    : '';

  return (
    <Panel
      open={!!account}
      onOpenChange={(v) => !v && onClose()}
      width="xl"
      eyebrow={
        account
          ? `${venueName} · ${
              account.config.venue === 'csgoempire'
                ? `hồ sơ ${account.config.browserProfile}`
                : `ví ${shortAddr(account.config.funderAddress ?? account.config.walletAddress)}`
            }`
          : undefined
      }
      title={account?.label ?? ''}
      actions={
        account ? (
          <span className="flex items-center gap-1">
            <AccountCheckButton
              accountIds={[account.id]}
              disabledReason={manage}
            >
              Số dư
            </AccountCheckButton>
            <Button
              variant="ghost"
              size="sm"
              loading={running}
              disabledReason={manage}
              onClick={() => void settleNow()}
            >
              <RefreshCw aria-hidden /> Đối soát
            </Button>
          </span>
        ) : null
      }
    >
      {account ? (
        <div>
          <DrawerSection title="Tài khoản thật trên sàn">
            <AccountCheckLine accountId={account.id} venue={account.venue} />
            {manage ? (
              <p className="text-caption text-faint">
                Cần quyền trading:manage để đọc số dư trực tiếp từ sàn.
              </p>
            ) : null}
          </DrawerSection>

          <div className="flex flex-wrap items-center gap-2 border-t border-line py-4">
            <span className="text-caption text-muted-fg">Tính lệnh:</span>
            {(['live', 'shadow', 'paper'] as const).map((m) => (
              <FilterChip
                key={m}
                active={modes.includes(m)}
                onClick={() => toggle(m)}
              >
                {MODE_LABEL[m]}
              </FilterChip>
            ))}
          </div>

          {report.error && !d ? (
            <div className="py-4">
              <ErrorState message={report.error} onRetry={report.reload} />
            </div>
          ) : null}
          {!d && !report.error ? (
            <div className="py-4">
              <SkeletonRows rows={4} cols={[30, 20, 20]} />
            </div>
          ) : null}
          {d ? (
            <>
              <DrawerSection title="Tổng">
                <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3">
                  <Stat
                    label={`Lãi/lỗ chân ${venueName}`}
                    value={usd(d.totals.legPnl)}
                    tone={d.totals.legPnl >= 0 ? 'ok' : 'critical'}
                  />
                  <Stat
                    label="Lãi cả cặp (thật)"
                    value={usd(d.totals.pairPnl)}
                    tone={d.totals.pairPnl >= 0 ? 'ok' : 'critical'}
                  />
                  <Stat
                    label={`Lãi dự kiến lúc vào · ${d.totals.trades} lệnh`}
                    value={usd(d.totals.expected)}
                  />
                  <Stat
                    label={`Tiền đã vào bên ${venueName}`}
                    value={money(d.totals.staked)}
                  />
                  <Stat
                    label="Chân thắng / thua"
                    value={`${d.totals.legWins} / ${d.totals.legLosses}`}
                  />
                  <Stat
                    label="Có kết quả / chờ / hoàn"
                    value={`${d.totals.settled} / ${d.totals.trades - d.totals.settled} / ${d.totals.legVoids}`}
                  />
                </div>
                <p className="mt-4 text-caption text-muted-fg">
                  Mỗi lệnh là một cặp cửa ngược nhau: khi bên {otherName} thắng
                  thì chân {venueName} thua, và ngược lại. Chân lỗ là bình
                  thường — lãi thật của profile là <b>lãi cả cặp</b>. Kết quả
                  lấy tự động từ market Polymarket đã resolve (10 phút một lần),
                  hoặc sửa tay ở từng lệnh.
                </p>
                {d.truncated ? (
                  <p className="mt-1 text-caption text-warn">
                    Quá nhiều lệnh: chỉ tính 20 000 lệnh gần nhất.
                  </p>
                ) : null}
              </DrawerSection>

              <DrawerSection title="Tăng trưởng theo kỳ">
                <Segmented
                  size="sm"
                  value={period}
                  onChange={setPeriod}
                  options={(Object.keys(PERIOD_LABEL) as ReportPeriod[]).map(
                    (p) => ({
                      value: p,
                      label: PERIOD_LABEL[p],
                      count: d.series[p].length,
                    }),
                  )}
                />
                <PeriodChart
                  rows={d.series[period]}
                  period={period}
                  venueName={venueName}
                />
                <PeriodTable rows={d.series[period]} period={period} />
              </DrawerSection>

              <DrawerSection title="Thật ↔ giấy">
                <CompareTable report={d} />
              </DrawerSection>

              <DrawerSection title={`Từng lệnh (${d.trades.length})`}>
                {d.trades.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <THead className={STATIC_HEAD}>
                        <tr>
                          <TH>Lúc</TH>
                          <TH>Trận</TH>
                          <TH>Chân {venueName}</TH>
                          <TH numeric>Lãi/lỗ chân</TH>
                          <TH numeric>Chân {otherName}</TH>
                          <TH numeric>Cả cặp</TH>
                          <TH numeric>Dự kiến</TH>
                          <TH />
                        </tr>
                      </THead>
                      <tbody>
                        {d.trades.map((t) => (
                          <TradeRow
                            key={t.id}
                            t={t}
                            manage={manage}
                            onSet={setWinner}
                          />
                        ))}
                      </tbody>
                    </Table>
                  </div>
                ) : (
                  <Empty icon={ListX}>
                    Chưa có lệnh có tiền vào ở chế độ đã chọn.
                  </Empty>
                )}
              </DrawerSection>
            </>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function PeriodChart({
  rows,
  period,
  venueName,
}: {
  rows: ReportBucket[];
  period: ReportPeriod;
  venueName: string;
}) {
  const data = useMemo(() => {
    let cum = 0;
    return rows.map((b) => {
      cum += b.pairPnl;
      return {
        label: periodLabel(period, b.key),
        leg: b.legPnl,
        pair: b.pairPnl,
        cum: Math.round(cum * 100) / 100,
      };
    });
  }, [rows, period]);
  if (!rows.length)
    return (
      <p className="mt-4 text-caption text-faint">Chưa có dữ liệu ở kỳ này.</p>
    );
  return (
    <div className="mt-4 h-56 w-full">
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--fg-faint)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            tick={{
              fill: 'var(--fg-faint)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
            }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <ReferenceLine y={0} stroke="var(--line-strong)" />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            contentStyle={{
              background: 'var(--raised)',
              border: 0,
              borderRadius: 8,
              boxShadow: 'var(--shadow-pop)',
              fontSize: 12,
            }}
            formatter={(v, name) => [usd(Number(v)), String(name)]}
          />
          <Bar
            dataKey="leg"
            name={`Chân ${venueName}`}
            fill="var(--fg-faint)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="pair"
            name="Cả cặp"
            fill="var(--accent)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            dataKey="cum"
            name="Lũy kế cả cặp"
            stroke="var(--ok)"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function PeriodTable({
  rows,
  period,
}: {
  rows: ReportBucket[];
  period: ReportPeriod;
}) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  // mới nhất trước; so với kỳ liền trước
  const full = rows.map((b, i) => ({ b, prev: rows[i - 1] ?? null })).reverse();
  const list = all ? full : full.slice(0, 10);
  return (
    <div className="mt-4">
      <Table>
        <THead className={STATIC_HEAD}>
          <tr>
            <TH>{PERIOD_LABEL[period]}</TH>
            <TH numeric>Lệnh</TH>
            <TH numeric>Tiền vào</TH>
            <TH numeric>Lãi chân</TH>
            <TH numeric>Lãi cặp</TH>
            <TH numeric>Dự kiến</TH>
            <TH numeric>So kỳ trước</TH>
          </tr>
        </THead>
        <tbody>
          {list.map(({ b, prev }) => {
            const diff = prev ? b.pairPnl - prev.pairPnl : null;
            const pct =
              prev && Math.abs(prev.pairPnl) > 0.005
                ? (diff! / Math.abs(prev.pairPnl)) * 100
                : null;
            return (
              <TR key={b.key}>
                <TD className="num">{periodLabel(period, b.key)}</TD>
                <TD numeric>
                  {b.trades}
                  {b.settled < b.trades ? (
                    <span className="text-faint">
                      {' '}
                      ({b.trades - b.settled} chờ)
                    </span>
                  ) : null}
                </TD>
                <TD numeric>{money(b.staked)}</TD>
                <TD numeric className={pnlTone(b.legPnl)}>
                  {usd(b.legPnl)}
                </TD>
                <TD numeric className={pnlTone(b.pairPnl)}>
                  {usd(b.pairPnl)}
                </TD>
                <TD numeric className="text-muted-fg">
                  {usd(b.expected)}
                </TD>
                <TD numeric className={pnlTone(diff)}>
                  {diff === null
                    ? '—'
                    : `${usd(diff)}${pct !== null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%)` : ''}`}
                </TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
      {full.length > 10 ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setAll((v) => !v)}
        >
          {all ? 'Thu gọn' : `Xem đủ ${full.length} kỳ`}
        </Button>
      ) : null}
    </div>
  );
}

function CompareTable({ report: d }: { report: AccountReport }) {
  const p = d.compare.paired;
  return (
    <>
      <Table>
        <THead className={STATIC_HEAD}>
          <tr>
            <TH>Loại lệnh</TH>
            <TH numeric>Lệnh</TH>
            <TH numeric>Tổng tiền 2 chân</TH>
            <TH numeric>Dự kiến</TH>
            <TH numeric>Có kết quả</TH>
            <TH numeric>Lãi cặp thật</TH>
          </tr>
        </THead>
        <tbody>
          {(['live', 'shadow', 'paper'] as const).map((m) => {
            const s = d.compare.byMode[m];
            return (
              <TR key={m}>
                <TD>{MODE_LABEL[m]}</TD>
                <TD numeric>{s.trades}</TD>
                <TD numeric>{money(s.totalCost)}</TD>
                <TD numeric className="text-muted-fg">
                  {usd(s.expected)}
                </TD>
                <TD numeric>{s.settled}</TD>
                <TD numeric className={pnlTone(s.pairPnl)}>
                  {usd(s.pairPnl)}
                </TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
      <p className="mt-3 text-caption text-muted-fg">
        Mỗi lệnh thật kèm một lệnh <b>giấy đối chiếu</b> ghi đúng lúc quyết
        định. {p.count} cặp thật ↔ giấy: dự kiến thật{' '}
        <span className={cn('num', pnlTone(p.liveExpected))}>
          {usd(p.liveExpected)}
        </span>{' '}
        so với giấy{' '}
        <span className={cn('num', pnlTone(p.shadowExpected))}>
          {usd(p.shadowExpected)}
        </span>
        {p.bothSettled ? (
          <>
            ; {p.bothSettled} cặp đã có kết quả: thật{' '}
            <span className={cn('num', pnlTone(p.livePnl))}>
              {usd(p.livePnl)}
            </span>
            , giấy{' '}
            <span className={cn('num', pnlTone(p.shadowPnl))}>
              {usd(p.shadowPnl)}
            </span>{' '}
            (chênh{' '}
            <span className={cn('num', pnlTone(p.livePnl - p.shadowPnl))}>
              {usd(p.livePnl - p.shadowPnl)}
            </span>
            )
          </>
        ) : null}
        .
        {p.shadowOnly ? (
          <>
            {' '}
            <span className="text-warn">
              {p.shadowOnly} lần giấy vào được nhưng lệnh thật không khớp
            </span>{' '}
            (thiếu tiền, sàn từ chối, hết phiên...).
          </>
        ) : null}
      </p>
    </>
  );
}

function LegCell({ leg }: { leg: ReportTrade['leg'] }) {
  return (
    <span className="flex items-center gap-2">
      {leg.result ? (
        <Pill tone={RESULT_PILL[leg.result].tone}>
          {RESULT_PILL[leg.result].label}
        </Pill>
      ) : (
        <Pill tone="warn">Chờ</Pill>
      )}
      <span className="min-w-0">
        <span className="block max-w-40 truncate text-fg">{leg.pick}</span>
        <span className="num block text-caption text-faint">
          {leg.venue === 'csgoempire'
            ? `${money(leg.amount)} @ ${leg.price.toFixed(2)}`
            : `${+leg.amount.toFixed(2)} sh @ ${leg.price.toFixed(3)}`}
        </span>
      </span>
    </span>
  );
}

function TradeRow({
  t,
  manage,
  onSet,
}: {
  t: ReportTrade;
  manage: string | null;
  onSet: (t: ReportTrade, w: SettleWinner | null) => void;
}) {
  return (
    <TR>
      <TD className="num text-caption text-muted-fg">
        {shortStamp(t.createdAt)}
        {t.mode !== 'live' ? (
          <span className="block">
            <Pill tone="muted">
              {MODE_LABEL[t.mode as ReportMode] ?? t.mode}
            </Pill>
          </span>
        ) : null}
      </TD>
      <TD>
        <span className="block max-w-48 truncate">
          {t.teams[0]} vs {t.teams[1]}
        </span>
        <span className="block text-caption text-faint">
          {t.market}
          {t.status === 'partial' ? ' · khớp một phần' : ''}
        </span>
      </TD>
      <TD>
        <LegCell leg={t.leg} />
      </TD>
      <TD numeric className={pnlTone(t.leg.pnl)}>
        {usd(t.leg.pnl)}
      </TD>
      <TD numeric className={pnlTone(t.other.pnl)}>
        {usd(t.other.pnl)}
      </TD>
      <TD numeric className={cn('font-medium', pnlTone(t.pairPnl))}>
        {usd(t.pairPnl)}
        {t.settlement?.source === 'manual' ? (
          <span className="block text-micro font-normal text-faint">
            sửa tay
          </span>
        ) : null}
      </TD>
      <TD numeric className="text-muted-fg">
        {usd(t.expected)}
      </TD>
      <TD>
        <Menu
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="Kết quả lệnh">
              <MoreHorizontal />
            </Button>
          }
        >
          <MenuItem
            disabledReason={manage}
            onSelect={() => onSet(t, 'polymarket')}
          >
            Polymarket thắng
          </MenuItem>
          <MenuItem
            disabledReason={manage}
            onSelect={() => onSet(t, 'csgoempire')}
          >
            csgoempire thắng
          </MenuItem>
          <MenuItem disabledReason={manage} onSelect={() => onSet(t, 'void')}>
            Trận hủy — hoàn tiền
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            disabledReason={manage ?? (t.settlement ? null : 'Chưa có kết quả')}
            onSelect={() => onSet(t, null)}
          >
            Bỏ kết quả (lấy lại tự động)
          </MenuItem>
        </Menu>
      </TD>
    </TR>
  );
}
