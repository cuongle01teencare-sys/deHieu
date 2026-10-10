import type { DomainEvent } from '../domain/domain-event.js';
import type { EventPublisher } from './event-publisher.js';

/** Phát cùng một lô sự kiện tới nhiều nơi, theo thứ tự (vd gửi consumer trước, ghi lịch sử sau). */
export class CompositeEventPublisher implements EventPublisher {
  constructor(private readonly _targets: readonly EventPublisher[]) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const t of this._targets) await t.publish(events);
  }
}
