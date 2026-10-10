import type { EventPublisher } from '../../../shared/application/event-publisher.js';
import type { OpsEventBus } from '../../../shared/application/ops-event-bus.js';
import type { DomainEvent } from '../../../shared/domain/domain-event.js';
import {
  ArbitrageSignalCancelled,
  ArbitrageSignalIssued,
  ArbitrageSignalRefreshed,
} from '../domain/events/arbitrage-signal.events.js';

/** Chuyển domain event của kèo thành sự kiện vận hành (topic 'signals') cho admin. */
export class OpsSignalRelay implements EventPublisher {
  constructor(private readonly _ops: OpsEventBus) {}

  publish(events: readonly DomainEvent[]): Promise<void> {
    for (const e of events) {
      const at = e.occurredAt.getTime();
      if (
        e instanceof ArbitrageSignalIssued ||
        e instanceof ArbitrageSignalRefreshed
      ) {
        const s = e.signal;
        this._ops.publish({
          type:
            e instanceof ArbitrageSignalIssued
              ? 'signal.issued'
              : 'signal.refreshed',
          topic: 'signals',
          at,
          data: {
            signalId: s.signalId,
            room: s.room,
            comboId: s.comboId,
            phase: s.phase,
            margin: s.margin,
            ...(e instanceof ArbitrageSignalIssued
              ? { supersedes: e.supersedes }
              : {}),
          },
        });
      } else if (e instanceof ArbitrageSignalCancelled) {
        this._ops.publish({
          type: 'signal.cancelled',
          topic: 'signals',
          at,
          data: {
            signalId: e.signalId,
            room: e.room,
            comboId: e.comboId,
            reason: e.reason,
          },
        });
      }
    }
    return Promise.resolve();
  }
}
