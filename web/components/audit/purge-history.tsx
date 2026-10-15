'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { FilterChip, Input } from '../ui/controls';
import { Confirm } from '../ui/panel';

interface PurgeResult {
  before: number;
  matched: number;
  deleted: number;
}

type Scope = 1 | 7 | 30 | 90 | 'custom' | 'all';
const PRESETS: { value: Scope; label: string }[] = [
  { value: 1, label: 'Cũ hơn 1 ngày' },
  { value: 7, label: 'Cũ hơn 7 ngày' },
  { value: 30, label: 'Cũ hơn 30 ngày' },
  { value: 90, label: 'Cũ hơn 90 ngày' },
  { value: 'custom', label: 'Tự nhập' },
  { value: 'all', label: 'Xóa hết' },
];

/**
 * Nút + hộp xóa audit / lịch sử odds: cũ hơn N ngày (có sẵn 1/7/30/90 hoặc tự nhập) hoặc xóa hết.
 * Đếm trước (dryRun) để thấy số bản ghi sẽ mất. Cần quyền admin:purge.
 */
export function PurgeHistoryButton({
  target,
  label,
  onDone,
}: {
  target: 'audit' | 'odds-transitions';
  /** "audit" / "lịch sử odds" — dùng trong câu chữ. */
  label: string;
  onDone: () => void;
}) {
  const guard = useGuard('admin:purge');
  const mutate = useMutate();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>(30);
  const [custom, setCustom] = useState('14');
  const [matched, setMatched] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const days = scope === 'custom' ? Number(custom) : scope === 'all' ? null : scope;
  const valid = scope === 'all' || (Number.isInteger(days) && days! >= 1 && days! <= 3650);
  const body = scope === 'all' ? { all: true } : { olderThanDays: days };
  const path = `admin/${target}/purge`;
  const key = JSON.stringify(body);

  useEffect(() => {
    if (open) setScope(30);
  }, [open]);

  useEffect(() => {
    if (!open || !valid) {
      setMatched(null);
      return;
    }
    let live = true;
    setMatched(null);
    const t = setTimeout(() => {
      api<PurgeResult>(path, { method: 'POST', body: JSON.stringify({ ...body, dryRun: true }) })
        .then((r) => live && setMatched(r.matched))
        .catch(() => live && setMatched(null));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, key, valid, path]);

  return (
    <>
      <Button variant="danger-ghost" size="sm" disabledReason={guard} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> Xóa {label}…
      </Button>
      <Confirm
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title={`Xóa ${label}`}
        description={`Xóa vĩnh viễn bản ghi ${label}, không hoàn tác được. Ngoài ra hệ thống vẫn tự dọn theo thời hạn giữ ở cấu hình.`}
        confirmLabel={matched ? `Xóa ${matched.toLocaleString('vi-VN')} bản ghi` : 'Xóa'}
        loading={busy}
        onConfirm={async () => {
          if (!valid || !matched) return;
          setBusy(true);
          const r = await mutate<PurgeResult>(path, { method: 'POST', body });
          setBusy(false);
          if (r) {
            toast.success(`Đã xóa ${r.deleted.toLocaleString('vi-VN')} bản ghi ${label}`);
            setOpen(false);
            onDone();
          }
        }}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <FilterChip key={String(p.value)} active={scope === p.value} onClick={() => setScope(p.value)}>
                {p.label}
              </FilterChip>
            ))}
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
              'Không có bản ghi nào khớp.'
            ) : (
              <>
                Sẽ xóa <span className="num font-medium text-fg">{matched.toLocaleString('vi-VN')}</span> bản ghi
                {scope === 'all' ? ' (toàn bộ).' : ` cũ hơn ${days} ngày.`}
              </>
            )}
          </p>
          {target === 'audit' && scope === 'all' ? (
            <p className="text-caption text-warn">Chính thao tác xóa này vẫn được ghi lại vào audit sau khi xóa.</p>
          ) : null}
        </div>
      </Confirm>
    </>
  );
}
