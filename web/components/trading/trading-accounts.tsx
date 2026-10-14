'use client';

import { useEffect, useState } from 'react';
import { KeyRound, MoreHorizontal, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import type { TradingAccountView, TradingVenue } from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/use-api';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Field, Input, Select, Switch } from '../ui/controls';
import { Section } from '../ui/layout';
import { Menu, MenuItem, MenuSeparator } from '../ui/menu';
import { Confirm, Panel } from '../ui/panel';
import { Empty, ErrorState, SkeletonRows } from '../ui/states';
import { Pill, StatusDot } from '../ui/status';
import { Hint } from '../ui/tooltip';

export const VENUE_LABEL: Record<TradingVenue, string> = { csgoempire: 'csgoempire', polymarket: 'Polymarket' };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const targetOf = (a: TradingAccountView) =>
  a.config.venue === 'csgoempire'
    ? `hồ sơ trình duyệt ${a.config.browserProfile}`
    : `ví ${short(a.config.walletAddress)}${a.config.funderAddress ? ` · funder ${short(a.config.funderAddress)}` : ''}`;

/** Tài khoản giao dịch: nhiều tài khoản mỗi nền tảng. */
export function TradingAccounts({ secretKeyConfigured }: { secretKeyConfigured: boolean | null }) {
  const accounts = useApi<TradingAccountView[]>('trading/accounts', 15_000);
  const manage = useGuard('trading:manage');
  const mutate = useMutate();
  const [editing, setEditing] = useState<TradingAccountView | TradingVenue | null>(null);
  const [removing, setRemoving] = useState<TradingAccountView | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (
    <span className="flex gap-2">
      <Button variant="secondary" size="sm" onClick={() => setEditing('csgoempire')} disabledReason={manage}>
        <Plus /> csgoempire
      </Button>
      <Button variant="primary" size="sm" onClick={() => setEditing('polymarket')} disabledReason={manage}>
        <Plus /> Ví Polymarket
      </Button>
    </span>
  );

  return (
    <Section
      title="Tài khoản"
      description="Mỗi nền tảng có thể có nhiều tài khoản. csgoempire không lưu mật khẩu — phiên đăng nhập nằm trong hồ sơ trình duyệt riêng của tài khoản. Private key ví Polymarket được mã hóa bằng TRADING_SECRET_KEY và không bao giờ hiển thị lại."
      actions={add}
    >
      {accounts.error && !accounts.data ? <ErrorState message={accounts.error} onRetry={accounts.reload} /> : null}
      {!accounts.data && !accounts.error ? <SkeletonRows rows={3} cols={[30, 20, 20]} /> : null}
      {accounts.data && !accounts.data.length ? (
        <Empty icon={Wallet} action={add}>
          Chưa có tài khoản. Một trader cần 1 tài khoản csgoempire + 1 ví Polymarket.
        </Empty>
      ) : null}
      {accounts.data?.length ? (
        <ul>
          {accounts.data.map((a) => (
            <li key={a.id} className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-1.5 border-b border-line py-3 last:border-0">
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <StatusDot tone={a.enabled ? 'ok' : 'muted'} label={a.enabled ? 'Đang bật' : 'Đang tắt'} />
                <span className="min-w-0">
                  <span className={cn('block truncate text-body', a.enabled ? 'text-fg' : 'text-muted-fg')}>{a.label}</span>
                  <span className="num block truncate text-caption text-faint">
                    {VENUE_LABEL[a.venue]} · {targetOf(a)}
                  </span>
                </span>
                {!a.enabled ? <Pill tone="muted">Tắt</Pill> : null}
              </span>
              <span className="flex w-full flex-wrap items-center gap-1.5 md:w-64">
                {a.venue === 'polymarket' ? (
                  a.hasSecret ? (
                    <Pill tone="ok">
                      <KeyRound className="size-3" /> Đã lưu key
                    </Pill>
                  ) : (
                    <Hint content="Chế độ giấy không cần key; giao dịch thật sẽ cần.">
                      <span>
                        <Pill tone="warn">Chưa có key</Pill>
                      </span>
                    </Hint>
                  )
                ) : null}
                {a.usedBy.length ? (
                  <span className="truncate text-caption text-muted-fg">dùng ở {a.usedBy.join(', ')}</span>
                ) : (
                  <span className="text-caption text-faint">chưa dùng</span>
                )}
              </span>
              <span className="ml-auto md:ml-0">
                <Menu
                  trigger={
                    <Button variant="ghost" size="icon-sm" aria-label={`Thao tác ${a.label}`}>
                      <MoreHorizontal />
                    </Button>
                  }
                >
                  <MenuItem icon={<Pencil />} disabledReason={manage} onSelect={() => setEditing(a)}>
                    Sửa
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    icon={<Trash2 />}
                    danger
                    disabledReason={manage ?? (a.usedBy.length ? 'Đang dùng trong profile' : null)}
                    onSelect={() => setRemoving(a)}
                  >
                    Xóa
                  </MenuItem>
                </Menu>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <AccountForm
        value={editing}
        secretKeyConfigured={secretKeyConfigured}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void accounts.reload();
        }}
      />
      <Confirm
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        tone="danger"
        title={`Xóa tài khoản ${removing?.label ?? ''}?`}
        description="Cấu hình và private key đã mã hóa bị xóa khỏi database."
        confirmLabel="Xóa tài khoản"
        loading={busy}
        onConfirm={async () => {
          if (!removing) return;
          setBusy(true);
          const r = await mutate(`trading/accounts/${encodeURIComponent(removing.id)}`, { method: 'DELETE' }, `Đã xóa ${removing.label}`);
          setBusy(false);
          if (r !== null) {
            setRemoving(null);
            void accounts.reload();
          }
        }}
      />
    </Section>
  );
}

function AccountForm({
  value,
  secretKeyConfigured,
  onClose,
  onSaved,
}: {
  value: TradingAccountView | TradingVenue | null;
  secretKeyConfigured: boolean | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const mutate = useMutate();
  const editing = value && typeof value === 'object' ? value : null;
  const [venue, setVenue] = useState<TradingVenue>('polymarket');
  const [label, setLabel] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [browserProfile, setBrowserProfile] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [funderAddress, setFunderAddress] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!value) return;
    const e = typeof value === 'object' ? value : null;
    setVenue(e?.venue ?? (value as TradingVenue));
    setLabel(e?.label ?? '');
    setEnabled(e?.enabled ?? true);
    setBrowserProfile(e?.config.venue === 'csgoempire' ? e.config.browserProfile : '');
    setWalletAddress(e?.config.venue === 'polymarket' ? e.config.walletAddress : '');
    setFunderAddress(e?.config.venue === 'polymarket' ? (e.config.funderAddress ?? '') : '');
    setPrivateKey('');
  }, [value]);

  const evm = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
  const keyOk = venue !== 'polymarket' || !privateKey.trim() || /^(0x)?[0-9a-fA-F]{64}$/.test(privateKey.trim());
  const missing =
    !label.trim() ||
    (venue === 'csgoempire'
      ? !/^[\w.-]{1,64}$/.test(browserProfile.trim())
      : !evm(walletAddress) || (!!funderAddress.trim() && !evm(funderAddress)) || !keyOk);

  const submit = async () => {
    const config =
      venue === 'csgoempire'
        ? { venue, browserProfile: browserProfile.trim() }
        : { venue, walletAddress: walletAddress.trim(), funderAddress: funderAddress.trim() || null };
    setBusy(true);
    const r = await mutate(
      editing ? `trading/accounts/${encodeURIComponent(editing.id)}` : 'trading/accounts',
      {
        method: editing ? 'PUT' : 'POST',
        // key chỉ dành cho ví polymarket (đổi nền tảng sau khi gõ key → không gửi)
        body: { label: label.trim(), enabled, config, ...(venue === 'polymarket' && privateKey.trim() ? { privateKey: privateKey.trim() } : {}) },
      },
      editing ? `Đã lưu ${label.trim()}` : `Đã thêm ${label.trim()}`,
    );
    setBusy(false);
    if (r !== null) {
      setPrivateKey('');
      onSaved();
    }
  };

  return (
    <Panel
      open={!!value}
      onOpenChange={(v) => !v && onClose()}
      title={editing ? `Sửa ${editing.label}` : venue === 'polymarket' ? 'Thêm ví Polymarket' : 'Thêm tài khoản csgoempire'}
      description="Lưu vào database. Profile đang dùng tài khoản nhận cấu hình mới ngay."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={missing}>
            {editing ? 'Lưu' : 'Thêm tài khoản'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {!editing ? (
          <Field label="Nền tảng" htmlFor="ac-venue">
            <Select
              id="ac-venue"
              value={venue}
              onChange={(e) => {
                setVenue(e.target.value as TradingVenue);
                setPrivateKey('');
              }}
            >
              <option value="csgoempire">csgoempire (odds sptpub)</option>
              <option value="polymarket">Polymarket</option>
            </Select>
          </Field>
        ) : null}
        <Field label="Tên" htmlFor="ac-label" help="Tên hiển thị, không trùng trong cùng nền tảng, vd “Empire #1”.">
          <Input id="ac-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        </Field>
        {venue === 'csgoempire' ? (
          <Field
            label="Hồ sơ trình duyệt"
            htmlFor="ac-profile"
            help="Tên thư mục hồ sơ (chữ, số, . _ -) giữ phiên đăng nhập của tài khoản này. Không lưu mật khẩu; tác tử phiên sẽ dùng hồ sơ này để làm mới JWT."
          >
            <Input id="ac-profile" className="num" value={browserProfile} onChange={(e) => setBrowserProfile(e.target.value)} placeholder="empire-1" maxLength={64} />
          </Field>
        ) : (
          <>
            <Field label="Địa chỉ ví" htmlFor="ac-wallet" help="0x + 40 ký tự hex.">
              <Input id="ac-wallet" className="num" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="0x…" />
            </Field>
            <Field label="Ví funder (tùy chọn)" htmlFor="ac-funder" help="Ví proxy Polymarket nếu tài khoản đăng nhập bằng email/ví Polymarket; trống = trả bằng chính ví trên.">
              <Input id="ac-funder" className="num" value={funderAddress} onChange={(e) => setFunderAddress(e.target.value)} placeholder="0x…" />
            </Field>
            <Field
              label="Private key"
              htmlFor="ac-key"
              error={!keyOk ? '64 ký tự hex (có hoặc không 0x).' : secretKeyConfigured === false && privateKey.trim() ? 'Backend chưa đặt TRADING_SECRET_KEY nên sẽ từ chối lưu key.' : undefined}
              help={
                editing?.hasSecret
                  ? 'Đang có key đã mã hóa. Bỏ trống để giữ; nhập key mới để thay.'
                  : 'Mã hóa AES-256-GCM bằng khóa chủ TRADING_SECRET_KEY trước khi lưu, không bao giờ được trả lại. Chế độ giấy chưa cần key.'
              }
            >
              <Input
                id="ac-key"
                type="password"
                autoComplete="off"
                className="num"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={editing?.hasSecret ? '•••••• (đang lưu)' : undefined}
              />
            </Field>
          </>
        )}
        <Field label="Bật tài khoản" htmlFor="ac-on" help="Tắt = profile dùng tài khoản này đứng yên (ghi lý do vào lệnh).">
          <Switch id="ac-on" checked={enabled} onCheckedChange={setEnabled} label="Bật tài khoản" />
        </Field>
      </div>
    </Panel>
  );
}
