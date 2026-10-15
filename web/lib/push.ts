/**
 * Thông báo đẩy (OneSignal) — lớp mỏng để UI không phụ thuộc SDK.
 * SDK chỉ được nạp khi có NEXT_PUBLIC_ONESIGNAL_APP_ID và trình duyệt hỗ trợ push.
 * Worker OneSignal có scope riêng để không thay thế worker PWA ở /sw.js.
 */
type OneSignalLike = {
  init: (options: {
    appId: string;
    serviceWorkerPath: string;
    serviceWorkerParam: { scope: string };
    allowLocalhostAsSecureOrigin: boolean;
    notifyButton: { enable: boolean };
    welcomeNotification: { disable: boolean };
    promptOptions: { slidedown: { prompts: { type: 'push'; autoPrompt: boolean }[] } };
  }) => Promise<void>;
  Notifications: { requestPermission: () => Promise<void>; permission: boolean };
  User: {
    addTags: (t: Record<string, string>) => void | Promise<void>;
    PushSubscription: { id?: string; optedIn: boolean; optIn: () => Promise<void> };
  };
};
declare global {
  interface Window {
    OneSignal?: OneSignalLike;
    OneSignalDeferred?: ((sdk: OneSignalLike) => void)[];
  }
}

export type PushSupport = 'supported' | 'ios-needs-install' | 'unsupported';
export type PushSdkState = 'disabled' | 'loading' | 'ready' | 'error';

let sdk: OneSignalLike | null = null;
let initialization: Promise<void> | null = null;
let sdkState: PushSdkState = 'loading';

export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID?.trim());
}

export function pushSdkState(): PushSdkState {
  return pushConfigured() ? sdkState : 'disabled';
}

export function pushSubscribed(): boolean {
  return Boolean(sdk?.User.PushSubscription.id && sdk.User.PushSubscription.optedIn);
}

/** Một lần cho mỗi lần tải trang, kể cả khi React Strict Mode chạy effect hai lần. */
export function initializePush(): Promise<void> {
  if (!pushConfigured() || pushSupport() !== 'supported') return Promise.resolve();
  if (initialization) return initialization;

  initialization = new Promise<OneSignalLike>((resolve, reject) => {
    if (window.OneSignal?.init) {
      resolve(window.OneSignal);
      return;
    }
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      script.remove();
      reject(new Error('Không tải được OneSignal. Kiểm tra kết nối rồi tải lại trang.'));
    }, 15_000);
    const deferred = window.OneSignalDeferred ??= [];
    deferred.push((oneSignal) => {
      clearTimeout(timeout);
      resolve(oneSignal);
    });
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error('Không tải được OneSignal. Kiểm tra kết nối rồi tải lại trang.'));
    };
    document.head.appendChild(script);
  }).then(async (oneSignal) => {
    await oneSignal.init({
      appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID!.trim(),
      serviceWorkerPath: 'push/onesignal/OneSignalSDKWorker.js',
      serviceWorkerParam: { scope: '/push/onesignal/' },
      allowLocalhostAsSecureOrigin: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
      notifyButton: { enable: false },
      welcomeNotification: { disable: true },
      promptOptions: { slidedown: { prompts: [{ type: 'push', autoPrompt: false }] } },
    });
    sdk = oneSignal;
    sdkState = 'ready';
    syncPrefs(loadPrefs());
  }).catch((error: unknown) => {
    sdkState = 'error';
    throw error;
  });
  return initialization;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iOS chỉ nhận push khi web app đã được thêm vào Màn hình chính (iOS 16.4+). */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIos() && !isStandalone()) return 'ios-needs-install';
  return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window ? 'supported' : 'unsupported';
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** Gọi prompt gốc — CHỈ sau khi người dùng bấm "Bật thông báo" trên sheet mềm. */
export async function requestPush(): Promise<NotificationPermission | 'unsupported'> {
  if (pushSupport() !== 'supported') return 'unsupported';
  // Không chờ tải SDK ở đây: prompt trên iOS phải giữ thao tác bấm của người dùng.
  if (!sdk) throw new Error('Thông báo chưa sẵn sàng. Vui lòng tải lại trang và thử lại.');
  if (pushPermission() !== 'granted') await sdk.Notifications.requestPermission();
  if (pushPermission() === 'granted') {
    await sdk.User.PushSubscription.optIn();
    syncPrefs(loadPrefs());
  }
  return pushPermission();
}

/** Chỉ kiểm tra hiển thị cục bộ; kiểm tra push thực tế bằng OneSignal dashboard. */
export async function sendTestNotification(): Promise<boolean> {
  if (pushPermission() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: 'Thông báo thử cục bộ từ Arb Ops.', icon: '/icons/icon-192.png', tag: 'test' };
    if (reg) await reg.showNotification('Arb Ops', opts);
    else new Notification('Arb Ops', opts);
    return true;
  } catch {
    return false;
  }
}

/** Tùy chọn thông báo — lưu cục bộ và gắn tag OneSignal để server lọc khi gửi. */
export interface PushPrefs {
  critical: boolean;
  warning: boolean;
  signals: boolean;
  signalThreshold: number; // tỉ lệ, 0.03 = 3%
  anomalies: boolean;
  quietHours: boolean;
  quietFrom: string; // '23:00'
  quietTo: string; // '07:00'
  actionableOnly: boolean;
}

export const DEFAULT_PREFS: PushPrefs = {
  critical: true,
  warning: false,
  signals: true,
  signalThreshold: 0.03,
  anomalies: true,
  quietHours: false,
  quietFrom: '23:00',
  quietTo: '07:00',
  actionableOnly: false,
};

const KEY = 'arbops-push-prefs';

export function loadPrefs(): PushPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<PushPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: PushPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* bỏ qua */
  }
  syncPrefs(p);
}

function syncPrefs(p: PushPrefs): void {
  if (!sdk) return;
  // Sáu tag để phù hợp gói Free. Các tùy chọn giao nhận gộp trong delivery_prefs.
  const tags = {
    critical: p.critical ? '1' : '0',
    warning: p.warning ? '1' : '0',
    signals: p.signals ? '1' : '0',
    signal_threshold: String(p.signalThreshold),
    anomalies: p.anomalies ? '1' : '0',
    delivery_prefs: JSON.stringify({ quiet: p.quietHours ? `${p.quietFrom}-${p.quietTo}` : '', actionable: p.actionableOnly }),
  };
  try {
    void Promise.resolve(sdk.User.addTags(tags)).catch((error: unknown) => console.warn('Không đồng bộ được tùy chọn thông báo', error));
  } catch (error) {
    console.warn('Không đồng bộ được tùy chọn thông báo', error);
  }
}
