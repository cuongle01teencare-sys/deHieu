import { Logger } from '@nestjs/common';
import type { TaskAlertNotifier } from '../../application/task-alert.notifier.js';
import type { TaskRecord } from '../../domain/task-record.js';

/** Tạm thời chỉ ghi log. Kênh thông báo thật sẽ thay adapter này. */
export class NoopTaskAlertNotifier implements TaskAlertNotifier {
  private readonly _logger = new Logger('TaskAlert');

  taskDied(record: TaskRecord, reason: string) {
    this._logger.warn(`publisher ${record.spec.taskId} đã chết: ${reason}`);
    return Promise.resolve();
  }
}
