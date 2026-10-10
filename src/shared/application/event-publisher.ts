import type { DomainEvent } from '../domain/domain-event.js';

/** Port: phát sự kiện ra ngoài. Adapter: in-memory (dev/test), WS consumer hub, Redis... */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
