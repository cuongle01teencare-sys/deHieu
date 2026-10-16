'use client';

import {
  useCallback,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtStamp } from '@/lib/format';
import type {
  TradingAccountCheck,
  TradingVenue,
  VenueAccountIdentity,
} from '@/lib/trading-types';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { Pill } from '../ui/status';

type Entry =
  | { state: 'loading' }
  | { state: 'ok'; data: TradingAccountCheck }
  | { state: 'error'; error: string; at: number };

/** Kết quả kiểm tra dùng chung giữa tab Tài khoản và Profile (theo accountId). */
const store = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const useStoreVersion = () =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );

const ERROR_LABEL: Record<string, string> = {
  CSGOEMPIRE_SESSION_EXPIRED: 'Phiên csgoempire hết hạn — bấm Đăng nhập lại',
  CSGOEMPIRE_LOGIN_ACCOUNT_MISMATCH:
    'Trình duyệt đang đăng nhập TÀI KHOẢN KHÁC với email đã lưu',
  CSGOEMPIRE_LOGIN_IN_PROGRESS: 'Đang đăng nhập, thử lại sau',
  CSGOEMPIRE_LOGIN_CREDENTIALS_INVALID: 'Thông tin đăng nhập đã lưu bị hỏng',
  CSGOEMPIRE_BALANCE_TYPE_UNSUPPORTED: 'Tài khoản không dùng số dư coin',
  CSGOEMPIRE_BROWSER_UNAVAILABLE: 'Không mở được Chromium của hồ sơ',
  POLYMARKET_WALLET_MISMATCH: 'Private key KHÔNG ra đúng địa chỉ ví đã lưu',
  POLYMARKET_KEY_MISSING: 'Chưa lưu private key',
  TRADING_SECRET_KEY_REQUIRED: 'Backend chưa đặt TRADING_SECRET_KEY',
  LIVE_REDIS_REQUIRED: 'Backend chưa có Redis',
  CASH_UNAVAILABLE: 'Sàn không trả số dư',
  CSGOEMPIRE_CLOUDFLARE_BLOCKED:
    'Cloudflare của csgoempire chặn yêu cầu đọc số dư (trang chống bot)',
  VENUE_NOT_JSON: 'Sàn trả trang web thay vì dữ liệu',
  CSGOEMPIRE_SESSION_ACCOUNT_FAILED:
    'Không đọc được tài khoản trên csgoempire — bấm Đăng nhập để xem lý do chi tiết',
  CSGOEMPIRE_BROWSER_SLOTS_BUSY: 'Đang có quá nhiều Chromium mở, thử lại sau',
  ACCOUNT_BUSY: 'Tài khoản đang bận vào lệnh, thử lại sau',
};
/** Nhãn dễ đọc + phần chi tiết sau dấu ":" (vd mã HTTP), không chỉ mã lỗi trơn. */
const errorText = (code: string) => {
  const head = code.split(':')[0]!.trim();
  const rest = code.slice(head.length + 1).trim();
  const label = ERROR_LABEL[head];
  return label ? `${label}${rest ? ` (${rest})` : ''}` : code;
};

export async function checkAccount(accountId: string) {
  store.set(accountId, { state: 'loading' });
  emit();
  try {
    const data = await api<TradingAccountCheck>(
      `trading/accounts/${encodeURIComponent(accountId)}/check`,
      { method: 'POST' },
    );
    store.set(accountId, { state: 'ok', data });
  } catch (e) {
    store.set(accountId, {
      state: 'error',
      error: e instanceof Error ? e.message : String(e),
      at: Date.now(),
    });
  }
  emit();
}

export const shortAddr = (a: string | null | undefined) =>
  !a ? '—' : a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
const usd = (n: number) => `${n.toFixed(2)}$`;

/** Tên tài khoản thật trên sàn, dạng ngắn. */
export function identityText(
  venue: string,
  a: Pick<VenueAccountIdentity, 'id' | 'name' | 'wallet'>,
): string {
  if (venue === 'polymarket')
    return a.wallet && a.id && a.wallet.toLowerCase() !== a.id.toLowerCase()
      ? `ví ${shortAddr(a.wallet)} (ký bằng ${shortAddr(a.id)})`
      : `ví ${shortAddr(a.wallet ?? a.id)}`;
  return `${a.name ?? 'không rõ tên'}${a.id ? ` · id ${a.id}` : ''}`;
}

/** Một dòng kết quả: tài khoản thật + Cash + có khớp cấu hình không. */
export function AccountCheckLine({
  accountId,
  venue,
  label,
  className,
}: {
  accountId: string;
  venue?: TradingVenue;
  label?: string;
  className?: string;
}) {
  useStoreVersion();
  const e = store.get(accountId);
  if (!e) return null;
  const prefix = label ? (
    <span className="text-muted-fg">{label} → </span>
  ) : null;
  if (e.state === 'loading')
    return (
      <div className={cn('text-caption text-faint', className)}>
        {prefix}đang đọc tài khoản trên sàn…
      </div>
    );
  if (e.state === 'error')
    return (
      <div className={cn('text-caption text-critical', className)}>
        {prefix}
        {errorText(e.error)}
      </div>
    );
  const d = e.data;
  const v = venue ?? d.venue;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-caption',
        className,
      )}
    >
      {d.matchesConfig === false ? (
        <Pill tone="critical">
          {v === 'csgoempire' ? 'Sai tài khoản' : 'Sai ví'}
        </Pill>
      ) : d.matchesConfig ? (
        <Pill tone="ok">Đúng tài khoản</Pill>
      ) : (
        <Pill tone="warn">Chưa so được</Pill>
      )}
      <span className="num min-w-0 text-fg">
        {prefix}
        {identityText(v, {
          id: d.remoteId,
          name: d.remoteName,
          wallet: d.wallet,
        })}
      </span>
      <span className="num text-fg">
        Cash <span className="font-medium">{usd(d.cash)}</span>
      </span>
      {d.allowance !== null && d.allowance < d.cash ? (
        <span className="num text-warn">allowance {usd(d.allowance)}</span>
      ) : null}
      <span className="num text-faint">lúc {fmtStamp(d.checkedAt)}</span>
    </div>
  );
}

/** Nút đọc tài khoản thật + số dư của một hoặc nhiều tài khoản. */
export function AccountCheckButton({
  accountIds,
  disabledReason,
  children = 'Kiểm tra',
}: {
  accountIds: string[];
  disabledReason?: string | null;
  children?: ReactNode;
}) {
  useStoreVersion();
  const [busy, setBusy] = useState(false);
  const loading =
    busy || accountIds.some((id) => store.get(id)?.state === 'loading');
  const run = useCallback(async () => {
    setBusy(true);
    await Promise.all(accountIds.map(checkAccount));
    setBusy(false);
  }, [accountIds]);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={loading}
      disabledReason={disabledReason}
      onClick={() => void run()}
    >
      <ShieldCheck aria-hidden /> {children}
    </Button>
  );
}
