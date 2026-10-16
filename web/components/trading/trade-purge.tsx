'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TradeStatus } from '@/lib/trading-types';
import { useMutate } from '../shell/shell-context';
import { FilterChip } from '../ui/controls';
import { Confirm } from '../ui/panel';
import { TRADE_STATUS } from './trade-detail';

export interface TradePurgeResult {
  matched: number;
  deleted: number;
  /** Xóa toàn bộ: số task trader được báo xét lại kèo còn sống. */
  resetTasks?: number;
}

const STATUSES = Object.keys(TRADE_STATUS) as TradeStatus[];

/**
 * Xóa lệnh trong sổ: chọn một hoặc nhiều trạng thái (kết hợp), hoặc toàn bộ.
 * Áp theo profile đang lọc. Đếm trước (dryRun) để người dùng thấy số lệnh sẽ mất.
 */
export function PurgeTradesDialog({
  open,
  onOpenChange,
  profileId,
  profileName,
  initialStatus,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** '' = mọi profile. */
  profileId: string;
  profileName: string | null;
  /** Trạng thái đang lọc ở danh sách (chọn sẵn). */
  initialStatus: TradeStatus | '';
  onDone: () => void;
}) {
  const mutate = useMutate();
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<TradeStatus[]>([]);
  const [matched, setMatched] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAll(false);
    setPicked(initialStatus ? [initialStatus] : []);
  }, [open, initialStatus]);

  const scope = all ? { all: true } : { statuses: picked };
  const body = { ...scope, ...(profileId ? { profileId } : {}) };
  const ready = all || picked.length > 0;
  const key = JSON.stringify(body);

  // đếm trước số lệnh sẽ xóa
  useEffect(() => {
    if (!open || !ready) {
      setMatched(null);
      return;
    }
    let live = true;
    setMatched(null);
    api<TradePurgeResult>('trading/trades/purge', {
      method: 'POST',
      body: JSON.stringify({ ...body, dryRun: true }),
    })
      .then((r) => live && setMatched(r.matched))
      .catch(() => live && setMatched(null));
    return () => {
      live = false;
    };
  }, [open, key, ready]);

  const toggle = (s: TradeStatus) => {
    setAll(false);
    setPicked((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));
  };
  const risky =
    all ||
    picked.some((s) => ['paper_filled', 'filled', 'partial'].includes(s));
  const where = profileName ? `của profile ${profileName}` : 'của mọi profile';

  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      tone="danger"
      title="Xóa lệnh trong sổ"
      description={`Xóa vĩnh viễn các lệnh ${where} (kèm các chân lệnh). Không hoàn tác được.`}
      confirmLabel={matched ? `Xóa ${matched} lệnh` : 'Xóa'}
      loading={busy}
      onConfirm={async () => {
        if (!ready || !matched) return;
        setBusy(true);
        const r = await mutate<TradePurgeResult>(
          'trading/trades/purge',
          { method: 'POST', body },
          undefined,
        );
        setBusy(false);
        if (r) {
          toast.success(`Đã xóa ${r.deleted} lệnh`, {
            description: r.resetTasks
              ? `${r.resetTasks} trader đang chạy sẽ xét lại các kèo còn sống.`
              : undefined,
          });
          onOpenChange(false);
          onDone();
        }
      }}
    >
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-caption text-muted-fg">
            Trạng thái (chọn một hoặc nhiều)
          </p>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <FilterChip
                key={s}
                active={!all && picked.includes(s)}
                onClick={() => toggle(s)}
              >
                {TRADE_STATUS[s].label}
              </FilterChip>
            ))}
            <FilterChip
              active={all}
              onClick={() => {
                setAll((v) => !v);
                setPicked([]);
              }}
            >
              Toàn bộ
            </FilterChip>
          </div>
        </div>
        <p className="text-body text-muted-fg">
          {!ready ? (
            'Chọn ít nhất một trạng thái, hoặc Toàn bộ.'
          ) : matched === null ? (
            'Đang đếm…'
          ) : matched === 0 ? (
            'Không có lệnh nào khớp.'
          ) : (
            <>
              Sẽ xóa <span className="num font-medium text-fg">{matched}</span>{' '}
              lệnh.
            </>
          )}
        </p>
        {all ? (
          <p className="text-caption text-muted-fg">
            Xóa toàn bộ: trader đang chạy của{' '}
            {profileName ? 'profile này' : 'mọi profile'} quên dấu &quot;đã xử
            lý&quot; và xét lại ngay các kèo còn sống. Số lệnh mỗi hạng và hạn
            mức trận vẫn giữ nên không vượt số lệnh (cửa đã đủ thì bỏ qua im
            lặng).
          </p>
        ) : null}
        {risky && matched ? (
          <p className="text-caption text-critical">
            Có cả lệnh đã vào: lãi giả định và tiền vào của các lệnh này sẽ mất
            khỏi thống kê. Hạn mức theo trận đã giữ không được trả lại ngay (tự
            hết hạn).
          </p>
        ) : null}
      </div>
    </Confirm>
  );
}
