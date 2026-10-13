'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MoreHorizontal, Play, Plus, Radio, Send, Square, Trash2, Server, Eye } from 'lucide-react';
import type { NodeView, TaskRecord } from '@/lib/types';
import { normalizeKinds } from '@/lib/task-kinds';
import { fmtAge, fmtStamp, fmtSince } from '@/lib/format';
import { sortTenants } from '@/lib/tenants';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useIsMobile } from '@/hooks/use-media';
import { useConsoleData } from '../console-data';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Field, Input, Segmented, Select, Switch } from '../ui/controls';
import { KV, PageHeader } from '../ui/layout';
import { Menu, MenuItem, MenuSeparator } from '../ui/menu';
import { Confirm, Panel } from '../ui/panel';
import { Empty, SkeletonRows } from '../ui/states';
import { DotLabel, Pill, TASK_STATE_TONE, toneText } from '../ui/status';
import { Table, TD, TH, THead, TR } from '../ui/table';
import { TenantDot } from '../ui/tenant';
import { AgeSince, LiveStamp } from '../ui/values';
import { JsonBlock, Mono } from '../ui/code';
import { Hint } from '../ui/tooltip';
import { DrawerSection } from '../room-drawer';

const STALE = 60_000;
const STATE_RANK: Record<string, number> = { FAILED: 0, RESTARTING: 1, STARTING: 2, INITIALIZING: 2, READY: 2, CREATED: 3, RUNNING: 4, STOPPING: 5, STOPPED: 6 };
const nodeOf = (t: TaskRecord) => (t.spec.runtime.type === 'remote' ? t.spec.runtime.nodeId : 'worker');

type Action = { type: 'stop' | 'delete' | 'restart' | 'command'; task: TaskRecord } | null;

export function PublisherPage() {
  const params = useSearchParams();
  const router = useRouter();
  const mobile = useIsMobile();
  const { snapshot, snapshotAt, reloadSnapshot } = useConsoleData();
  const [tab, setTab] = useState<'tasks' | 'nodes'>('tasks');
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const manage = useGuard('tasks:manage');
  const command = useGuard('tasks:command');
  const detailId = params.get('task');

  const tasks = useMemo(
    () => [...(snapshot?.tasks ?? [])].sort((a, b) => (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9) || a.spec.taskId.localeCompare(b.spec.taskId)),
    [snapshot],
  );
  const detail = tasks.find((t) => t.spec.taskId === detailId) ?? null;
  const openDetail = (id: string | null) => router.replace(id ? `/publisher?task=${encodeURIComponent(id)}` : '/publisher', { scroll: false });

  const menu = (t: TaskRecord) => {
    const stopped = ['STOPPED', 'FAILED'].includes(t.state);
    return (
      <Menu
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={`Thao tác cho ${t.spec.taskId}`} onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal />
          </Button>
        }
      >
        <MenuItem icon={<Eye />} onSelect={() => openDetail(t.spec.taskId)}>
          Xem chi tiết
        </MenuItem>
        <MenuItem icon={<Send />} disabledReason={command ?? (t.state !== 'RUNNING' ? 'Chỉ gửi lệnh cho task đang chạy' : null)} onSelect={() => setAction({ type: 'command', task: t })}>
          Gửi lệnh…
        </MenuItem>
        <MenuSeparator />
        {stopped ? (
          <>
            <MenuItem icon={<Play />} disabledReason={manage} onSelect={() => setAction({ type: 'restart', task: t })}>
              Chạy lại
            </MenuItem>
            <MenuItem icon={<Trash2 />} danger disabledReason={manage} onSelect={() => setAction({ type: 'delete', task: t })}>
              Xóa hồ sơ
            </MenuItem>
          </>
        ) : (
          <MenuItem icon={<Square />} danger disabledReason={manage} onSelect={() => setAction({ type: 'stop', task: t })}>
            Dừng
          </MenuItem>
        )}
      </Menu>
    );
  };

  return (
    <div>
      <PageHeader
        title="Publisher & Node"
        description="Task thu thập dữ liệu từ tenant. Descriptor chạy được nhiều task (vd mỗi môn một task), các kind khác chỉ một; quá 5 lần lỗi liên tiếp → FAILED. Task lưu bền tự chạy lại khi app khởi động."
        meta={<LiveStamp at={snapshotAt} />}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)} disabledReason={manage} className="hidden md:inline-flex">
            <Plus /> Tạo task
          </Button>
        }
      />

      <div className="mb-6">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'tasks', label: 'Publisher', count: tasks.length },
            { value: 'nodes', label: 'Node', count: snapshot?.nodes.length },
          ]}
        />
      </div>

      {!snapshot ? <SkeletonRows rows={6} cols={[18, 16, 10, 12, 8, 8, 28]} /> : null}

      {snapshot && tab === 'tasks' ? (
        tasks.length ? (
          mobile ? (
            <ul>
              {tasks.map((t) => (
                <li key={t.spec.taskId} onClick={() => openDetail(t.spec.taskId)} className={cn('flex min-h-16 cursor-pointer items-center gap-3 border-b border-line py-3', detailId === t.spec.taskId && '-mx-4 bg-accent-soft px-4')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="num truncate text-body text-fg">{t.spec.taskId}</span>
                      {t.spec.persist ? <Pill tone="info">Lưu bền</Pill> : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-fg">
                      <TenantDot tenant={t.spec.tenant} />
                      <span className="num truncate">{t.spec.kind}</span>
                      <span className="text-faint">· {nodeOf(t)}</span>
                    </div>
                    {t.lastError ? <div className="mt-1 truncate text-caption text-critical/80">{t.lastError}</div> : null}
                  </div>
                  <div className="text-right">
                    <div className={cn('num text-caption', toneText(TASK_STATE_TONE[t.state]))}>{t.state}</div>
                    <AgeSince at={t.lastDataAt} staleAfter={STALE} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Task</TH>
                  <TH>Kind</TH>
                  <TH>Node</TH>
                  <TH>Trạng thái</TH>
                  <TH numeric>Restart</TH>
                  <TH numeric>Dữ liệu cuối</TH>
                  <TH className="w-[30%]">Lỗi gần nhất</TH>
                  <TH className="w-10" />
                </tr>
              </THead>
              <tbody>
                {tasks.map((t) => (
                  <Fragment key={t.spec.taskId}>
                    <TR interactive highlight={detailId === t.spec.taskId} onClick={() => openDetail(t.spec.taskId)}>
                      <TD className="num text-fg">
                        <span className="flex items-center gap-2">
                          {t.spec.taskId}
                          {t.spec.persist ? (
                            <Hint content="Lưu bền: tự chạy lại khi app khởi động (trừ khi đã bị dừng)">
                              <span>
                                <Pill tone="info">Lưu bền</Pill>
                              </span>
                            </Hint>
                          ) : null}
                        </span>
                      </TD>
                      <TD>
                        <span className="flex items-center gap-1.5">
                          <TenantDot tenant={t.spec.tenant} />
                          <span className="num text-caption text-muted-fg">{t.spec.kind}</span>
                        </span>
                      </TD>
                      <TD className="num text-caption text-muted-fg">{nodeOf(t)}</TD>
                      <TD>
                        <Pill tone={TASK_STATE_TONE[t.state]} mono>
                          {t.state}
                        </Pill>
                      </TD>
                      <TD numeric className={cn(t.consecutiveFailures ? 'text-warn' : 'text-muted-fg')}>
                        {t.totalRestarts}
                        {t.consecutiveFailures ? <span className="text-caption"> · {t.consecutiveFailures} liên tiếp</span> : null}
                      </TD>
                      <TD numeric>
                        {t.state === 'STOPPED' ? <span className="text-caption text-faint">—</span> : <AgeSince at={t.lastDataAt} staleAfter={STALE} />}
                      </TD>
                      <TD className="max-w-0">
                        {t.lastError ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpanded(expanded === t.spec.taskId ? null : t.spec.taskId);
                            }}
                            className="block w-full truncate text-left text-caption text-critical/85 hover:text-critical"
                            title="Bấm để xem đầy đủ"
                          >
                            {t.lastError}
                          </button>
                        ) : (
                          <span className="text-caption text-faint">—</span>
                        )}
                      </TD>
                      <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                        {menu(t)}
                      </TD>
                    </TR>
                    {expanded === t.spec.taskId && t.lastError ? (
                      <tr className="animate-fade-in">
                        <td colSpan={8} className="border-b border-line pb-4 pt-1">
                          <code className="num block whitespace-pre-wrap break-all rounded-[6px] bg-critical-soft px-3 py-2.5 text-[12px] text-critical">{t.lastError}</code>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          )
        ) : (
          <Empty icon={Radio} action={<Button variant="primary" size="sm" disabledReason={manage} onClick={() => setCreating(true)}>Tạo task</Button>}>
            Chưa có publisher nào. Tạo task đầu tiên để bắt đầu thu dữ liệu.
          </Empty>
        )
      ) : null}

      {snapshot && tab === 'nodes' ? <NodesTable nodes={snapshot.nodes} tasks={tasks} /> : null}

      <TaskDetail task={detail} onClose={() => openDetail(null)} onAction={setAction} manage={manage} command={command} />
      <CreateTask open={creating} onOpenChange={setCreating} nodes={snapshot?.nodes ?? []} onCreated={reloadSnapshot} />
      <ActionDialogs action={action} onClose={() => setAction(null)} onDone={reloadSnapshot} />
    </div>
  );
}

function NodesTable({ nodes, tasks }: { nodes: NodeView[]; tasks: TaskRecord[] }) {
  const now = useNow(5_000);
  if (!nodes.length) return <Empty icon={Server}>Chưa có node nào kết nối. Task chạy trong worker của app.</Empty>;
  return (
    <ul>
      {nodes.map((n) => {
        const on = tasks.filter((t) => nodeOf(t) === n.nodeId && t.state !== 'STOPPED');
        return (
          <li key={n.nodeId} className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-1 border-b border-line py-3">
            <DotLabel tone={n.connected ? 'ok' : 'critical'} className="w-40">
              <span className="num text-fg">{n.nodeId}</span>
            </DotLabel>
            <span className={cn('w-56 text-caption', n.connected ? 'text-muted-fg' : 'text-critical')}>
              {n.connected ? `Kết nối ${n.connectedAt ? fmtSince(n.connectedAt, now) : ''}` : `Mất kết nối ${n.disconnectedAt ? fmtSince(n.disconnectedAt, now) : ''}`}
            </span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
              {on.length ? (
                on.map((t) => (
                  <DotLabel key={t.spec.taskId} tone={TASK_STATE_TONE[t.state]} className="text-caption">
                    <span className="num text-muted-fg">{t.spec.taskId}</span>
                  </DotLabel>
                ))
              ) : (
                <span className="text-caption text-faint">không có task</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TaskDetail({
  task,
  onClose,
  onAction,
  manage,
  command,
}: {
  task: TaskRecord | null;
  onClose: () => void;
  onAction: (a: Action) => void;
  manage: string | null;
  command: string | null;
}) {
  const now = useNow(1_000);
  const stopped = task && ['STOPPED', 'FAILED'].includes(task.state);
  return (
    <Panel
      open={!!task}
      onOpenChange={(v) => !v && onClose()}
      eyebrow="Publisher"
      title={task ? <span className="num">{task.spec.taskId}</span> : ''}
      description={task ? <Pill tone={TASK_STATE_TONE[task.state]} mono>{task.state}</Pill> : null}
      footer={
        task ? (
          <>
            <Button variant="ghost" disabledReason={command ?? (task.state !== 'RUNNING' ? 'Chỉ gửi lệnh cho task đang chạy' : null)} onClick={() => onAction({ type: 'command', task })}>
              <Send /> Gửi lệnh
            </Button>
            {stopped ? (
              <Button variant="primary" disabledReason={manage} onClick={() => onAction({ type: 'restart', task })}>
                <Play /> Chạy lại
              </Button>
            ) : (
              <Button variant="danger" disabledReason={manage} onClick={() => onAction({ type: 'stop', task })}>
                <Square /> Dừng
              </Button>
            )}
          </>
        ) : null
      }
    >
      {task ? (
        <div>
          {task.lastError ? (
            <div className="mb-6 rounded-[6px] bg-critical-soft px-3 py-2.5">
              <div className="mb-1 text-caption text-critical">Lỗi gần nhất · {task.consecutiveFailures} lần liên tiếp</div>
              <code className="num block whitespace-pre-wrap break-all text-[12px] text-critical/90">{task.lastError}</code>
            </div>
          ) : null}
          <DrawerSection title="Trạng thái">
            <KV
              items={[
                ['Kind', <span key="k" className="num">{task.spec.kind}</span>],
                ['Tenant', <span key="t" className="num">{task.spec.tenant}</span>],
                ['Chạy trên', <span key="n" className="num">{nodeOf(task)}</span>],
                ['Lưu bền', task.spec.persist ? (stopped ? 'Có · đã dừng, không tự chạy khi khởi động' : 'Có · tự chạy lại khi app khởi động') : 'Không'],
                ['Heartbeat', task.lastHeartbeatAt ? <span key="h" className="num">{fmtAge(now - task.lastHeartbeatAt)} trước</span> : '—'],
                ['Dữ liệu cuối', task.lastDataAt ? <span key="d" className="num">{fmtAge(now - task.lastDataAt)} trước</span> : '—'],
                ['Seq', <span key="s" className="num">{task.lastSeq ?? '—'}</span>],
                ['Restart', <span key="r" className="num">{task.totalRestarts} tổng · {task.consecutiveFailures} liên tiếp</span>],
                ['Cập nhật', <span key="u" className="num">{fmtStamp(task.updatedAt)}</span>],
              ]}
            />
          </DrawerSection>
          <DrawerSection title="Tham số">
            {Object.keys(task.spec.params).length ? (
              <KV items={Object.entries(task.spec.params).map(([k, v]) => [<span key={k} className="num">{k}</span>, <Mono key={`${k}v`}>{typeof v === 'string' ? v : JSON.stringify(v)}</Mono>])} />
            ) : (
              <p className="text-body text-muted-fg">Không có tham số.</p>
            )}
          </DrawerSection>
          <JsonBlock value={task} />
        </div>
      ) : null}
    </Panel>
  );
}

/** Form tạo task sinh từ danh mục kind (GET /tasks/kinds). */
function CreateTask({ open, onOpenChange, nodes, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; nodes: NodeView[]; onCreated: () => void }) {
  const { data: rawKinds, error: kindsError } = useApi<unknown>(open ? 'tasks/kinds' : null);
  const kinds = useMemo(() => (rawKinds ? normalizeKinds(rawKinds) : null), [rawKinds]);
  const mutate = useMutate();
  const [kind, setKind] = useState('');
  const [taskId, setTaskId] = useState('');
  const [runtime, setRuntime] = useState('worker');
  const [persist, setPersist] = useState(true);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const info = kinds?.find((k) => k.kind === kind);

  useEffect(() => {
    if (!info) return;
    setTaskId(info.kind.replace('.', '-'));
    setPersist(true);
    setValues(Object.fromEntries(info.params.map((p) => [p.name, p.type === 'boolean' ? Boolean(p.default) : p.default === undefined ? '' : p.type === 'number[]' && Array.isArray(p.default) ? p.default.join(', ') : typeof p.default === 'object' ? JSON.stringify(p.default) : String(p.default)])));
  }, [info]);
  useEffect(() => {
    if (open && kinds?.length && !kind) setKind(kinds[0]!.kind);
  }, [open, kinds, kind]);

  const missing = info?.params.filter((p) => p.required && (values[p.name] === '' || values[p.name] === undefined)) ?? [];
  const submit = async () => {
    if (!info) return;
    const params: Record<string, unknown> = {};
    for (const p of info.params) {
      const v = values[p.name];
      if (v === '' || v === undefined) continue;
      if (p.type === 'number') params[p.name] = Number(v);
      else if (p.type === 'number[]') params[p.name] = String(v).split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x));
      else if (p.type === 'json') {
        try {
          params[p.name] = JSON.parse(String(v));
        } catch {
          params[p.name] = v;
        }
      } else params[p.name] = v;
    }
    setBusy(true);
    const r = await mutate('tasks', { method: 'POST', body: { taskId, kind, persist, runtime: runtime === 'worker' ? { type: 'worker' } : { type: 'remote', nodeId: runtime }, params } }, `Đã tạo task ${taskId}`);
    setBusy(false);
    if (r) {
      onOpenChange(false);
      setKind('');
      onCreated();
    }
  };

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title="Tạo task"
      description="Tham số sinh theo kind đã chọn. Tenant được suy từ kind."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!info || !taskId || missing.length > 0}>
            Tạo và chạy
          </Button>
        </>
      }
    >
      {kindsError && !kinds ? (
        <p className="text-body text-critical">Không tải được danh mục kind: {kindsError}</p>
      ) : !kinds ? (
        <SkeletonRows rows={4} cols={[60]} />
      ) : !kinds.length ? (
        <p className="text-body text-muted-fg">Backend chưa khai báo kind nào.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <Field label="Kind" htmlFor="kind" help={info ? `Tenant ${info.tenant}${info.concept ? ` · ${info.concept}` : ''}` : undefined}>
            <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {sortTenants(kinds.map((k) => k.tenant)).map((t) => (
                <optgroup key={t} label={t}>
                  {kinds.filter((k) => k.tenant === t).map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.kind}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          {info?.multiInstance ? <p className="-mt-3 text-caption text-muted-fg">Kind này chạy được nhiều task song song, vd mỗi môn một task với tagIds riêng.</p> : null}
          <Field label="taskId" htmlFor="taskId" help="Duy nhất. Dùng trong log, sự cố và thông báo.">
            <Input id="taskId" value={taskId} onChange={(e) => setTaskId(e.target.value)} className="num" />
          </Field>
          <Field label="Chạy trên" htmlFor="rt">
            <Select id="rt" value={runtime} onChange={(e) => setRuntime(e.target.value)}>
              <option value="worker">worker (trong app)</option>
              {nodes.map((n) => (
                <option key={n.nodeId} value={n.nodeId} disabled={!n.connected}>
                  {n.nodeId}
                  {n.connected ? '' : ' — mất kết nối'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lưu bền" htmlFor="persist" help="Bật: lưu vào database, lần khởi động app sau tự chạy lại. Xóa task sẽ xóa luôn bản lưu.">
            <Switch id="persist" checked={persist} onCheckedChange={setPersist} label="Lưu bền" />
          </Field>
          {info?.params.length ? <div className="h-px bg-line" /> : null}
          {info?.params.map((p) => (
            <Field
              key={p.name}
              htmlFor={`p-${p.name}`}
              label={
                <span className="num">
                  {p.name}
                  {p.required ? <span className="text-critical"> *</span> : <span className="font-normal text-faint"> tùy chọn</span>}
                </span>
              }
              help={p.hint ?? (p.default !== undefined ? `Mặc định ${JSON.stringify(p.default)}` : undefined)}
            >
              {p.type === 'boolean' ? (
                <Switch id={`p-${p.name}`} checked={Boolean(values[p.name])} onCheckedChange={(v) => setValues({ ...values, [p.name]: v })} label={p.name} />
              ) : (
                <Input
                  id={`p-${p.name}`}
                  className="num"
                  inputMode={p.type === 'number' ? 'numeric' : undefined}
                  value={String(values[p.name] ?? '')}
                  onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ActionDialogs({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const mutate = useMutate();
  const [busy, setBusy] = useState(false);
  const [cmd, setCmd] = useState({ name: '', data: '' });
  const t = action?.task;
  const id = t ? encodeURIComponent(t.spec.taskId) : '';
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r !== null) {
      onClose();
      onDone();
    }
  };
  return (
    <>
      <Confirm
        open={action?.type === 'stop'}
        onOpenChange={(v) => !v && onClose()}
        tone="danger"
        title={`Dừng ${t?.spec.taskId ?? ''}?`}
        description={`Odds do task này cung cấp sẽ bị gỡ và mọi kèo liên quan bị hủy (publisher_stopped).${t?.spec.persist ? ' Task lưu bền vẫn được giữ nhưng sẽ không tự chạy khi app khởi động lại.' : ''}`}
        confirmLabel="Dừng task"
        loading={busy}
        onConfirm={() => run(() => mutate(`tasks/${id}/stop`, { method: 'POST' }, `Đã dừng ${t?.spec.taskId}`))}
      />
      <Confirm
        open={action?.type === 'delete'}
        onOpenChange={(v) => !v && onClose()}
        tone="danger"
        title={`Xóa hồ sơ ${t?.spec.taskId ?? ''}?`}
        description={`Chỉ xóa hồ sơ task đã dừng. Không ảnh hưởng dữ liệu đã thu.${t?.spec.persist ? ' Bản lưu bền trong database cũng bị xóa.' : ''}`}
        confirmLabel="Xóa"
        loading={busy}
        onConfirm={() => run(() => mutate(`tasks/${id}`, { method: 'DELETE' }, `Đã xóa ${t?.spec.taskId}`))}
      />
      <Confirm
        open={action?.type === 'restart'}
        onOpenChange={(v) => !v && onClose()}
        title={`Chạy lại ${t?.spec.taskId ?? ''}?`}
        description={t?.spec.persist ? 'Chạy lại với cùng kind, node và tham số. Task lưu bền sẽ tự chạy lại ở lần khởi động app sau.' : 'Chạy lại với cùng kind, node và tham số.'}
        confirmLabel="Chạy lại"
        loading={busy}
        onConfirm={() => run(() => mutate(`tasks/${id}/start`, { method: 'POST' }, `Đã chạy lại ${t?.spec.taskId}`))}
      />
      <Panel
        open={action?.type === 'command'}
        onOpenChange={(v) => !v && onClose()}
        eyebrow={<span className="num">{t?.spec.taskId}</span>}
        title="Gửi lệnh"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!cmd.name}
              onClick={() =>
                run(() => {
                  let data: unknown = cmd.data;
                  try {
                    data = cmd.data ? JSON.parse(cmd.data) : undefined;
                  } catch {
                    /* gửi dạng chuỗi */
                  }
                  return mutate(`tasks/${id}/commands`, { method: 'POST', body: { name: cmd.name, data } }, 'Đã gửi lệnh');
                })
              }
            >
              Gửi
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <Field label="Tên lệnh" htmlFor="cmd" help="Ví dụ: subscribe, resubscribe">
            <Input id="cmd" className="num" value={cmd.name} onChange={(e) => setCmd({ ...cmd, name: e.target.value })} />
          </Field>
          <Field label="Dữ liệu (JSON)" htmlFor="cmd-data" help="Tùy chọn">
            <textarea
              id="cmd-data"
              value={cmd.data}
              onChange={(e) => setCmd({ ...cmd, data: e.target.value })}
              rows={6}
              className="num w-full rounded-[6px] bg-transparent p-2.5 text-[12px] text-fg shadow-[inset_0_0_0_1px_var(--line-strong)] outline-none focus:shadow-[inset_0_0_0_1px_var(--accent)]"
            />
          </Field>
        </div>
      </Panel>
    </>
  );
}

