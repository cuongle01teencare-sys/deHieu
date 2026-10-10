import { Logger } from '@nestjs/common';
import type { AlertNotifier } from '../../application/alert-notifier.js';
import type { Incident } from '../../domain/incident.js';

/** Mặc định khi chưa cấu hình kênh ngoài: chỉ ghi log. */
export class LogAlertNotifier implements AlertNotifier {
  private readonly _logger = new Logger('Alerts');

  notify(change: 'opened' | 'resolved', i: Incident): Promise<void> {
    if (change === 'resolved')
      this._logger.log(
        `ĐÃ HẾT [${i.kind}] ${i.title} (${i.resolution ?? 'recovered'})`,
      );
    else if (i.severity === 'critical')
      this._logger.error(`[${i.kind}] ${i.title} — ${i.message}`);
    else this._logger.warn(`[${i.kind}] ${i.title} — ${i.message}`);
    return Promise.resolve();
  }
}
