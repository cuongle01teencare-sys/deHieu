import type { ArbitrageSignal } from '../domain/arbitrage-signal.js';

export type ConsumerRole = 'discord' | 'trader' | 'other';

export interface ConsumerView {
  readonly consumerId: string;
  readonly role: ConsumerRole;
  readonly connected: boolean;
  readonly paused: boolean;
  readonly pending: number;
  readonly lastSeenAt: number;
}

export interface ConsumerHubStats {
  /** Số kèo đang sống trong hub (chưa hủy, chưa hết hạn). */
  readonly activeSignals: number;
  /** Tổng số frame đang chờ ack trên mọi consumer. */
  readonly pendingDeliveries: number;
  readonly signals: readonly ArbitrageSignal[];
  readonly consumers: readonly ConsumerView[];
}

/** Port: xem/điều khiển consumer (dừng gửi Discord, dừng auto-trade...). */
export interface ConsumerControl {
  list(): ConsumerView[];
  stats(): ConsumerHubStats;
  control(consumerId: string, action: 'pause' | 'resume'): boolean;
}

export const CONSUMER_CONTROL = Symbol('CONSUMER_CONTROL');
