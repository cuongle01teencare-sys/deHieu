'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Monitor, Plus, Tags, Trash2 } from 'lucide-react';
import type { ArbitrageSettings, Phase, TeamAlias } from '@/lib/types';
import { fmtStamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useIsMobile } from '@/hooks/use-media';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Field, Input, SearchInput, Switch } from '../ui/controls';
import { PageHeader } from '../ui/layout';
import { Confirm } from '../ui/panel';
import { Empty, ErrorState, SkeletonRows, SkeletonText } from '../ui/states';
import { Table, TD, TH, THead, TR } from '../ui/table';

/** Gợi ý chỉ-xem trên mobile. */
function DesktopOnlyHint() {
  return (
    <div className="mb-6 flex items-center gap-2 text-caption text-muted-fg md:hidden">
      <Monitor className="size-3.5 stroke-[1.5]" /> Chỉnh sửa trên máy tính
    </div>
  );
}

/* ------------------------------------------------------------------ Cài đặt arbitrage */

interface Form {
  minMargin: string; // %
  marginStep: string; // %
  signalTtl: string; // s
  maxDrift: string; // phút
  phases: Phase[];
}

const toForm = (s: ArbitrageSettings): Form => ({
  minMargin: (s.minMargin * 100).toFixed(2).replace(/\.?0+$/, ''),
  marginStep: (s.marginStep * 100).toFixed(2).replace(/\.?0+$/, ''),
  signalTtl: String(s.signalTtlMs / 1000),
  maxDrift: String(s.maxStartDriftMs / 60_000),
  phases: s.enabledPhases,
});

const fromForm = (f: Form): ArbitrageSettings => ({
  minMargin: Number(f.minMargin) / 100,
  marginStep: Number(f.marginStep) / 100,
  signalTtlMs: Math.round(Number(f.signalTtl) * 1000),
  maxStartDriftMs: Math.round(Number(f.maxDrift) * 60_000),
  enabledPhases: f.phases,
});

const LABELS: Record<keyof ArbitrageSettings, { label: string; fmt: (v: never) => string }> = {
  minMargin: { label: 'Ngưỡng lợi nhuận tối thiểu', fmt: (v: number) => `${(v * 100).toFixed(2)}%` },
  marginStep: { label: 'Bước ghi đè', fmt: (v: number) => `${(v * 100).toFixed(2)}%` },
  signalTtlMs: { label: 'Thời hạn kèo', fmt: (v: number) => `${v / 1000}s` },
  maxStartDriftMs: { label: 'Lệch giờ bắt đầu tối đa', fmt: (v: number) => `${v / 60_000} phút` },
  enabledPhases: { label: 'Kênh tạo kèo', fmt: (v: Phase[]) => (v.length ? v.join(', ') : 'không kênh nào') },
};

export function SettingsPage() {
  const mobile = useIsMobile();
  const { data, error, reload } = useApi<ArbitrageSettings>('arbitrage/settings');
  const reason = useGuard('arbitrage-settings:write');
  const readOnly = mobile || !!reason;
  const mutate = useMutate();
  const [form, setForm] = useState<Form | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm(toForm(data));
  }, [data]);

  const next = form ? fromForm(form) : null;
  const diff = useMemo(() => {
    if (!data || !next) return [];
    return (Object.keys(LABELS) as (keyof ArbitrageSettings)[]).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(next[k]));
  }, [data, next]);
  const invalid =
    !next ||
    !(next.minMargin >= 0 && next.minMargin <= 1) ||
    !(next.marginStep > 0 && next.marginStep <= 1) ||
    !(next.signalTtlMs > 0) ||
    !(next.maxStartDriftMs >= 0);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Cài đặt arbitrage" description="Áp dụng ngay cho vòng đánh giá kế tiếp. Mọi thay đổi được ghi audit." />
      <DesktopOnlyHint />
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {!form ? (
        <SkeletonText lines={8} />
      ) : (
        <form
          className="flex flex-col gap-9"
          onSubmit={(e) => {
            e.preventDefault();
            if (diff.length && !invalid) setConfirm(true);
          }}
        >
          <Field label="Ngưỡng lợi nhuận tối thiểu" htmlFor="min" help="Kèo có margin dưới ngưỡng bị hủy (below_threshold). Mặc định 2%.">
            <Unit unit="%">
              <Input id="min" inputMode="decimal" className="num" value={form.minMargin} disabled={readOnly} onChange={(e) => setForm({ ...form, minMargin: e.target.value })} />
            </Unit>
          </Field>
          <Field label="Bước ghi đè" htmlFor="step" help="Lợi nhuận tăng thêm ít nhất bước này → kèo mới ghi đè kèo cũ của cùng tổ hợp.">
            <Unit unit="%">
              <Input id="step" inputMode="decimal" className="num" value={form.marginStep} disabled={readOnly} onChange={(e) => setForm({ ...form, marginStep: e.target.value })} />
            </Unit>
          </Field>
          <Field label="Thời hạn kèo" htmlFor="ttl" help="Kèo còn nguyên sau thời hạn này thì được phát lại (refreshed).">
            <Unit unit="giây">
              <Input id="ttl" inputMode="numeric" className="num" value={form.signalTtl} disabled={readOnly} onChange={(e) => setForm({ ...form, signalTtl: e.target.value })} />
            </Unit>
          </Field>
          <Field label="Lệch giờ bắt đầu tối đa" htmlFor="drift" help="Hai chân chỉ ghép khi giờ bắt đầu giữa hai tenant lệch không quá giá trị này.">
            <Unit unit="phút">
              <Input id="drift" inputMode="numeric" className="num" value={form.maxDrift} disabled={readOnly} onChange={(e) => setForm({ ...form, maxDrift: e.target.value })} />
            </Unit>
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-body font-medium text-fg">Kênh tạo kèo</span>
            <p className="text-caption text-muted-fg">Tắt một kênh → kèo đang sống của kênh đó bị hủy (phase_disabled). Odds vẫn được cập nhật.</p>
            {(['live', 'prematch'] as Phase[]).map((p) => (
              <label key={p} className="flex h-12 items-center justify-between border-b border-line last:border-0">
                <span className="text-body text-fg">{p === 'live' ? 'Live' : 'Trước trận'}</span>
                <Switch
                  checked={form.phases.includes(p)}
                  disabled={readOnly}
                  label={p}
                  onCheckedChange={(v) => setForm({ ...form, phases: v ? [...new Set([...form.phases, p])] : form.phases.filter((x) => x !== p) })}
                />
              </label>
            ))}
          </div>
          {!mobile ? (
            <div className="flex items-center gap-3 border-t border-line pt-6">
              <Button type="submit" variant="primary" disabled={!diff.length || invalid} disabledReason={reason}>
                Lưu thay đổi
              </Button>
              <Button type="button" variant="ghost" disabled={!diff.length} onClick={() => data && setForm(toForm(data))}>
                Hoàn tác
              </Button>
              <span className="text-caption text-faint">{diff.length ? `${diff.length} thay đổi chưa lưu` : 'Không có thay đổi'}</span>
            </div>
          ) : null}
        </form>
      )}
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title="Lưu cài đặt arbitrage?"
        description="Kiểm tra lại thay đổi trước khi áp dụng cho hệ thống đang chạy."
        confirmLabel="Lưu"
        loading={busy}
        onConfirm={async () => {
          if (!next || !data) return;
          setBusy(true);
          const body = Object.fromEntries(diff.map((k) => [k, next[k]]));
          const r = await mutate('arbitrage/settings', { method: 'PATCH', body }, 'Đã lưu cài đặt');
          setBusy(false);
          if (r) {
            setConfirm(false);
            void reload();
          }
        }}
      >
        {data && next ? (
          <ul>
            {diff.map((k) => (
              <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2.5 text-body last:border-0">
                <span className="min-w-0 flex-1 text-muted-fg">{LABELS[k].label}</span>
                <span className="num text-faint line-through">{(LABELS[k].fmt as (v: unknown) => string)(data[k])}</span>
                <ArrowRight className="size-3.5 text-faint" />
                <span className="num font-medium text-fg">{(LABELS[k].fmt as (v: unknown) => string)(next[k])}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Confirm>
    </div>
  );
}

function Unit({ unit, children }: { unit: string; children: React.ReactNode }) {
  return (
    <div className="flex max-w-[220px] items-center gap-3">
      {children}
      <span className="shrink-0 text-caption text-muted-fg">{unit}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ Bí danh đội */

export function AliasesPage() {
  const mobile = useIsMobile();
  const { data, error, reload } = useApi<TeamAlias[]>('team-aliases');
  const reason = useGuard('team-aliases:write');
  const mutate = useMutate();
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({ alias: '', canonical: '' });
  const [adding, setAdding] = useState(false);
  const [del, setDel] = useState<TeamAlias | null>(null);
  const [busy, setBusy] = useState(false);
  const needle = q.toLowerCase();
  const items = (data ?? []).filter((a) => !needle || a.alias.toLowerCase().includes(needle) || a.canonical.toLowerCase().includes(needle));

  const add = async () => {
    setAdding(true);
    const r = await mutate('team-aliases', { method: 'POST', body: draft }, `Đã thêm ${draft.alias} → ${draft.canonical}`);
    setAdding(false);
    if (r) {
      setDraft({ alias: '', canonical: '' });
      void reload();
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader title="Bí danh đội" description="Tên đội từ tenant được chuẩn hóa về tên chuẩn trước khi ghép room. Tên được tự viết thường, khoảng trắng thành gạch nối." />
      <DesktopOnlyHint />
      <div className="mb-6">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm bí danh…" className="w-full md:w-72" />
      </div>
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : null}
      {!data && !error ? <SkeletonRows rows={6} cols={[25, 25, 20, 10]} /> : null}

      {data ? (
        mobile ? (
          items.length ? (
            <ul>
              {items.map((a) => (
                <li key={a.id} className="flex min-h-14 items-center gap-3 border-b border-line py-3">
                  <span className="num text-body text-muted-fg">{a.alias}</span>
                  <ArrowRight className="size-3.5 text-faint" />
                  <span className="num flex-1 truncate text-body font-medium text-fg">{a.canonical}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={Tags}>Chưa có bí danh nào.</Empty>
          )
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Bí danh</TH>
                <TH className="w-8" />
                <TH>Tên chuẩn</TH>
                <TH>Tạo bởi</TH>
                <TH>Lúc</TH>
                <TH className="w-10" />
              </tr>
            </THead>
            <tbody>
              {/* hàng thêm mới ngay trong bảng */}
              <tr>
                <td className="border-b border-line py-2.5 pr-3">
                  <Input className="num" placeholder="vd: nip" value={draft.alias} disabled={!!reason} onChange={(e) => setDraft({ ...draft, alias: e.target.value })} aria-label="Bí danh mới" />
                </td>
                <td className="border-b border-line px-1 text-center">
                  <ArrowRight className="mx-auto size-3.5 text-faint" />
                </td>
                <td className="border-b border-line px-3 py-2.5">
                  <Input
                    className="num"
                    placeholder="vd: ninjas-in-pyjamas"
                    value={draft.canonical}
                    disabled={!!reason}
                    onChange={(e) => setDraft({ ...draft, canonical: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && draft.alias && draft.canonical && void add()}
                    aria-label="Tên chuẩn"
                  />
                </td>
                <td colSpan={3} className="border-b border-line py-2.5 pl-3 text-right">
                  <Button variant="secondary" size="sm" loading={adding} disabled={!draft.alias || !draft.canonical} disabledReason={reason} onClick={() => void add()}>
                    <Plus /> Thêm
                  </Button>
                </td>
              </tr>
              {items.map((a) => (
                <TR key={a.id}>
                  <TD className="num text-muted-fg">{a.alias}</TD>
                  <TD className="px-1 text-center">
                    <ArrowRight className="mx-auto size-3.5 text-faint" />
                  </TD>
                  <TD className="num font-medium text-fg">{a.canonical}</TD>
                  <TD className="text-caption text-muted-fg">{a.createdBy ?? '—'}</TD>
                  <TD className="num text-caption text-muted-fg">{fmtStamp(a.createdAt)}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon-sm" aria-label={`Xóa ${a.alias}`} disabledReason={reason} onClick={() => setDel(a)} className={cn('opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100')}>
                      <Trash2 />
                    </Button>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )
      ) : null}
      {data && !mobile && !items.length && q ? <p className="py-8 text-center text-body text-muted-fg">Không có bí danh khớp “{q}”.</p> : null}

      <Confirm
        open={!!del}
        onOpenChange={(v) => !v && setDel(null)}
        tone="danger"
        title={`Xóa bí danh ${del?.alias ?? ''}?`}
        description={`Tên “${del?.alias}” sẽ không còn được chuẩn hóa thành “${del?.canonical}”. Room đã ghép nhờ bí danh này có thể tách ra ở lần cập nhật kế tiếp.`}
        confirmLabel="Xóa"
        loading={busy}
        onConfirm={async () => {
          if (!del) return;
          setBusy(true);
          const r = await mutate(`team-aliases/${encodeURIComponent(del.id)}`, { method: 'DELETE' }, `Đã xóa ${del.alias}`);
          setBusy(false);
          if (r !== null) {
            setDel(null);
            void reload();
          }
        }}
      />
    </div>
  );
}
