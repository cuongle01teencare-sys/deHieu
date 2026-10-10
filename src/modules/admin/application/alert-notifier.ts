import type { Incident } from '../domain/incident.js';

/** Port: đẩy cảnh báo ra ngoài (Discord, Telegram, email...). Không được ném lỗi. */
export interface AlertNotifier {
  notify(change: 'opened' | 'resolved', incident: Incident): Promise<void>;
}

export const ALERT_NOTIFIER = Symbol('ALERT_NOTIFIER');
