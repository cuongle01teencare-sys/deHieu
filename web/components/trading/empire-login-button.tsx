'use client';

import { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { fmtStamp } from '@/lib/format';
import { api } from '@/lib/api';
import { useGuard, useMutate } from '../shell/shell-context';
import { Button } from '../ui/button';
import { Panel } from '../ui/panel';
import { Pill } from '../ui/status';

interface LoginStatus {
  stage:
    | 'opening'
    | 'signing_in'
    | 'obtaining_session'
    | 'ready'
    | 'verification_required'
    | 'error'
    | 'cancelled';
  updatedAt: number;
  expiresAt: number | null;
  error: string | null;
  attemptId?: string;
  jwtAvailable?: boolean;
  diagnostic?: {
    step:
      | 'browser'
      | 'page'
      | 'login'
      | 'currency'
      | 'jwt'
      | 'identify'
      | 'account';
    httpStatus?: number;
    loginRequest?: 'not_observed' | 'pending' | 'completed' | 'failed';
    verificationRequest?: 'observed' | 'failed';
    elapsedMs?: number;
    sessionIssue?:
      | 'token_malformed'
      | 'expiry_invalid'
      | 'expiry_too_short'
      | 'currency_missing'
      | 'currency_unsupported'
      | 'identify_currency_unsupported';
  };
}
const steps: Record<NonNullable<LoginStatus['diagnostic']>['step'], string> = {
  browser: 'Mở Chromium',
  page: 'Mở trang Match betting',
  login: 'Đăng nhập',
  currency: 'Chuyển tiền tệ sang USD',
  jwt: 'Nhận JWT từ csgoempire',
  identify: 'Xác thực JWT với BetBy',
  account: 'Xác nhận đúng tài khoản',
};
const labels: Record<LoginStatus['stage'], string> = {
  opening: 'Đang mở Chromium',
  signing_in: 'Đang đăng nhập và chờ sàn xác nhận',
  obtaining_session: 'Đang lấy phiên đăng nhập',
  ready: 'Phiên giao dịch đã sẵn sàng',
  verification_required: 'Sàn yêu cầu xác minh',
  error: 'Đăng nhập chưa thành công',
  cancelled: 'Đã dừng đăng nhập',
};
const loginRequests = {
  not_observed: 'Chưa quan sát được request đăng nhập',
  pending: 'Đã gửi request đăng nhập, đang chờ phản hồi',
  completed: 'Đã nhận phản hồi request đăng nhập',
  failed: 'Request đăng nhập bị lỗi kết nối',
};
const sessionIssues = {
  token_malformed: 'Token nhận được không có payload JWT hợp lệ.',
  expiry_invalid: 'Token thiếu hoặc có trường exp không hợp lệ.',
  expiry_too_short:
    'Token đã hết hạn hoặc còn dưới 60 giây theo đồng hồ backend.',
  currency_missing:
    'Payload JWT không có trường currency mà adapter đang yêu cầu.',
  currency_unsupported:
    'Tiền tệ trong JWT không phải USD như cấu hình giao dịch hiện tại.',
  identify_currency_unsupported:
    'Phản hồi identify không xác nhận tiền tệ USD.',
};
const errors: Record<string, string> = {
  CSGOEMPIRE_CURRENCY_SWITCH_FAILED:
    'Chưa chuyển được trang sang USD hoặc chưa nhận được phiên USD sau khi chuyển.',
  CSGOEMPIRE_SESSION_EXPIRED:
    'API từ chối phiên đăng nhập (HTTP 401). Bấm Chạy lại để lấy phiên mới.',
  CSGOEMPIRE_PAGE_NAVIGATION_FAILED:
    'Không tải được trang Match betting. Kiểm tra kết nối hoặc thông báo trên Chromium.',
  CSGOEMPIRE_LOGIN_FLOW_FAILED:
    'Luồng đăng nhập bị gián đoạn trước khi lấy được JWT.',
  CSGOEMPIRE_SESSION_RESPONSE_FAILED:
    'Chưa nhận được phản hồi JWT hợp lệ từ trang Match betting.',
  CSGOEMPIRE_SESSION_REQUEST_REJECTED: 'csgoempire từ chối yêu cầu cấp JWT.',
  CSGOEMPIRE_SESSION_IDENTIFY_FAILED:
    'Đã nhận JWT nhưng chưa xác thực được phiên với BetBy.',
  CSGOEMPIRE_SESSION_ACCOUNT_FAILED:
    'Đã nhận JWT nhưng chưa đọc được thông tin để xác nhận đúng tài khoản.',
  CSGOEMPIRE_SESSION_ACCESS_BLOCKED:
    'BetBy không cho phép tài khoản hoặc vị trí hiện tại sử dụng phiên này.',
  CSGOEMPIRE_SESSION_COOKIE_MISSING:
    'Chưa tìm thấy cookie đăng nhập trong hồ sơ Chromium.',
  CSGOEMPIRE_SESSION_INVALID:
    'JWT không hợp lệ, sai tiền tệ hoặc không còn đủ thời hạn.',
  CSGOEMPIRE_SESSION_REFRESH_FAILED:
    'Dịch vụ phiên tạm thời chưa phản hồi thành công. Thử lại sau.',
  CSGOEMPIRE_LOGIN_FORM_UNSUPPORTED:
    'Chưa nhận diện được form đăng nhập của sàn.',
  CSGOEMPIRE_LOGIN_REJECTED: 'Sàn từ chối tài khoản hoặc mật khẩu.',
  CSGOEMPIRE_LOGIN_NETWORK_FAILED:
    'Request đăng nhập bị lỗi kết nối. Kiểm tra mạng hoặc proxy trên máy chạy backend.',
  CSGOEMPIRE_LOGIN_REQUEST_REJECTED:
    'Sàn trả lỗi cho request đăng nhập. Xem mã HTTP bên dưới; lỗi này chưa chứng minh mật khẩu sai.',
  CSGOEMPIRE_LOGIN_ACCOUNT_MISMATCH:
    'Hồ sơ đang đăng nhập tài khoản khác. Chọn hồ sơ riêng cho tài khoản đã cấu hình.',
  CSGOEMPIRE_BROWSER_CLOSED:
    'Cửa sổ Chromium đã đóng trước khi đăng nhập xong.',
  CSGOEMPIRE_LOGIN_NOT_CONFIRMED:
    'Hết 90 giây chờ sàn xác nhận đăng nhập. App đã đóng Chromium; chưa thể kết luận tài khoản hoặc mật khẩu bị từ chối.',
  CSGOEMPIRE_VERIFICATION_REQUIRED:
    'Sàn yêu cầu CAPTCHA, OTP hoặc xác minh. App đã dừng.',
  CSGOEMPIRE_BROWSER_UNAVAILABLE:
    'Không mở được Chromium. Kiểm tra đã cài Chromium và backend đang chạy trong phiên desktop.',
  CSGOEMPIRE_LOGIN_CREDENTIALS_MISSING:
    'Lưu tài khoản và mật khẩu trong phần sửa tài khoản csgoempire trước.',
  LIVE_REDIS_REQUIRED:
    'Cần Redis để khóa tài khoản khi đăng nhập và giao dịch.',
  TRADING_SECRET_KEY_REQUIRED: 'Chưa cấu hình khóa mã hóa thông tin đăng nhập.',
  ACCOUNT_BUSY: 'Tài khoản đang được một tiến trình khác sử dụng. Thử lại sau.',
  CSGOEMPIRE_LOGIN_START_FAILED:
    'Chưa khởi động được luồng đăng nhập. Kiểm tra thông báo lỗi rồi thử lại.',
};
export function EmpireLoginButton({
  accountId,
  disabledReason,
}: {
  accountId: string;
  disabledReason?: string | null;
}) {
  const manage = useGuard('trading:manage');
  const mutate = useMutate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<LoginStatus | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [jwt, setJwt] = useState<{ token: string; expiresAt: number } | null>(
    null,
  );
  const [jwtError, setJwtError] = useState<string | null>(null);
  const consumed = useRef(new Set<string>());
  const generation = useRef(0);
  const path = `trading/accounts/${encodeURIComponent(accountId)}/browser-login`;
  const status = useApi<LoginStatus | null>(open ? path : null, 1500);
  const current =
    status.data && status.data.updatedAt >= (latest?.updatedAt ?? 0)
      ? status.data
      : latest;
  const running =
    !!current &&
    ['opening', 'signing_in', 'obtaining_session'].includes(current.stage);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    const id = current?.attemptId;
    if (
      !open ||
      !id ||
      id !== attemptId ||
      !current.jwtAvailable ||
      consumed.current.has(id)
    )
      return;
    consumed.current.add(id);
    const mine = generation.current;
    // Use a separate one-shot POST, never the status polling cache. Closing
    // the panel invalidates in-flight replies so reopening cannot reveal it.
    void api<{ token: string; expiresAt: number } | null>(`${path}/jwt`, {
      method: 'POST',
      body: JSON.stringify({ attemptId: id }),
    })
      .then((value) => {
        if (generation.current !== mine) return;
        if (value) setJwt(value);
        else setJwtError('JWT đã được xem một lần hoặc thời gian xem đã hết.');
      })
      .catch(() => {
        if (generation.current === mine)
          setJwtError(
            'Không nhận được JWT để hiển thị một lần. Phiên giao dịch vẫn được giữ ở backend.',
          );
      });
  }, [open, attemptId, current?.attemptId, current?.jwtAvailable, path]);
  const changeOpen = (value: boolean) => {
    if (!value) {
      generation.current++;
      setJwt(null);
      setJwtError(null);
    }
    setOpen(value);
  };
  const start = async () => {
    generation.current++;
    setJwt(null);
    setJwtError(null);
    setAttemptId(null);
    setOpen(true);
    setBusy(true);
    try {
      const result = await mutate<LoginStatus>(path, { method: 'POST' });
      if (result) {
        setLatest(result);
        setAttemptId(result.attemptId ?? null);
      } else
        setLatest({
          stage: 'error',
          updatedAt: Date.now(),
          expiresAt: null,
          error: 'CSGOEMPIRE_LOGIN_START_FAILED',
        });
      void status.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabledReason={manage ?? disabledReason}
        loading={busy}
        onClick={() => void start()}
      >
        <Monitor aria-hidden /> Mở Chromium & đăng nhập
      </Button>
      <Panel
        open={open}
        onOpenChange={changeOpen}
        title="Đăng nhập csgoempire tự động"
        description="Chromium mở trên máy chạy backend. App nhập từng ký tự và bấm đăng nhập bằng thông tin bạn đã lưu."
        footer={
          <>
            {running ? (
              <Button
                variant="ghost"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await mutate<LoginStatus>(path, {
                      method: 'DELETE',
                    });
                    if (result) setLatest(result);
                    void status.reload();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Dừng đăng nhập
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => void start()}
                loading={busy}
              >
                Chạy lại
              </Button>
            )}
            <Button variant="ghost" onClick={() => changeOpen(false)}>
              Đóng
            </Button>
          </>
        }
      >
        <div role="status" aria-live="polite" className="space-y-3">
          <Pill
            tone={
              current?.stage === 'ready'
                ? 'ok'
                : current?.error
                  ? 'warn'
                  : 'muted'
            }
          >
            {current ? labels[current.stage] : 'Đang khởi tạo'}
          </Pill>
          {current?.error ? (
            <p className="text-body text-warn">
              {current.error === 'CSGOEMPIRE_SESSION_INVALID' &&
              current.diagnostic?.sessionIssue
                ? sessionIssues[current.diagnostic.sessionIssue]
                : (errors[current.error] ?? current.error)}
            </p>
          ) : null}
          {status.error ? (
            <p className="text-body text-warn">{status.error}</p>
          ) : null}
          {current?.diagnostic ? (
            <p className="text-caption text-muted-fg">
              {current.error ? 'Dừng ở bước: ' : 'Bước hiện tại: '}
              {steps[current.diagnostic.step]}
              {current.diagnostic.httpStatus
                ? ` · HTTP ${current.diagnostic.httpStatus}`
                : ''}
            </p>
          ) : null}
          {current?.diagnostic?.loginRequest ? (
            <p className="text-caption text-muted-fg">
              {loginRequests[current.diagnostic.loginRequest]}
              {current.diagnostic.elapsedMs !== undefined
                ? ` · ${Math.floor(current.diagnostic.elapsedMs / 1000)} giây`
                : ''}
              {current.diagnostic.verificationRequest
                ? current.diagnostic.verificationRequest === 'failed'
                  ? ' · Tải dịch vụ xác minh thất bại'
                  : ' · Có request tới dịch vụ xác minh'
                : ''}
            </p>
          ) : null}
          {jwt ? (
            <div className="space-y-2">
              <label
                htmlFor={`empire-jwt-${accountId}`}
                className="block text-body font-medium text-fg"
              >
                JWT vừa lấy
              </label>
              <textarea
                id={`empire-jwt-${accountId}`}
                aria-label="JWT vừa lấy"
                readOnly
                autoComplete="off"
                spellCheck={false}
                rows={5}
                value={jwt.token}
                className="num w-full resize-none rounded-[8px] border border-line bg-transparent p-3 text-caption text-fg"
              />
              <p className="text-caption text-faint">
                Chỉ hiển thị lần này. Đóng bảng sẽ ẩn JWT; các lần tự làm mới
                không hiển thị lại.
              </p>
            </div>
          ) : null}
          {jwtError ? (
            <p className="text-caption text-warn">{jwtError}</p>
          ) : null}
          {current?.stage === 'ready' ? (
            <>
              <p className="text-body text-muted-fg">
                Đã lấy được phiên. Bạn có thể bấm Vào lệnh ở On click hoặc dùng
                Auto trade theo cấu hình profile. Mỗi cặp lệnh vẫn kiểm tra Cash
                hai sàn trước khi gửi.
              </p>
              {current.expiresAt ? (
                <p className="text-caption text-faint">
                  Phiên hiện tại có hiệu lực đến {fmtStamp(current.expiresAt)}.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </Panel>
    </>
  );
}
