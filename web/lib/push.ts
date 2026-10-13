/**
 * Thông báo đẩy (OneSignal) — lớp mỏng để UI không phụ thuộc SDK.
 * Khi nạp OneSignal Web SDK (window.OneSignal), các hàm dưới dùng SDK; nếu chưa có thì dùng
 * Notification API của trình duyệt để thiết kế/kiểm thử luồng.
 */
type OneSignalLike = {
  Notifications: { requestPermission: () => Promise<void>; permission: boolean };
  User?: { addTags?: (t: Record<string, string>) => void };
};
declare global {
  interface Window {
    OneSignal?: OneSignalLike;
  }
}

export type PushSupport = 'supported' | 'ios-needs-install' | 'unsupported';

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
  return 'Notification' in window && 'serviceWorker' in navigator ? 'supported' : 'unsupported';
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** Gọi prompt gốc — CHỈ sau khi người dùng bấm "Bật thông báo" trên sheet mềm. */
export async function requestPush(): Promise<NotificationPermission | 'unsupported'> {
  if (window.OneSignal) {
    await window.OneSignal.Notifications.requestPermission();
    return pushPermission();
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.requestPermission();
}

/** Gửi thử: OneSignal sẽ gửi từ server; bản thiết kế hiển thị thông báo cục bộ. */
export async function sendTestNotification(): Promise<boolean> {
  if (pushPermission() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: 'Thông báo thử từ Arb Ops — mọi thứ hoạt động.', icon: '/icons/icon-192.png', tag: 'test' };
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
  window.OneSignal?.User?.addTags?.({
    critical: p.critical ? '1' : '0',
    warning: p.warning ? '1' : '0',
    signals: p.signals ? '1' : '0',
    signal_threshold: String(p.signalThreshold),
    anomalies: p.anomalies ? '1' : '0',
    quiet: p.quietHours ? `${p.quietFrom}-${p.quietTo}` : '',
    actionable_only: p.actionableOnly ? '1' : '0',
  });
}
