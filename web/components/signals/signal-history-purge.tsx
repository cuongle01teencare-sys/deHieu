'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { SignalStatus } from '@/lib/types';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { FilterChip, Input } from '../ui/controls';
import { Confirm } from '../ui/panel';

type Closed = Exclude<SignalStatus, 'active'>;
interface PurgeResult {
  before: number;
  matched: number;
  deleted: number;
}

const STATUSES: { value: Closed; label: string }[] = [
  { value: 'cancelled', label: 'Đã hủy' },
  { value: 'superseded', label: 'Bị thay' },
  { value: 'abandoned', label: 'Bỏ dở' },
];

type Scope = 1 | 7 | 30 | 'custom' | 'all';
const SCOPES: { value: Scope; label: string }[] = [
  { value: 1, label: 'Cũ hơn 1 ngày' },
  { value: 7, label: 'Cũ hơn 7 ngày' },
  { value: 30, label: 'Cũ hơn 30 ngày' },
  { value: 'custom', label: 'Tự nhập' },
  { value: 'all', label: 'Toàn bộ' },
];

/**
 * Xóa lịch sử kèo: chọn trạng thái (một hoặc nhiều) + phạm vi thời gian (cũ hơn N ngày / toàn bộ).
 * Kèo đang sống không bao giờ bị xóa. Đếm trước để thấy số kèo sẽ mất. Quyền admin:purge.
 */
export function SignalHistoryPurgeButton({ onDone }: { onDone: () => void }) {
  const guard = useGuard('admin:purge');
  const mutate = useMutate();
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState<Closed[]>([]);
  const [scope, setScope] = useState<Scope>(7);
  const [custom, setCustom] = useState('3');
  const [matched, setMatched] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const days = scope === 'custom' ? Number(custom) : scope === 'all' ? null : scope;
  const valid = scope === 'all' || (Number.isInteger(days) && days! >= 1 && days! <= 3650);
  const body = { ...(statuses.length ? { statuses } : {}), ...(scope === 'all' ? { all: true } : { olderThanDays: days }) };
  const key = JSON.stringify(body);

  useEffect(() => {
    if (open) {
      setStatuses([]);
      setScope(7);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !valid) {
      setMatched(null);
      return;
    }
    let live = true;
    setMatched(null);
    const t = setTimeout(() => {
      api<PurgeResult>('arbitrage/history/purge', { method: 'POST', body: JSON.stringify({ ...body, dryRun: true }) })
        .then((r) => live && setMatched(r.matched))
        .catch(() => live && setMatched(null));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, key, valid]);

  const toggle = (s: Closed) => setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const which = statuses.length ? statuses.map((s) => STATUSES.find((x) => x.value === s)!.label.toLowerCase()).join(', ') : 'mọi trạng thái đã kết thúc';

  return (
    <>
      <Button variant="danger-ghost" size="sm" disabledReason={guard} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> Xóa lịch sử…
      </Button>
      <Confirm
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="Xóa lịch sử kèo"
        description="Xóa vĩnh viễn, không hoàn tác được. Kèo đang sống không bị xóa. Lệnh giấy của trader không bị ảnh hưởng. Ngoài ra hệ thống vẫn tự dọn theo thời hạn giữ ở cấu hình."
        confirmLabel={matched ? `Xóa ${matched.toLocaleString('vi-VN')} kèo` : 'Xóa'}
        loading={busy}
        onConfirm={async () => {
          if (!valid || !matched) return;
          setBusy(true);
          const r = await mutate<PurgeResult>('arbitrage/history/purge', { method: 'POST', body });
          setBusy(false);
          if (r) {
            toast.success(`Đã xóa ${r.deleted.toLocaleString('vi-VN')} kèo khỏi lịch sử`);
            setOpen(false);
            onDone();
          }
        }}
      >
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-caption text-muted-fg">Trạng thái (bỏ trống = mọi trạng thái đã kết thúc)</div>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <FilterChip key={s.value} active={statuses.includes(s.value)} onClick={() => toggle(s.value)}>
                  {s.label}
                </FilterChip>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-caption text-muted-fg">Phạm vi (theo lúc phát)</div>
            <div className="flex flex-wrap gap-2">
              {SCOPES.map((p) => (
                <FilterChip key={String(p.value)} active={scope === p.value} onClick={() => setScope(p.value)}>
                  {p.label}
                </FilterChip>
              ))}
            </div>
          </div>
          {scope === 'custom' ? (
            <label className="flex items-center gap-2 text-body text-muted-fg">
              Cũ hơn
              <Input inputMode="numeric" className="num h-8 w-20" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} aria-label="Số ngày" />
              ngày
            </label>
          ) : null}
          <p className="text-body text-muted-fg">
            {!valid ? (
              'Nhập số ngày từ 1 đến 3650.'
            ) : matched === null ? (
              'Đang đếm…'
            ) : matched === 0 ? (
              'Không có kèo nào khớp.'
            ) : (
              <>
                Sẽ xóa <span className="num font-medium text-fg">{matched.toLocaleString('vi-VN')}</span> kèo ({which}){scope === 'all' ? ', toàn bộ thời gian.' : `, phát cũ hơn ${days} ngày.`}
              </>
            )}
          </p>
        </div>
      </Confirm>
    </>
  );
}
