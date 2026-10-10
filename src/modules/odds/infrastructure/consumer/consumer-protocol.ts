import type { ArbitrageSignal } from '../../domain/arbitrage-signal.js';
import type { CancelReason } from '../../domain/signal-policy.js';

export const CONSUMER_PROTOCOL_VERSION = 1 as const;

import type { ConsumerRole } from '../../application/consumer-control.js';

export type { ConsumerRole };

/**
 *   consumer → hello {consumerId, role, token}   app → welcome | rejected
 *   app → signal {deliveryId,...}                 consumer → ack {deliveryId}
 *   app → cancel {deliveryId,...}                 consumer → ack {deliveryId}
 *   app → control {pause|resume}                  consumer → paused | resumed
 *   hai chiều: heartbeat
 * Giao "ít nhất một lần": app gửi lại tới khi có ack (kèo: tới expiresAt).
 * Consumer bỏ bản trùng theo deliveryId / signalId.
 */
export type ConsumerToAppFrame =
  | {
      readonly type: 'hello';
      readonly v: typeof CONSUMER_PROTOCOL_VERSION;
      readonly consumerId: string;
      readonly role: ConsumerRole;
      readonly token: string;
    }
  | { readonly type: 'ack'; readonly deliveryId: string }
  | { readonly type: 'paused' }
  | { readonly type: 'resumed' }
  | { readonly type: 'heartbeat'; readonly at: number };

export type AppToConsumerFrame =
  | { readonly type: 'welcome'; readonly paused: boolean }
  | { readonly type: 'rejected'; readonly reason: string }
  | {
      readonly type: 'signal';
      readonly deliveryId: string;
      readonly kind: 'issued' | 'refreshed';
      readonly signal: ArbitrageSignal;
      /** Kèo cũ cùng tổ hợp mà kèo này ghi đè (không có lệnh cancel riêng cho nó). */
      readonly supersedes?: string;
    }
  | {
      readonly type: 'cancel';
      readonly deliveryId: string;
      readonly signalId: string;
      readonly room: string;
      readonly comboId: string;
      readonly reason: CancelReason;
    }
  | { readonly type: 'control'; readonly action: 'pause' | 'resume' }
  | { readonly type: 'heartbeat'; readonly at: number };
