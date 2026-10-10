import { EventEmitter } from 'node:events';
import type { EventPublisher } from '../../../../shared/application/event-publisher.js';
import type { DomainEvent } from '../../../../shared/domain/domain-event.js';

/** Dev/test: phát sự kiện trong tiến trình. Nghe bằng .on(name, handler). */
export class InMemoryEventPublisher
  extends EventEmitter
  implements EventPublisher
{
  publish(events: readonly DomainEvent[]): Promise<void> {
    for (const e of events) {
      const name = (e as { name?: string }).name ?? e.constructor.name;
      this.emit(name, e);
      this.emit('*', e);
    }
    return Promise.resolve();
  }
}
