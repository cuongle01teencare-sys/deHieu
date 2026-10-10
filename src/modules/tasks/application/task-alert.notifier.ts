import type { TaskRecord } from '../domain/task-record.js';

/** Port: báo khi publisher chết hẳn. Kênh thật (Discord/Telegram...) bàn sau. */
export interface TaskAlertNotifier {
  taskDied(record: TaskRecord, reason: string): Promise<void>;
}

export const TASK_ALERT_NOTIFIER = Symbol('TASK_ALERT_NOTIFIER');
