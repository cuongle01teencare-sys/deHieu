'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { BellRing, Check, Copy, Send, Share2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { loadPrefs, pushDiagnostics, pushPermission, pushSubscriptionId, requestPush, savePrefs, type PushDiagnostics } from '@/lib/push';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { Button } from '../ui/button';
import { Switch } from '../ui/controls';
import { Sheet } from '../ui/panel';
import { Pill, type Tone } from '../ui/status';
import { openPrompt, useInstallState } from './pwa';

/** Mở bảng cài đặt thông báo từ bất kỳ đâu. */
export const openPushSetup = () => window.dispatchEvent(new CustomEvent('arbops:push-setup'));

/** Link mở thẳng bảng cài đặt trên điện thoại khác (sau khi đăng nhập). */
const setupLink = () => `${window.location.origin}/login?next=${encodeURIComponent('/thong-bao?setup=1')}`;

/** Gắn một lần trong shell: lắng nghe openPushSetup() và ?setup=1 trên URL. */
export function PushSetupManager() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('arbops:push-setup', onOpen);
    if (new URLSearchParams(window.location.search).get('setup') === '1') setOpen(true);
    return () => window.removeEventListener('arbops:push-setup', onOpen);
  }, []);
  return <PushSetupSheet open={open} onOpenChange={setOpen} />;
}

/** Nút mở bảng cài đặt (đặt ở trang On click, Thông báo…). */
export function PushSetupButton({ label = 'Cài đặt thông báo', variant = 'secondary' }: { label?: string; variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <Button variant={variant} size="sm" onClick={openPushSetup}>
      <BellRing aria-hidden /> {label}
    </Button>
  );
}

const yes = (v: boolean) => (v ? 'có' : 'không');

/** Số liệu đăng ký thật trên thiết bị + kết luận bị chặn ở đâu (chép gửi cho người hỗ trợ). */
function Diagnostics() {
  const [d, setD] = useState<PushDiagnostics | null>(null);
  useEffect(() => {
    let live = true;
    const run = () => void pushDiagnostics().then((x) => live && setD(x));
    run();
    const t = setInterval(run, 2_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  if (!d) return null;
  const os = d.workers.find((w) => w.scope.startsWith('/push/onesignal'));
  const verdict = !os
    ? 'Chưa có service worker của OneSignal (/push/onesignal/) → trình duyệt chưa cài được worker. Tải lại trang; nếu vẫn vậy, file /push/onesignal/OneSignalSDKWorker.js có thể không tải được.'
    : !os.push
      ? 'Worker OneSignal đã cài nhưng trình duyệt chưa tạo đăng ký push → lỗi ở phía trình duyệt / iOS. Bấm "Đăng ký lại"; nếu vẫn vậy: xóa Arb Ops khỏi Màn hình chính, thêm lại, mở lại.'
      : !d.onesignalId || !d.subscriptionId
        ? 'Trình duyệt đã có đăng ký push nhưng máy chủ OneSignal chưa nhận → kiểm tra Site URL ở OneSignal (Web → Settings) khớp đúng ' + d.origin + ' và kiểu tích hợp là Custom Code.'
        : !d.optedIn
          ? 'Đã có mã nhưng chưa opt-in → bấm "Đăng ký lại".'
          : 'Đăng ký ổn.';
  const lines = [
    `origin ${d.origin} · standalone ${yes(d.standalone)} · sdk ${d.sdk} · quyền ${d.permission}`,
    `OneSignal user ${d.onesignalId ?? '—'} · subscription ${d.subscriptionId ?? '—'} · optedIn ${yes(d.optedIn)} · token ${yes(d.hasToken)}`,
    `workers: ${d.workers.map((w) => `${w.scope} (chạy ${yes(w.active)}, push ${yes(w.push)})`).join(' · ') || 'không có'}`,
    d.lastError ? `lỗi gần nhất: ${d.lastError}` : null,
  ].filter((x): x is string => !!x);
  return (
    <div className="mt-2 rounded-[8px] border border-line p-2">
      <div className="text-fg">Chẩn đoán: {verdict}</div>
      <pre className="num mt-1 whitespace-pre-wrap break-all text-[11px] text-faint">{lines.join('\n')}</pre>
      <button
        type="button"
        className="mt-1 text-accent-text hover:underline"
        onClick={() =>
          void navigator.clipboard
            .writeText(`${verdict}\n${lines.join('\n')}`)
            .then(() => toast.success('Đã chép chẩn đoán'))
            .catch(() => toast.error('Không chép được'))
        }
      >
        Chép chẩn đoán
      </button>
    </div>
  );
}

function Step({ n, title, tone, state, children }: { n: number; title: string; tone: Tone; state: string; children?: ReactNode }) {
  const done = tone === 'ok';
  return (
    <li className="flex gap-3 border-b border-line py-3 last:border-0">
      <span className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-micro font-semibold', done ? 'bg-ok/15 text-ok' : 'bg-hover text-muted-fg')}>
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-body font-medium text-fg">{title}</span>
          <Pill tone={tone}>{state}</Pill>
        </div>
        {children ? <div className="mt-2 text-caption text-muted-fg">{children}</div> : null}
      </div>
    </li>
  );
}

/**
 * Cài đặt thông báo cho THIẾT BỊ này, từng bước có trạng thái thật: (iPhone) thêm vào Màn hình chính →
 * cho phép thông báo → OneSignal đăng ký thiết bị → bật mục "Kèo" → gửi thử từ backend.
 * Thông báo gắn với thiết bị, không gắn với tài khoản: nhiều người / nhiều điện thoại dùng chung một
 * tài khoản đều nhận được, miễn là mỗi máy làm các bước này một lần.
 */
export function PushSetupSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const s = useInstallState();
  const [signals, setSignals] = useState(true);
  const [busy, setBusy] = useState<'enable' | 'test' | null>(null);
  const [subId, setSubId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setSignals(loadPrefs().signals);
    const t = setInterval(() => setSubId(pushSubscriptionId()), 1_000);
    setSubId(pushSubscriptionId());
    return () => clearInterval(t);
  }, [open]);

  const needsInstall = s.ios && !s.standalone;
  const perm = s.permission;
  const ready = s.sdkState === 'ready';

  const enable = async () => {
    setBusy('enable');
    try {
      const r = await requestPush();
      if (r === 'granted') toast.success('Đã cho phép thông báo', { description: 'OneSignal đang đăng ký thiết bị, chờ vài giây.' });
      else if (r === 'denied') toast.error('Thông báo đang bị chặn', { description: 'Mở cài đặt trình duyệt / ứng dụng để cho phép lại rồi tải lại trang.' });
      else if (r === 'unsupported') toast.error('Thiết bị này chưa hỗ trợ thông báo đẩy');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không bật được thông báo');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    const id = pushSubscriptionId();
    if (!id) return;
    setBusy('test');
    try {
      const r = await api<{ id: string | null; errors: string[] }>('trading/push/test', { method: 'POST', body: JSON.stringify({ subscriptionId: id }) });
      if (r.id && !r.errors.length) toast.success('Đã gửi thử', { description: 'Thông báo sẽ tới trong vài giây.' });
      else
        toast.warning('OneSignal chưa coi thiết bị này là đã đăng ký', {
          description: `${r.errors.join(' · ') || 'Không có thiết bị khớp'}. Thử: tải lại trang, tắt/bật lại quyền thông báo; kiểm tra OneSignal đã TẮT Identity Verification.`,
        });
    } catch (e) {
      toast.error('Gửi thử không thành công', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    const url = setupLink();
    try {
      if (navigator.share) await navigator.share({ title: 'Arb Ops — bật thông báo', text: 'Mở link, đăng nhập rồi làm theo các bước để nhận thông báo kèo On click.', url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success('Đã chép link', { description: url });
      }
    } catch {
      /* người dùng hủy chia sẻ */
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-[10px] bg-accent-soft text-accent-text">
            <Smartphone className="size-4 stroke-[1.5]" />
          </span>
          Cài đặt thông báo trên thiết bị này
        </span>
      }
    >
      {s.sdkState === 'disabled' ? (
        <p className="mb-3 rounded-[8px] border border-warn/40 bg-warn/10 p-3 text-caption text-warn">
          Bản web này chưa có <span className="num">NEXT_PUBLIC_ONESIGNAL_APP_ID</span> nên không bật được thông báo. Thêm biến này (App ID OneSignal) vào env của web — trên Vercel: Project Settings →
          Environment Variables — rồi build / deploy lại (biến NEXT_PUBLIC_* được gắn lúc build, chỉ restart không đủ).
        </p>
      ) : s.sdkState === 'error' ? (
        <p className="mb-3 rounded-[8px] border border-critical/40 bg-critical/10 p-3 text-caption text-critical">
          Không tải được OneSignal (mạng, trình chặn quảng cáo hoặc Site URL trong OneSignal không khớp địa chỉ web). Tải lại trang để thử lại.
        </p>
      ) : null}
      <p>Thông báo gắn với từng thiết bị, không gắn với tài khoản. Nhiều người hoặc nhiều điện thoại dùng chung một tài khoản đều nhận được, miễn là mỗi máy làm các bước dưới đây một lần.</p>
      <ol className="mt-3">
        {s.ios ? (
          <Step n={1} title="Thêm Arb Ops vào Màn hình chính (iPhone)" tone={s.standalone ? 'ok' : 'warn'} state={s.standalone ? 'đã cài' : 'chưa cài'}>
            {s.standalone ? (
              'Đang mở từ biểu tượng trên Màn hình chính.'
            ) : (
              <>
                iPhone chỉ nhận thông báo khi mở web từ Màn hình chính (iOS 16.4+): bấm nút Chia sẻ của Safari → Thêm vào MH chính, rồi mở Arb Ops từ biểu tượng đó.{' '}
                <button type="button" className="text-accent-text hover:underline" onClick={() => openPrompt('ios')}>
                  Xem hướng dẫn
                </button>
              </>
            )}
          </Step>
        ) : null}
        <Step
          n={s.ios ? 2 : 1}
          title="Cho phép thông báo"
          tone={perm === 'granted' ? 'ok' : perm === 'denied' ? 'critical' : 'warn'}
          state={perm === 'granted' ? 'đã cho phép' : perm === 'denied' ? 'đang bị chặn' : perm === 'unsupported' ? 'không hỗ trợ' : 'chưa cho phép'}
        >
          {perm === 'denied' ? (
            'Trình duyệt / ứng dụng đang chặn thông báo của trang này. Mở cài đặt (biểu tượng ổ khóa cạnh địa chỉ, hoặc Cài đặt → Thông báo trên điện thoại), cho phép lại rồi tải lại trang.'
          ) : perm === 'granted' ? (
            'Đã cho phép.'
          ) : (
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'enable'}
              disabledReason={
                needsInstall
                  ? 'Thêm vào Màn hình chính trước'
                  : s.sdkState === 'disabled'
                    ? 'Web chưa cấu hình OneSignal'
                    : s.sdkState === 'error'
                      ? 'Không tải được OneSignal'
                      : !ready
                        ? 'Đang tải OneSignal…'
                        : null
              }
              onClick={() => void enable()}
            >
              <BellRing aria-hidden /> Bật thông báo
            </Button>
          )}
        </Step>
        <Step
          n={s.ios ? 3 : 2}
          title="Đăng ký với OneSignal"
          tone={s.subscribed ? 'ok' : perm === 'granted' ? 'warn' : 'muted'}
          state={s.subscribed ? 'đã đăng ký' : s.sdkState === 'error' ? 'lỗi tải' : 'chưa đăng ký'}
        >
          {s.subscribed ? (
            <>
              Mã thiết bị: <span className="num select-all text-fg">{subId}</span> — đối chiếu được ở OneSignal → Audience → Subscriptions.
            </>
          ) : perm === 'granted' ? (
            <>
              Đã cho phép nhưng chưa đăng ký xong.{' '}
              <button type="button" className="text-accent-text hover:underline" onClick={() => void enable()}>
                Đăng ký lại
              </button>{' '}
              hoặc tải lại trang.
              <Diagnostics />
            </>
          ) : (
            'Tự đăng ký sau khi cho phép thông báo.'
          )}
        </Step>
        <Step n={s.ios ? 4 : 3} title='Nhận "Kèo vượt ngưỡng · kèo On click"' tone={signals ? 'ok' : 'warn'} state={signals ? 'bật' : 'tắt'}>
          <span className="flex items-center justify-between gap-4">
            Kèo mới lên On click sẽ báo về thiết bị này.
            <Switch
              checked={signals}
              onCheckedChange={(v) => {
                setSignals(v);
                savePrefs({ ...loadPrefs(), signals: v });
              }}
              label="Nhận kèo On click"
            />
          </span>
        </Step>
        <Step n={s.ios ? 5 : 4} title="Gửi thử từ backend" tone="muted" state="kiểm tra">
          <Button size="sm" variant="secondary" loading={busy === 'test'} disabledReason={!s.subscribed ? 'Hoàn tất các bước trên trước' : null} onClick={() => void test()}>
            <Send aria-hidden /> Gửi thử tới thiết bị này
          </Button>
        </Step>
      </ol>

      <div className="mt-4 rounded-[8px] border border-line p-3">
        <div className="text-body font-medium text-fg">Thêm điện thoại khác</div>
        <p className="mt-1 text-caption text-muted-fg">Gửi link này sang điện thoại kia (hoặc cho người dùng chung tài khoản). Mở link, đăng nhập, bảng này sẽ tự hiện để bật thông báo trên máy đó.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void share()}>
            <Share2 aria-hidden /> Chia sẻ link
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard
                .writeText(setupLink())
                .then(() => toast.success('Đã chép link'))
                .catch(() => toast.error('Không chép được'))
            }
          >
            <Copy aria-hidden /> Chép link
          </Button>
        </div>
      </div>
      <p className="mt-3 text-caption text-faint">
        Quyền gửi thử cần trading:manage. Trạng thái: {pushPermission() === 'granted' ? 'đã cho phép' : 'chưa cho phép'} · OneSignal {s.sdkState}.
      </p>
    </Sheet>
  );
}
