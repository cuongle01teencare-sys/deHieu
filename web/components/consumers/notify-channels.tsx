'use client';

import { useEffect, useState } from 'react';
import { BellRing, Layers, MoreHorizontal, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import type { NotifyChannelType, NotifyChannelView, SignalTier } from '@/lib/types';
import { fmtSince, fmtStamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useNow } from '@/hooks/use-now';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Field, Input, Select, Switch } from '../ui/controls';
import { Section } from '../ui/layout';
import { Menu, MenuItem, MenuSeparator } from '../ui/menu';
import { Confirm, Panel } from '../ui/panel';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Pill, StatusDot } from '../ui/status';
import { Hint } from '../ui/tooltip';

const TYPE_LABEL: Record<NotifyChannelType, string> = { discord: 'Discord', telegram: 'Telegram', slack: 'Slack' };

const pct = (m: number) => `${+(m * 100).toFixed(2)}%`;
export const tierRange = (t: SignalTier) => (t.maxMargin === null ? `≥ ${pct(t.minMargin)}` : `${pct(t.minMargin)} – ${pct(t.maxMargin)}`);

// ================================================================ kênh thông báo

export function NotifyChannels() {
  const channels = useApi<NotifyChannelView[]>('notify/channels', 10_000);
  const tiers = useApi<SignalTier[]>('notify/tiers');
  const manage = useGuard('consumers:manage');
  const mutate = useMutate();
  const now = useNow(5_000);
  const [editing, setEditing] = useState<NotifyChannelView | 'new' | null>(null);
  const [removing, setRemoving] = useState<NotifyChannelView | null>(null);
  const [busy, setBusy] = useState(false);
  const tierList = tiers.data ?? [];
  const tierName = (id: string) => tierList.find((t) => t.id === id);

  const test = async (c: NotifyChannelView) => {
    await mutate(`notify/channels/${encodeURIComponent(c.id)}/test`, { method: 'POST' }, `Đã gửi tin kiểm tra tới ${c.name}`);
    void channels.reload();
  };

  return (
    <Section
      title="Kênh thông báo"
      description="Discord webhook, Telegram bot, Slack webhook. Mỗi kênh nhận kèo mới và tin hủy kèo của các hạng đã chọn; không chọn hạng = nhận mọi kèo."
      actions={
        <Button variant="primary" size="sm" onClick={() => setEditing('new')} disabledReason={manage}>
          <Plus /> Thêm kênh
        </Button>
      }
    >
      {channels.error && !channels.data ? <ErrorState message={channels.error} onRetry={channels.reload} /> : null}
      {!channels.data && !channels.error ? <SkeletonRows rows={3} cols={[24, 12, 24, 16]} /> : null}
      {channels.data && !channels.data.length ? (
        <Empty
          icon={BellRing}
          action={
            <Button variant="primary" size="sm" onClick={() => setEditing('new')} disabledReason={manage}>
              Thêm kênh
            </Button>
          }
        >
          Chưa có kênh nào. Thêm Discord webhook, Telegram bot hoặc Slack webhook để nhận kèo.
        </Empty>
      ) : null}
      {channels.data?.length ? (
        <ul>
          {channels.data.map((c) => {
            const st = c.status;
            const failing = !!st.lastErrorAt && (!st.lastSentAt || st.lastErrorAt > st.lastSentAt);
            return (
              <li key={c.id} className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-line py-3 last:border-0">
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <StatusDot tone={!c.enabled ? 'muted' : failing ? 'critical' : 'ok'} label={!c.enabled ? 'Đang tắt' : failing ? 'Gửi lỗi' : 'Hoạt động'} />
                  <span className="min-w-0">
                    <span className={cn('block truncate text-body', c.enabled ? 'text-fg' : 'text-muted-fg')}>{c.name}</span>
                    <span className="num block truncate text-caption text-faint">
                      {TYPE_LABEL[c.type]} · {c.target}
                    </span>
                  </span>
                  {!c.enabled ? <Pill tone="muted">Tắt</Pill> : null}
                </span>
                <span className="flex w-full flex-wrap gap-1.5 md:w-56">
                  {c.tierIds.length ? (
                    c.tierIds.map((id) => {
                      const t = tierName(id);
                      return t ? (
                        <Hint key={id} content={tierRange(t)}>
                          <span>
                            <Pill tone="accent">{t.name}</Pill>
                          </span>
                        </Hint>
                      ) : null;
                    })
                  ) : (
                    <span className="text-caption text-muted-fg">Mọi kèo</span>
                  )}
                </span>
                <span className="w-40 text-caption text-muted-fg">
                  <span className="num text-fg">{st.sent}</span> đã gửi
                  {st.failed ? (
                    <>
                      {' · '}
                      <span className="num text-critical">{st.failed}</span> lỗi
                    </>
                  ) : null}
                  {st.queued ? <span className="num"> · {st.queued} chờ</span> : null}
                  <span className="block text-faint">
                    {failing && st.lastError ? (
                      <Hint content={st.lastError}>
                        <span className="cursor-default text-critical/85">lỗi {st.lastErrorAt ? fmtSince(st.lastErrorAt, now) : ''}</span>
                      </Hint>
                    ) : st.lastSentAt ? (
                      <Hint content={fmtStamp(st.lastSentAt)}>
                        <span className="cursor-default">gửi {fmtSince(st.lastSentAt, now)}</span>
                      </Hint>
                    ) : (
                      'chưa gửi tin nào'
                    )}
                  </span>
                </span>
                <span className="ml-auto md:ml-0">
                  <Menu
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Thao tác ${c.name}`}>
                        <MoreHorizontal />
                      </Button>
                    }
                  >
                    <MenuItem icon={<Send />} disabledReason={manage} onSelect={() => void test(c)}>
                      Gửi tin kiểm tra
                    </MenuItem>
                    <MenuItem icon={<Pencil />} disabledReason={manage} onSelect={() => setEditing(c)}>
                      Sửa
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} danger disabledReason={manage} onSelect={() => setRemoving(c)}>
                      Xóa
                    </MenuItem>
                  </Menu>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <ChannelForm
        value={editing}
        tiers={tierList}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void channels.reload();
        }}
      />
      <Confirm
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        tone="danger"
        title={`Xóa kênh ${removing?.name ?? ''}?`}
        description="Kênh sẽ không nhận kèo nữa. Cấu hình (webhook, bot token) bị xóa khỏi database."
        confirmLabel="Xóa kênh"
        loading={busy}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          const r = await mutate(`notify/channels/${encodeURIComponent(removing.id)}`, { method: 'DELETE' }, `Đã xóa ${removing.name}`);
          setBusy(false);
          if (r !== null) {
            setRemoving(null);
            void channels.reload();
          }
        }}
      />
    </Section>
  );
}

const TYPE_HELP: Record<NotifyChannelType, string> = {
  discord: 'Discord: Cài đặt kênh → Tích hợp → Webhook → Sao chép URL webhook.',
  telegram: 'Tạo bot bằng @BotFather để lấy token, thêm bot vào nhóm/kênh, rồi nhập id chat (vd -1001234567890 hoặc @ten_kenh).',
  slack: 'Slack: tạo app → Incoming Webhooks → thêm webhook cho kênh, sao chép URL.',
};

function ChannelForm({
  value,
  tiers,
  onClose,
  onSaved,
}: {
  value: NotifyChannelView | 'new' | null;
  tiers: SignalTier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const mutate = useMutate();
  const editing = value && value !== 'new' ? value : null;
  const [type, setType] = useState<NotifyChannelType>('discord');
  const [name, setName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [tierIds, setTierIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) return;
    const e = value === 'new' ? null : value;
    setType(e?.type ?? 'discord');
    setName(e?.name ?? '');
    setWebhookUrl('');
    setBotToken('');
    // chatId không phải bí mật: lấy lại từ "chat <id> · bot …"
    setChatId(e?.type === 'telegram' ? (/^chat (\S+)/.exec(e.target)?.[1] ?? '') : '');
    setEnabled(e?.enabled ?? true);
    setTierIds(e?.tierIds ?? []);
  }, [value]);

  // đổi loại kênh khi sửa → phải nhập lại bí mật
  const keepSecret = !!editing && editing.type === type;
  const missing = !name.trim() || (type === 'telegram' ? !chatId.trim() || (!keepSecret && !botToken.trim()) : !keepSecret && !webhookUrl.trim());

  const submit = async () => {
    const config =
      type === 'telegram'
        ? { type, chatId: chatId.trim(), ...(botToken.trim() ? { botToken: botToken.trim() } : {}) }
        : { type, ...(webhookUrl.trim() ? { webhookUrl: webhookUrl.trim() } : {}) };
    setBusy(true);
    const r = await mutate(
      editing ? `notify/channels/${encodeURIComponent(editing.id)}` : 'notify/channels',
      { method: editing ? 'PUT' : 'POST', body: { name: name.trim(), enabled, tierIds, config } },
      editing ? `Đã lưu ${name.trim()}` : `Đã thêm kênh ${name.trim()}`,
    );
    setBusy(false);
    if (r !== null) onSaved();
  };

  const secretHelp = keepSecret ? 'Bỏ trống để giữ giá trị đang lưu.' : undefined;
  return (
    <Panel
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={editing ? `Sửa ${editing.name}` : 'Thêm kênh thông báo'}
      description="Lưu vào database, tự nạp lại khi app khởi động."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={missing}>
            {editing ? 'Lưu' : 'Thêm kênh'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Field label="Loại kênh" htmlFor="ch-type" help={TYPE_HELP[type]}>
          <Select id="ch-type" value={type} onChange={(e) => setType(e.target.value as NotifyChannelType)}>
            <option value="discord">Discord webhook</option>
            <option value="telegram">Telegram bot</option>
            <option value="slack">Slack webhook</option>
          </Select>
        </Field>
        <Field label="Tên kênh" htmlFor="ch-name" help="Tên hiển thị trong trang này, vd “Discord VIP”.">
          <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        {type === 'telegram' ? (
          <>
            <Field label="Bot token" htmlFor="ch-token" help={secretHelp ?? 'Dạng 123456789:ABC-DEF…'}>
              <Input id="ch-token" type="password" autoComplete="off" className="num" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={keepSecret ? '•••••• (đang lưu)' : undefined} />
            </Field>
            <Field label="Chat id" htmlFor="ch-chat">
              <Input id="ch-chat" className="num" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" />
            </Field>
          </>
        ) : (
          <Field label="Webhook URL" htmlFor="ch-url" help={secretHelp}>
            <Input
              id="ch-url"
              type="password"
              autoComplete="off"
              className="num"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={keepSecret ? '•••••• (đang lưu)' : type === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://hooks.slack.com/services/…'}
            />
          </Field>
        )}
        <Field label="Hạng kèo nhận" help={tiers.length ? 'Không chọn hạng nào = nhận mọi kèo.' : 'Chưa có hạng kèo nào — kênh sẽ nhận mọi kèo. Thêm hạng ở tab “Hạng kèo”.'}>
          {tiers.length ? (
            <div className="flex flex-col gap-2">
              {tiers.map((t) => {
                const on = tierIds.includes(t.id);
                return (
                  <label key={t.id} className="flex cursor-pointer items-center gap-3 text-body">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
                      checked={on}
                      onChange={() => setTierIds(on ? tierIds.filter((x) => x !== t.id) : [...tierIds, t.id])}
                    />
                    <span className="text-fg">{t.name}</span>
                    <span className="num text-caption text-muted-fg">{tierRange(t)}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </Field>
        <Field label="Bật kênh" htmlFor="ch-on" help="Tắt = giữ cấu hình nhưng ngừng gửi.">
          <Switch id="ch-on" checked={enabled} onCheckedChange={setEnabled} label="Bật kênh" />
        </Field>
      </div>
    </Panel>
  );
}

// ================================================================ hạng kèo

export function SignalTiers() {
  const tiers = useApi<SignalTier[]>('notify/tiers');
  const manage = useGuard('consumers:manage');
  const mutate = useMutate();
  const [editing, setEditing] = useState<SignalTier | 'new' | null>(null);
  const [removing, setRemoving] = useState<SignalTier | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Section
      title="Hạng kèo"
      description="Tự đặt tên và khoảng lợi nhuận cho từng hạng (vd “VIP” ≥ 5%, “Super VIP” ≥ 10%). Kênh thông báo chọn hạng để nhận; một kèo có thể thuộc nhiều hạng."
      actions={
        <Button variant="primary" size="sm" onClick={() => setEditing('new')} disabledReason={manage}>
          <Plus /> Thêm hạng
        </Button>
      }
    >
      {tiers.error && !tiers.data ? <ErrorState message={tiers.error} onRetry={tiers.reload} /> : null}
      {!tiers.data && !tiers.error ? <SkeletonRows rows={3} cols={[30, 20]} /> : null}
      {tiers.data && !tiers.data.length ? (
        <Empty
          icon={Layers}
          action={
            <Button variant="primary" size="sm" onClick={() => setEditing('new')} disabledReason={manage}>
              Thêm hạng
            </Button>
          }
        >
          Chưa có hạng nào. Mọi kênh đang nhận mọi kèo.
        </Empty>
      ) : null}
      {tiers.data?.length ? (
        <ul>
          {tiers.data.map((t) => (
            <li key={t.id} className="flex min-h-12 items-center gap-6 border-b border-line py-2.5 last:border-0">
              <span className="min-w-0 flex-1 truncate text-body text-fg">{t.name}</span>
              <span className="num w-40 text-body text-muted-fg">{tierRange(t)}</span>
              <span className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" aria-label={`Sửa ${t.name}`} disabledReason={manage} onClick={() => setEditing(t)}>
                  <Pencil />
                </Button>
                <Button variant="danger-ghost" size="icon-sm" aria-label={`Xóa ${t.name}`} disabledReason={manage} onClick={() => setRemoving(t)}>
                  <Trash2 />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <TierForm
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void tiers.reload();
        }}
      />
      <Confirm
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        tone="danger"
        title={`Xóa hạng ${removing?.name ?? ''}?`}
        description="Hạng bị gỡ khỏi mọi kênh đang chọn nó. Kênh không còn hạng nào sẽ nhận mọi kèo."
        confirmLabel="Xóa hạng"
        loading={busy}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          const r = await mutate(`notify/tiers/${encodeURIComponent(removing.id)}`, { method: 'DELETE' }, `Đã xóa hạng ${removing.name}`);
          setBusy(false);
          if (r !== null) {
            setRemoving(null);
            void tiers.reload();
          }
        }}
      />
    </Section>
  );
}

function TierForm({ value, onClose, onSaved }: { value: SignalTier | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const mutate = useMutate();
  const editing = value && value !== 'new' ? value : null;
  const [name, setName] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) return;
    const e = value === 'new' ? null : value;
    setName(e?.name ?? '');
    setMin(e ? String(+(e.minMargin * 100).toFixed(4)) : '');
    setMax(e?.maxMargin != null ? String(+(e.maxMargin * 100).toFixed(4)) : '');
  }, [value]);

  const minN = Number(min);
  const maxN = max.trim() === '' ? null : Number(max);
  const error =
    min.trim() === '' || !Number.isFinite(minN) || minN < 0 || minN > 100
      ? 'Nhập mức tối thiểu từ 0 đến 100'
      : maxN !== null && (!Number.isFinite(maxN) || maxN <= minN)
        ? 'Mức tối đa phải lớn hơn mức tối thiểu'
        : null;

  const submit = async () => {
    setBusy(true);
    const r = await mutate(
      editing ? `notify/tiers/${encodeURIComponent(editing.id)}` : 'notify/tiers',
      { method: editing ? 'PUT' : 'POST', body: { name: name.trim(), minMargin: minN / 100, maxMargin: maxN === null ? null : maxN / 100 } },
      editing ? `Đã lưu hạng ${name.trim()}` : `Đã thêm hạng ${name.trim()}`,
    );
    setBusy(false);
    if (r !== null) onSaved();
  };

  return (
    <Panel
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={editing ? `Sửa hạng ${editing.name}` : 'Thêm hạng kèo'}
      description="Kèo có lợi nhuận từ mức tối thiểu đến dưới mức tối đa thuộc hạng này."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!name.trim() || !!error}>
            {editing ? 'Lưu' : 'Thêm hạng'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Field label="Tên hạng" htmlFor="tier-name" help="Tự đặt, vd VIP, Super VIP, Kim cương.">
          <Input id="tier-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Lợi nhuận tối thiểu (%)" htmlFor="tier-min" error={min.trim() !== '' ? error : null}>
          <Input id="tier-min" className="num" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="5" />
        </Field>
        <Field label="Lợi nhuận tối đa (%)" htmlFor="tier-max" help="Bỏ trống = không giới hạn. Vd 5–10% để hạng chỉ nhận kèo dưới 10%.">
          <Input id="tier-max" className="num" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="không giới hạn" />
        </Field>
      </div>
    </Panel>
  );
}
