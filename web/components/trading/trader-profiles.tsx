'use client';

import { useEffect, useState } from 'react';
import { MoreHorizontal, Pencil, Play, Plus, Square, Trash2, Users } from 'lucide-react';
import type { TaskRecord } from '@/lib/types';
import {
  DEFAULT_RISK,
  DEFAULT_STAKE_PLAN,
  TRADER_KIND,
  type RiskLimits,
  type StakePlan,
  type TradingAccountView,
  type TraderProfile,
  type TraderRuntimeConfig,
} from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Field, Input, Select, Switch } from '../ui/controls';
import { Section } from '../ui/layout';
import { Menu, MenuItem, MenuSeparator } from '../ui/menu';
import { Confirm, Panel } from '../ui/panel';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Pill, StatusDot, TASK_STATE_TONE } from '../ui/status';
import { Hint } from '../ui/tooltip';
import { NumInput, StakePlanEditor } from './stake-plan-editor';

/** Chiến lược worker hỗ trợ (id khớp danh mục chiến lược trong worker). */
const STRATEGIES = [
  { id: 'arb-taker', label: 'Ăn lệnh có sẵn (taker)', help: 'Mua ngay các mức giá Polymarket còn lãi ≥ ngưỡng sau phí taker; cân hai chân theo odds csgoempire.' },
];

const TREND_SHORT = { flat: 'ngang', up: 'tăng dần', down: 'giảm dần', custom: 'tùy chỉnh' } as const;

const INACTIVE_LABEL: Record<string, string> = {
  PROFILE_DISABLED: 'Profile đang tắt',
  CSGOEMPIRE_ACCOUNT_MISSING: 'Thiếu tài khoản csgoempire',
  CSGOEMPIRE_ACCOUNT_DISABLED: 'Tài khoản csgoempire đang tắt',
  POLYMARKET_ACCOUNT_MISSING: 'Thiếu ví Polymarket',
  POLYMARKET_ACCOUNT_DISABLED: 'Ví Polymarket đang tắt',
  NO_STAKE_TIER: 'Bảng vốn không có hạng nào > 0$',
  PROFILE_NOT_FOUND: 'Profile không tồn tại',
};

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'profile';

const traderTask = (tasks: TaskRecord[] | null, profileId: string) =>
  tasks?.find((t) => t.spec.kind === TRADER_KIND && t.spec.params.profileId === profileId) ?? null;

/** Profile trader: 1 csgoempire + 1 ví Polymarket + kế hoạch vốn + chiến lược + giới hạn rủi ro. */
export function TraderProfiles() {
  const profiles = useApi<TraderProfile[]>('trading/profiles', 15_000);
  const accounts = useApi<TradingAccountView[]>('trading/accounts', 15_000);
  const tasks = useApi<TaskRecord[]>('tasks', 5_000);
  const manage = useGuard('trading:manage');
  const runGuard = useGuard('tasks:manage');
  const mutate = useMutate();
  const [editing, setEditing] = useState<TraderProfile | 'new' | null>(null);
  const [removing, setRemoving] = useState<TraderProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const accountList = accounts.data ?? [];
  const label = (id: string) => accountList.find((a) => a.id === id)?.label ?? '—';
  const ready = accountList.some((a) => a.venue === 'csgoempire') && accountList.some((a) => a.venue === 'polymarket');

  const start = async (p: TraderProfile) => {
    const existing = traderTask(tasks.data, p.id);
    const r = existing
      ? await mutate(`tasks/${encodeURIComponent(existing.spec.taskId)}/start`, { method: 'POST' }, `Đã chạy lại trader ${p.name}`)
      : await mutate(
          'tasks',
          {
            method: 'POST',
            body: { taskId: `trader-${slug(p.name)}`, kind: TRADER_KIND, runtime: { type: 'worker' }, persist: true, params: { profileId: p.id } },
          },
          `Đã chạy trader ${p.name}`,
        );
    if (r !== null) void tasks.reload();
  };
  const stop = async (t: TaskRecord) => {
    const r = await mutate(`tasks/${encodeURIComponent(t.spec.taskId)}/stop`, { method: 'POST' }, `Đã dừng ${t.spec.taskId}`);
    if (r !== null) void tasks.reload();
  };

  const add = (
    <Button variant="primary" size="sm" onClick={() => setEditing('new')} disabledReason={manage ?? (ready ? null : 'Cần ít nhất 1 tài khoản csgoempire và 1 ví Polymarket')}>
      <Plus /> Thêm profile
    </Button>
  );

  return (
    <Section
      title="Profile trader"
      description="Mỗi profile chạy một task trader (worker thread) kết nối ConsumerHub như một consumer: mọi profile nhận CÙNG một kèo khi publisher phát. Chế độ giấy: đọc sổ lệnh + phí Polymarket thật, ghi lãi/lỗ giả định, không đặt lệnh."
      actions={add}
    >
      {profiles.error && !profiles.data ? <ErrorState message={profiles.error} onRetry={profiles.reload} /> : null}
      {!profiles.data && !profiles.error ? <SkeletonRows rows={2} cols={[30, 24, 20]} /> : null}
      {profiles.data && !profiles.data.length ? (
        <Empty icon={Users} action={add}>
          {ready ? 'Chưa có profile trader.' : 'Thêm tài khoản csgoempire và ví Polymarket ở tab Tài khoản trước, rồi tạo profile.'}
        </Empty>
      ) : null}
      {profiles.data?.length ? (
        <ul>
          {profiles.data.map((p) => {
            const t = traderTask(tasks.data, p.id);
            const running = t && ['RUNNING', 'STARTING', 'INITIALIZING', 'READY', 'RESTARTING'].includes(t.state);
            return (
              <li key={p.id} className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-line py-3 last:border-0">
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <StatusDot tone={t ? TASK_STATE_TONE[t.state] : 'muted'} label={t ? t.state : 'Chưa chạy'} />
                  <span className="min-w-0">
                    <span className={cn('block truncate text-body', p.enabled ? 'text-fg' : 'text-muted-fg')}>{p.name}</span>
                    <span className="block truncate text-caption text-faint">
                      {label(p.csgoempireAccountId)} + {label(p.polymarketAccountId)}
                    </span>
                  </span>
                  <Pill tone="muted">giấy</Pill>
                  {!p.enabled ? <Pill tone="muted">Tắt</Pill> : null}
                </span>
                <span className="w-full text-caption text-muted-fg md:w-56">
                  <span className="block">
                    Vốn {TREND_SHORT[p.stakePlan.trend]}
                    {p.stakePlan.trend !== 'custom' ? <span className="num text-fg"> · {p.stakePlan.baseStake}$</span> : null}
                    {p.stakePlan.scaleWithinTier ? ' · tăng trong hạng' : ''}
                  </span>
                  <span className="num block text-faint">
                    lãi ròng ≥ {+(p.risk.minNetMargin * 100).toFixed(2)}%{p.risk.matchCapUsd ? ` · ≤ ${p.risk.matchCapUsd}$/trận` : ''}
                  </span>
                </span>
                <span className="w-full md:w-48">
                  <RuntimeState profileId={p.id} task={t} />
                </span>
                <span className="ml-auto flex items-center gap-1 md:ml-0">
                  {running && t ? (
                    <Button variant="ghost" size="sm" onClick={() => void stop(t)} disabledReason={runGuard}>
                      <Square /> Dừng
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => void start(p)} disabledReason={runGuard}>
                      <Play /> Chạy
                    </Button>
                  )}
                  <Menu
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Thao tác ${p.name}`}>
                        <MoreHorizontal />
                      </Button>
                    }
                  >
                    <MenuItem icon={<Pencil />} disabledReason={manage} onSelect={() => setEditing(p)}>
                      Sửa
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} danger disabledReason={manage} onSelect={() => setRemoving(p)}>
                      Xóa
                    </MenuItem>
                  </Menu>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <ProfileForm
        value={editing}
        accounts={accountList}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void profiles.reload();
        }}
      />
      <Confirm
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        tone="danger"
        title={`Xóa profile ${removing?.name ?? ''}?`}
        description="Task trader của profile (nếu đang chạy) sẽ đứng yên với lý do PROFILE_NOT_FOUND — dừng/xóa task ở trang Publisher. Lệnh giấy đã ghi vẫn giữ."
        confirmLabel="Xóa profile"
        loading={busy}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          const r = await mutate(`trading/profiles/${encodeURIComponent(removing.id)}`, { method: 'DELETE' }, `Đã xóa ${removing.name}`);
          setBusy(false);
          if (r !== null) {
            setRemoving(null);
            void profiles.reload();
          }
        }}
      />
    </Section>
  );
}

/** Trạng thái task + cấu hình worker đang nhận (active / lý do đứng yên). */
function RuntimeState({ profileId, task }: { profileId: string; task: TaskRecord | null }) {
  const cfg = useApi<TraderRuntimeConfig>(`trading/profiles/${encodeURIComponent(profileId)}/runtime-config`, 15_000);
  if (!task) return <span className="text-caption text-faint">Chưa có task trader</span>;
  const reason = cfg.data && !cfg.data.active ? (INACTIVE_LABEL[cfg.data.inactiveReason ?? ''] ?? cfg.data.inactiveReason) : null;
  return (
    <span className="block text-caption">
      <span className="num block truncate text-muted-fg">{task.spec.taskId}</span>
      {reason ? (
        <Hint content="Worker vẫn nhận kèo nhưng bỏ qua và ghi lý do">
          <span className="block truncate text-warn">Đứng yên: {reason}</span>
        </Hint>
      ) : task.lastError ? (
        <Hint content={task.lastError}>
          <span className="block truncate text-critical/85">{task.lastError}</span>
        </Hint>
      ) : (
        <span className="block text-faint">{task.state === 'RUNNING' ? 'đang nhận kèo' : task.state.toLowerCase()}</span>
      )}
    </span>
  );
}

function ProfileForm({
  value,
  accounts,
  onClose,
  onSaved,
}: {
  value: TraderProfile | 'new' | null;
  accounts: TradingAccountView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const mutate = useMutate();
  const editing = value && value !== 'new' ? value : null;
  const empires = accounts.filter((a) => a.venue === 'csgoempire');
  const polys = accounts.filter((a) => a.venue === 'polymarket');
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [empire, setEmpire] = useState('');
  const [poly, setPoly] = useState('');
  const [plan, setPlan] = useState<StakePlan>(DEFAULT_STAKE_PLAN);
  const [strategy, setStrategy] = useState('arb-taker');
  const [risk, setRisk] = useState<RiskLimits>(DEFAULT_RISK);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) return;
    const e = value === 'new' ? null : value;
    setName(e?.name ?? '');
    setEnabled(e?.enabled ?? true);
    setEmpire(e?.csgoempireAccountId ?? empires[0]?.id ?? '');
    setPoly(e?.polymarketAccountId ?? polys[0]?.id ?? '');
    setPlan(e?.stakePlan ?? DEFAULT_STAKE_PLAN);
    setStrategy(e?.strategy.id ?? 'arb-taker');
    setRisk(e?.risk ?? DEFAULT_RISK);
  }, [value]);

  const missing = !name.trim() || !empire || !poly;
  const submit = async () => {
    setBusy(true);
    const r = await mutate(
      editing ? `trading/profiles/${encodeURIComponent(editing.id)}` : 'trading/profiles',
      {
        method: editing ? 'PUT' : 'POST',
        body: {
          name: name.trim(),
          enabled,
          mode: 'paper',
          csgoempireAccountId: empire,
          polymarketAccountId: poly,
          stakePlan: plan,
          strategy: { id: strategy, params: editing?.strategy.id === strategy ? editing.strategy.params : {} },
          risk,
        },
      },
      editing ? `Đã lưu ${name.trim()}` : `Đã thêm profile ${name.trim()}`,
    );
    setBusy(false);
    if (r !== null) onSaved();
  };

  const strat = STRATEGIES.find((s) => s.id === strategy);
  return (
    <Panel
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      width="lg"
      title={editing ? `Sửa ${editing.name}` : 'Thêm profile trader'}
      description="Lưu xong, task trader đang chạy của profile nhận cấu hình mới ngay (không cần khởi động lại)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={missing}>
            {editing ? 'Lưu' : 'Thêm profile'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Field label="Tên" htmlFor="pf-name">
          <Input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Tài khoản csgoempire" htmlFor="pf-empire">
            <Select id="pf-empire" value={empire} onChange={(e) => setEmpire(e.target.value)}>
              {empires.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {a.enabled ? '' : ' (tắt)'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ví Polymarket" htmlFor="pf-poly">
            <Select id="pf-poly" value={poly} onChange={(e) => setPoly(e.target.value)}>
              {polys.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {a.enabled ? '' : ' (tắt)'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Chiến lược" htmlFor="pf-strategy" help={strat?.help}>
          <Select id="pf-strategy" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            {STRATEGIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="h-px bg-line" />
        <StakePlanEditor value={plan} onChange={setPlan} />
        <div className="h-px bg-line" />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Lãi ròng tối thiểu (%)" htmlFor="pf-net" help="Sau phí taker và trượt giá thật của sổ lệnh.">
            <NumInput id="pf-net" value={+(risk.minNetMargin * 100).toFixed(4)} onValue={(v) => v !== undefined && v < 100 && setRisk({ ...risk, minNetMargin: v / 100 })} />
          </Field>
          <Field label="Tối đa / trận của profile ($)" htmlFor="pf-cap" help="0 = chỉ theo giới hạn chung.">
            <NumInput id="pf-cap" value={risk.matchCapUsd} onValue={(v) => v !== undefined && setRisk({ ...risk, matchCapUsd: v })} />
          </Field>
          <Field label="Bỏ kèo cũ hơn (giây)" htmlFor="pf-age" help="Tính từ lúc phát; 0 = không kiểm tra.">
            <NumInput id="pf-age" value={risk.maxSignalAgeMs / 1000} onValue={(v) => v !== undefined && setRisk({ ...risk, maxSignalAgeMs: Math.round(v * 1000) })} />
          </Field>
        </div>
        <Field label="Bật profile" htmlFor="pf-on" help="Tắt = task trader vẫn chạy nhưng bỏ qua mọi kèo (ghi lý do).">
          <Switch id="pf-on" checked={enabled} onCheckedChange={setEnabled} label="Bật profile" />
        </Field>
      </div>
    </Panel>
  );
}
