import type { AlertNotifier } from '../../application/alert-notifier.js';
import type { Incident } from '../../domain/incident.js';

/** Gửi tới nhiều kênh; kênh này lỗi không ảnh hưởng kênh kia. */
export class CompositeAlertNotifier implements AlertNotifier {
  constructor(private readonly _all: readonly AlertNotifier[]) {}

  async notify(change: 'opened' | 'resolved', i: Incident): Promise<void> {
    await Promise.allSettled(this._all.map((n) => n.notify(change, i)));
  }
}
