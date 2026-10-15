'use client';

import { useEffect, useMemo, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { fmtDuration, fmtMargin, fmtSince } from '@/lib/format';
import { marketLabel } from '@/lib/markets';
import type { OneClickCandidate, TradeAttempt, TradeDetail, TraderProfile } from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Field, Segmented, Select } from '../ui/controls';
import { PageHeader, Section } from '../ui/layout';
import { Pill } from '../ui/status';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { OneClickHistory } from './one-click-history';
import { REASON_LABEL, TradeDetailPanel } from './trade-detail';
import { NumInput } from './stake-plan-editor';
import { previewSizing, type SizingPreview } from '@/lib/one-click-sizing';

const usd = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(n).toFixed(2)}$`;

/**
 * On click: kèo có lãi mà giá bán thấp nhất Polymarket ≥ ngưỡng của profile — bot không tự vào.
 * Mỗi kèo kèm phân tích "nếu vào bây giờ" y như bot; người bấm Vào lệnh (giấy) thì trader của
 * profile đọc lại sổ lệnh và vào như bot, ghi kèm người vào.
 */
export function OneClickPage() {
  const profiles = useApi<TraderProfile[]>('trading/profiles', 30_000);
  const [profileId, setProfileId] = useState<string>('');
  useEffect(() => {
    const list = profiles.data ?? [];
    if (!profileId && list.length) setProfileId((list.find((p) => p.enabled) ?? list[0]!).id);
  }, [profiles.data, profileId]);
  const profile = profiles.data?.find((p) => p.id === profileId) ?? null;

  const board = useApi<OneClickCandidate[]>(profileId ? `trading/oneclick?profileId=${encodeURIComponent(profileId)}` : null, 2_000);
  const manage = useGuard('trading:manage');
  const mutate = useMutate();
  const now = useNow(1_000);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'live' | 'history'>('live');
  /** Tiền mục tiêu người nhập theo kèo; chưa nhập = tiền của hạng trong profile. */
  const [stakes, setStakes] = useState<Record<string, number>>({});
  const stakeOf = (c: OneClickCandidate) => stakes[c.signalId] ?? defaultStake(c);
  const setStake = (c: OneClickCandidate, v: number | undefined) => v !== undefined && v > 0 && setStakes((m) => ({ ...m, [c.signalId]: v }));
  const profileName = (id: string) => profiles.data?.find((p) => p.id === id)?.name ?? id;
  const rows = useMemo(() => (board.data ?? []).filter((c) => c.expiresAt > now), [board.data, now]);
  const open = rows.find((c) => c.signalId === openId) ?? null;

  const enter = async (c: OneClickCandidate) => {
    setBusy(c.signalId);
    const r = await mutate<{ sent: true }>(
      'trading/oneclick/enter',
      { method: 'POST', body: { profileId: c.profileId, signalId: c.signalId, targetStake: stakeOf(c) } },
      'Đã gửi lệnh cho trader — kết quả hiện ở Auto trade › Lệnh giấy',
    );
    setBusy(null);
    if (r) {
      setOpenId(null);
      void board.reload();
    }
  };

  const threshold = profile?.risk.oneClickMinPrice ?? 0;

  return (
    <div>
      <PageHeader
        title="On click"
        description="Kèo có lãi nhưng giá bán thấp nhất trên Polymarket từ ngưỡng của profile trở lên (mặc định 0.50): bot không tự vào mà để ở đây. Nhập tiền mục tiêu cho từng kèo (mặc định tiền của hạng): trang tính lại ngay theo cơ chế taker như bot — mức giá sau hết lãi thì dừng, vào ít hơn. Bấm Vào lệnh (giấy) thì trader đọc lại sổ lệnh thật và vào (lãi tối thiểu, số lệnh mỗi hạng, hạn mức trận vẫn áp), ghi kèm người vào."
        meta={<Pill tone="warn">Chế độ giấy</Pill>}
      />

      <div className="mb-8 grid max-w-xl grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Profile (cấu hình dùng để phân tích và vào lệnh)" htmlFor="oc-profile">
          <Select id="oc-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {(profiles.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.enabled ? '' : ' (tắt)'}
              </option>
            ))}
          </Select>
        </Field>
        <div className="self-end pb-2 text-caption text-muted-fg">
          {profile ? (
            threshold > 0 ? (
              <>
                Ngưỡng: giá bán thấp nhất ≥ <span className="num text-fg">{threshold}</span> (sửa ở Auto trade › Profile)
              </>
            ) : (
              <span className="text-warn">Profile đang tắt On click (ngưỡng = 0) — bot tự vào mọi kèo.</span>
            )
          ) : null}
        </div>
      </div>

      <div className="mb-8">
        <Segmented<'live' | 'history'>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'live', label: 'Đang chờ' },
            { value: 'history', label: 'Lịch sử' },
          ]}
        />
      </div>

      {tab === 'history' && profileId ? <OneClickHistory profileId={profileId} profileName={profileName} /> : null}

      {tab === 'live' ? (
        <Section title="Kèo chờ vào lệnh" description="Cập nhật mỗi lần trader làm mới kèo; tự biến mất khi kèo bị hủy, hết hạn hoặc đã vào. Bấm một dòng để xem đủ phân tích.">
          {profiles.error ? (
            <ErrorState message={profiles.error} onRetry={() => void profiles.reload()} />
          ) : board.error ? (
            <ErrorState message={board.error} onRetry={() => void board.reload()} />
          ) : !board.data && profileId ? (
            <SkeletonRows rows={4} />
          ) : !rows.length ? (
            <Empty icon={MousePointerClick}>{profileId ? 'Chưa có kèo nào chờ vào lệnh.' : 'Chưa có profile nào.'}</Empty>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Trận · market</TH>
                  <TH numeric>Kèo</TH>
                  <TH>Trận trong giải</TH>
                  <TH numeric>Giá bán thấp nhất</TH>
                  <TH numeric>Tiền mục tiêu ($)</TH>
                  <TH numeric>csgoempire</TH>
                  <TH numeric>Polymarket</TH>
                  <TH numeric>Lãi dự kiến</TH>
                  <TH numeric>Cập nhật</TH>
                  <TH numeric>Còn</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {rows.map((c) => (
                  <Row
                    key={c.signalId}
                    c={c}
                    now={now}
                    stake={stakeOf(c)}
                    onStake={(v) => setStake(c, v)}
                    busy={busy === c.signalId}
                    manage={manage}
                    onOpen={() => setOpenId(c.signalId)}
                    onEnter={() => void enter(c)}
                  />
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      ) : null}

      <TradeDetailPanel
        trade={open?.analysis ?? null}
        profileName={profileName}
        onClose={() => setOpenId(null)}
        badge={<Pill tone="accent">Chờ người vào · dự kiến</Pill>}
        footer={
          open ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-3">
              <label className="flex items-center gap-2 text-caption text-muted-fg">
                Tiền mục tiêu ($)
                <span className="w-24">
                  <NumInput id="oc-stake" value={stakeOf(open)} onValue={(v) => setStake(open, v)} />
                </span>
              </label>
              <PreviewText p={previewSizing(open.analysis, stakeOf(open))} target={stakeOf(open)} />
              <Button size="sm" disabledReason={manage ?? (busy ? 'Đang gửi…' : null)} onClick={() => void enter(open)}>
                <MousePointerClick aria-hidden /> Vào lệnh (giấy)
              </Button>
            </div>
          ) : null
        }
      />
    </div>
  );
}

/** Một dòng "csgoempire 8/12" (tên giải ở tooltip). */
function TourCell({ label, leg }: { label: string; leg: { tournament?: { name: string | null; no: number; of: number } | null } | null }) {
  const t = leg?.tournament;
  return (
    <span className="block whitespace-nowrap text-muted-fg" title={t?.name ?? undefined}>
      {label}{' '}
      {t ? (
        <>
          <span className="num text-fg">{t.no}</span>
          <span className="num">/{t.of}</span>
        </>
      ) : (
        <span className="text-faint">—</span>
      )}
    </span>
  );
}

/** Tiền mục tiêu mặc định: tiền của hạng trong profile (bản phân tích bot tính). */
const defaultStake = (c: OneClickCandidate) => (c.analysis.detail as TradeDetail).sizing?.targetStake ?? (c.analysis.detail as TradeDetail).targetStake ?? c.analysis.book?.stake ?? 0;

/** Kết quả ước tính với tiền mục tiêu người nhập (một dòng). */
function PreviewText({ p, target }: { p: SizingPreview; target: number }) {
  if (!p.ok) return <span className="text-caption text-warn">{p.reason === 'NO_DATA' ? p.detail : `Không vào được: ${REASON_LABEL[p.reason] ?? p.reason} (${p.detail})`}</span>;
  return (
    <span className="text-caption text-muted-fg">
      Ước tính: vào <span className="num text-fg">{usd(p.stake)}</span>
      {p.stake + 0.005 < target ? <span className="text-warn"> (ít hơn {usd(target)} vì mức giá sau hết lãi)</span> : null} · lãi{' '}
      <span className={cn('num', p.profit >= 0 ? 'text-ok' : 'text-critical')}>
        {usd(p.profit)} ({fmtMargin(p.netMargin)})
      </span>
    </span>
  );
}

function Row({
  c,
  now,
  stake,
  onStake,
  busy,
  manage,
  onOpen,
  onEnter,
}: {
  c: OneClickCandidate;
  now: number;
  stake: number;
  onStake: (v: number | undefined) => void;
  busy: boolean;
  manage: string | null;
  onOpen: () => void;
  onEnter: () => void;
}) {
  const t: TradeAttempt = c.analysis;
  const d = t.detail as TradeDetail;
  const left = c.expiresAt - now;
  // tính lại với tiền mục tiêu người nhập (taker như bot, trên sổ lệnh lúc cập nhật)
  const p = previewSizing(t, stake);
  return (
    <TR interactive onClick={onOpen}>
      <TD className="max-w-72">
        <span className="block truncate text-fg">
          {t.teams[0]} vs {t.teams[1]}
        </span>
        <span className="block truncate text-caption text-muted-fg">
          {t.sport} · {marketLabel(t.market)} · {t.phase}
        </span>
      </TD>
      <TD numeric>
        <span className="block text-fg">{fmtMargin(t.signalMargin)}</span>
        <span className="block text-caption text-muted-fg">{t.tierName ?? '—'}</span>
      </TD>
      <TD className="text-caption">
        <TourCell label="csgoempire" leg={t.book} />
        <TourCell label="Polymarket" leg={t.polymarket} />
      </TD>
      <TD numeric className="num text-fg">
        {d.minAsk ?? '—'}
      </TD>
      <TD numeric>
        <span className="ml-auto block w-24" onClick={(e) => e.stopPropagation()}>
          <NumInput id={`oc-stake-${c.signalId}`} value={stake} onValue={onStake} />
        </span>
      </TD>
      <TD numeric>
        {t.book && p.ok ? (
          <>
            <span className={cn('block', p.stake + 0.005 < stake ? 'text-warn' : 'text-fg')}>{usd(p.stake)}</span>
            <span className="block text-caption text-muted-fg">
              {t.book.pick} @ {t.book.odds.toFixed(2)}
            </span>
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </TD>
      <TD numeric>
        {t.polymarket && p.ok ? (
          <>
            <span className="block text-fg">{usd(p.polyCost)}</span>
            <span className="block text-caption text-muted-fg">
              {t.polymarket.pick} · {+p.shares.toFixed(2)} @ {p.avgPrice.toFixed(3)}
            </span>
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </TD>
      <TD numeric>
        {p.ok ? (
          <>
            <span className={cn('block', p.profit >= 0 ? 'text-ok' : 'text-critical')}>{usd(p.profit)}</span>
            <span className="block text-caption text-muted-fg">{fmtMargin(p.netMargin)}</span>
          </>
        ) : (
          <span className="block max-w-40 text-caption text-warn">{p.reason === 'NO_DATA' ? '—' : (REASON_LABEL[p.reason] ?? p.reason)}</span>
        )}
      </TD>
      <TD numeric className="num text-caption text-muted-fg">
        {fmtSince(c.updatedAt, now)}
      </TD>
      <TD numeric className={cn('num text-caption', left < 10_000 ? 'text-warn' : 'text-muted-fg')}>
        {fmtDuration(Math.max(0, left))}
      </TD>
      <TD numeric>
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" disabledReason={manage ?? (busy ? 'Đang gửi…' : null)} onClick={onEnter}>
            Vào lệnh
          </Button>
        </span>
      </TD>
    </TR>
  );
}
