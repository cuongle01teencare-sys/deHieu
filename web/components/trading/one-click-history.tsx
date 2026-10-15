'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import { fmtDuration, fmtMargin, fmtStamp } from '@/lib/format';
import { marketLabel } from '@/lib/markets';
import { CANCEL_REASONS } from '@/lib/skip-reasons';
import type { ListResult } from '@/lib/types';
import type { OneClickHistoryEntry, OneClickOutcome } from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { Button } from '../ui/button';
import { Input, Segmented, Select } from '../ui/controls';
import { Pill, type Tone } from '../ui/status';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { REASON_LABEL, TradeDetailPanel } from './trade-detail';

const usd = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}$`;

const OUTCOMES: { value: OneClickOutcome; label: string }[] = [
  { value: 'open', label: 'Đang chờ' },
  { value: 'manual', label: 'Người bấm vào lệnh' },
  { value: 'cancelled', label: 'Kèo bị hủy' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'auto', label: 'Bot tự vào' },
  { value: 'other', label: 'Khác (bot bỏ, app khởi động lại…)' },
];

const RANGES = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, all: null } as const;
type Range = keyof typeof RANGES;
const RANGE_LABEL: Record<Range, string> = { '24h': '24h', '7d': '7d', '30d': '30d', all: 'Tất cả' };

const reasonLabel = (code: string | undefined) => (code ? (REASON_LABEL[code] ?? code) : '');

/** Lý do rời bảng → câu đọc được + màu. */
export function oneClickOutcome(e: Pick<OneClickHistoryEntry, 'endedAt' | 'endReason' | 'enteredBy'>): { label: string; tone: Tone } {
  if (e.endedAt === null) return { label: 'Đang chờ trên bảng', tone: 'accent' };
  const [kind = '', status = '', code] = (e.endReason ?? '').split(':');
  const by = e.enteredBy ?? 'không rõ';
  if (kind === 'manual')
    return status === 'paper_filled'
      ? { label: `Vào tay bởi ${by}`, tone: 'ok' }
      : { label: `${by} bấm vào lệnh nhưng ${status === 'skipped' ? `bỏ: ${reasonLabel(code)}` : status === 'cancelled' ? 'kèo bị hủy khi đang tính' : 'lỗi'}`, tone: 'warn' };
  if (kind === 'cancelled') return { label: `Kèo bị hủy: ${CANCEL_REASONS[status] ?? status}`, tone: 'muted' };
  if (kind === 'expired') return { label: 'Hết hạn (không được làm mới)', tone: 'muted' };
  if (kind === 'app_restart') return { label: 'App khởi động lại', tone: 'muted' };
  if (kind === 'result')
    return status === 'paper_filled'
      ? { label: 'Bot tự vào (giá xuống dưới ngưỡng)', tone: 'ok' }
      : status === 'skipped'
        ? { label: `Bot xét lại và bỏ: ${reasonLabel(code)}`, tone: 'muted' }
        : status === 'cancelled'
          ? { label: 'Kèo bị hủy khi đang tính', tone: 'muted' }
          : { label: 'Lỗi khi xét lại', tone: 'critical' };
  return { label: e.endReason ?? 'Rời bảng', tone: 'muted' };
}

/** Lịch sử On click của một profile: mọi kèo từng lên bảng, rời bảng lúc nào và vì sao. */
export function OneClickHistory({ profileId, profileName }: { profileId: string; profileName: (id: string) => string }) {
  const now = useNow(15_000);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const [outcome, setOutcome] = useState<OneClickOutcome | ''>('');
  const [range, setRange] = useState<Range>('24h');
  const [limit, setLimit] = useState(50);
  const [open, setOpen] = useState<OneClickHistoryEntry | null>(null);
  const from = useMemo(() => {
    const span = RANGES[range];
    return span === null ? null : Date.now() - span;
  }, [range]);
  const qs = new URLSearchParams({ profileId, limit: String(limit) });
  if (from !== null) qs.set('from', String(from));
  if (q) qs.set('q', q);
  if (outcome) qs.set('outcome', outcome);
  const { data, error, reload } = useApi<ListResult<OneClickHistoryEntry>>(`trading/oneclick/history?${qs}`, 15_000);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Mã kèo hoặc tên đội…" className="h-8 w-64" aria-label="Tìm kèo" type="search" />
        <Select value={outcome} onChange={(e) => setOutcome(e.target.value as OneClickOutcome | '')} className="w-56" aria-label="Kết quả">
          <option value="">Mọi kết quả</option>
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Segmented value={range} onChange={setRange} options={(Object.keys(RANGES) as Range[]).map((k) => ({ value: k, label: RANGE_LABEL[k] }))} />
        <span className="num ml-auto text-caption text-faint">{data ? `${data.total} kèo` : ''}</span>
      </div>

      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {!data && !error ? <SkeletonRows rows={6} /> : null}
      {data && !data.items.length ? <Empty icon={History}>Chưa có kèo nào lên On click trong khoảng này.</Empty> : null}

      {data?.items.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Lên bảng</TH>
              <TH>Trận · market</TH>
              <TH numeric>Kèo</TH>
              <TH numeric>Giá bán thấp nhất</TH>
              <TH numeric>Lãi dự kiến</TH>
              <TH numeric>Trên bảng</TH>
              <TH>Kết quả</TH>
            </tr>
          </THead>
          <tbody>
            {data.items.map((e) => {
              const o = oneClickOutcome(e);
              return (
                <TR key={`${e.profileId}|${e.signalId}`} interactive onClick={() => setOpen(e)} highlight={open?.signalId === e.signalId}>
                  <TD className="num text-caption text-muted-fg">{fmtStamp(e.firstAt)}</TD>
                  <TD className="max-w-72">
                    <span className="block truncate text-fg">
                      {e.teams[0]} vs {e.teams[1]}
                    </span>
                    <span className="block truncate text-caption text-muted-fg">
                      {e.sport} · {marketLabel(e.market)} · {e.phase}
                    </span>
                  </TD>
                  <TD numeric>
                    <span className="block text-fg">{fmtMargin(e.signalMargin)}</span>
                    <span className="block text-caption text-muted-fg">{e.tierName ?? '—'}</span>
                  </TD>
                  <TD numeric className="num text-fg">
                    {e.minAsk ?? '—'}
                    {e.threshold != null ? <span className="text-caption text-muted-fg"> / ≥ {e.threshold}</span> : null}
                  </TD>
                  <TD numeric>
                    <span className={cn('block', e.analysis.profit >= 0 ? 'text-ok' : 'text-critical')}>{usd(e.analysis.profit)}</span>
                    <span className="block text-caption text-muted-fg">{fmtMargin(e.analysis.netMargin)}</span>
                  </TD>
                  <TD numeric className="num text-caption text-muted-fg">
                    {fmtDuration(Math.max(0, (e.endedAt ?? now) - e.firstAt))}
                    <span className="block">{e.updates} lần cập nhật</span>
                  </TD>
                  <TD>
                    <Pill tone={o.tone}>{o.label}</Pill>
                    {e.endedAt ? <span className="num mt-0.5 block text-caption text-faint">{fmtStamp(e.endedAt)}</span> : null}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      ) : null}
      {data && data.total > data.items.length ? (
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" onClick={() => setLimit((l) => l + 50)}>
            Xem thêm
          </Button>
        </div>
      ) : null}

      <TradeDetailPanel
        trade={open?.analysis ?? null}
        profileName={profileName}
        onClose={() => setOpen(null)}
        badge={open ? <Pill tone={oneClickOutcome(open).tone}>{oneClickOutcome(open).label}</Pill> : null}
        footer={
          open ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2 text-caption text-muted-fg">
              <span>
                Lên bảng <span className="num">{fmtStamp(open.firstAt)}</span> · cập nhật cuối <span className="num">{fmtStamp(open.lastAt)}</span>
                {open.endedAt ? (
                  <>
                    {' '}
                    · rời bảng <span className="num">{fmtStamp(open.endedAt)}</span>
                  </>
                ) : null}
              </span>
              <Link href={`/keo?tab=history&q=${encodeURIComponent(open.signalId)}`} className="text-accent-text hover:underline">
                Xem kèo trong lịch sử kèo →
              </Link>
            </div>
          ) : null
        }
      />
    </div>
  );
}
