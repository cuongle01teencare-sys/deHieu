import type { DomainEvent } from '../../../../shared/domain/domain-event.js';
import type { ArbitrageSignal } from '../arbitrage-signal.js';
import type { CancelReason } from '../signal-policy.js';

export class ArbitrageSignalIssued implements DomainEvent {
  readonly name = 'arbitrage.signal.issued' as const;
  constructor(
    public readonly signal: ArbitrageSignal,
    /** Kèo cũ cùng tổ hợp bị kèo này ghi đè — consumer thay thế, KHÔNG phải hủy. */
    public readonly supersedes: string | null = null,
    public readonly occurredAt: Date = new Date(),
  ) {}
}

/** Kèo còn nguyên sau thời hạn → phát lại cùng signalId, expiresAt mới. */
export class ArbitrageSignalRefreshed implements DomainEvent {
  readonly name = 'arbitrage.signal.refreshed' as const;
  constructor(
    public readonly signal: ArbitrageSignal,
    public readonly occurredAt: Date = new Date(),
  ) {}
}

export class ArbitrageSignalCancelled implements DomainEvent {
  readonly name = 'arbitrage.signal.cancelled' as const;
  constructor(
    public readonly signalId: string,
    public readonly room: string,
    public readonly comboId: string,
    public readonly reason: CancelReason,
    public readonly occurredAt: Date = new Date(),
  ) {}
}

export type ArbitrageSignalEvent =
  ArbitrageSignalIssued | ArbitrageSignalRefreshed | ArbitrageSignalCancelled;
