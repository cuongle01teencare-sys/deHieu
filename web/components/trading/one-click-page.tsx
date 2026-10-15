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
import { Field, Select } from '../ui/controls';
import { PageHeader, Section } from '../ui/layout';
import { Pill } from '../ui/status';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { TradeDetailPanel } from './trade-detail';

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
  const rows = useMemo(() => (board.data ?? []).filter((c) => c.expiresAt > now), [board.data, now]);
  const open = rows.find((c) => c.signalId === openId) ?? null;

  const enter = async (c: OneClickCandidate) => {
    setBusy(c.signalId);
    const r = await mutate<{ sent: true }>(
      'trading/oneclick/enter',
      { method: 'POST', body: { profileId: c.profileId, signalId: c.signalId } },
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
        description="Kèo có lãi nhưng giá bán thấp nhất trên Polymarket từ ngưỡng của profile trở lên (mặc định 0.50): bot không tự vào mà để ở đây. Mỗi kèo có đủ phân tích như bot; người bấm Vào lệnh (giấy) thì trader đọc lại sổ lệnh và vào như bot (bảng tiền, số lệnh mỗi hạng, hạn mức trận), ghi kèm người vào."
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
          {profile ? (threshold > 0 ? <>Ngưỡng: giá bán thấp nhất ≥ <span className="num text-fg">{threshold}</span> (sửa ở Auto trade › Profile)</> : <span className="text-warn">Profile đang tắt On click (ngưỡng = 0) — bot tự vào mọi kèo.</span>) : null}
        </div>
      </div>

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
                <TH numeric>Giá bán thấp nhất</TH>
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
                <Row key={c.signalId} c={c} now={now} busy={busy === c.signalId} manage={manage} onOpen={() => setOpenId(c.signalId)} onEnter={() => void enter(c)} />
              ))}
            </tbody>
          </Table>
        )}
      </Section>

      <TradeDetailPanel
        trade={open?.analysis ?? null}
        profileName={(id) => profiles.data?.find((p) => p.id === id)?.name ?? id}
        onClose={() => setOpenId(null)}
        badge={<Pill tone="accent">Chờ người vào · dự kiến</Pill>}
        footer={
          open ? (
            <Button size="sm" disabledReason={manage ?? (busy ? 'Đang gửi…' : null)} onClick={() => void enter(open)}>
              <MousePointerClick aria-hidden /> Vào lệnh (giấy)
            </Button>
          ) : null
        }
      />
    </div>
  );
}

function Row({ c, now, busy, manage, onOpen, onEnter }: { c: OneClickCandidate; now: number; busy: boolean; manage: string | null; onOpen: () => void; onEnter: () => void }) {
  const t: TradeAttempt = c.analysis;
  const d = t.detail as TradeDetail;
  const left = c.expiresAt - now;
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
      <TD numeric className="num text-fg">
        {d.minAsk ?? '—'}
      </TD>
      <TD numeric>
        {t.book ? (
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
        {t.polymarket ? (
          <>
            <span className="block text-fg">{usd(t.polymarket.cost)}</span>
            <span className="block text-caption text-muted-fg">
              {t.polymarket.pick} · {+t.polymarket.shares.toFixed(2)} @ {t.polymarket.avgPrice.toFixed(3)}
            </span>
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </TD>
      <TD numeric>
        <span className={cn('block', t.profit >= 0 ? 'text-ok' : 'text-critical')}>{usd(t.profit)}</span>
        <span className="block text-caption text-muted-fg">{fmtMargin(t.netMargin)}</span>
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
