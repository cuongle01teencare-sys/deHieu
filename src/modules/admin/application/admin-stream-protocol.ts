import type { OpsEvent } from '../../../shared/application/ops-event-bus.js';
import type { AdminMetrics } from './metrics-sampler.js';
import type { AdminSnapshot } from './queries/get-admin-snapshot.query.js';

/**
 * Giao thức WebSocket của dashboard admin (JSON mỗi frame).
 *
 * client → app:
 *   hello       { token, topics? }       — bắt buộc trong 10s đầu; topics mặc định = DEFAULT_TOPICS
 *   subscribe   { topics }               — thêm topic (vd 'room:room:cs2:a~b:game-winner')
 *   unsubscribe { topics }
 *   ping
 * app → client:
 *   welcome     { principal, topics }    — kèm ngay sau đó là `snapshot`
 *   rejected    { reason }               — sai token / thiếu quyền admin:read
 *   snapshot    { data }                 — toàn cảnh (gửi lại khi client gửi 'resync')
 *   event       { event }                — sự kiện theo topic đã subscribe
 *   metrics     { data }                 — số liệu gộp mỗi ~2s (topic 'metrics')
 *   room        { room, data }           — ảnh chụp room ngay khi subscribe 'room:{id}'
 *   error       { message }
 *   pong
 */
export const ADMIN_TOPICS = [
  'alerts',
  'tasks',
  'nodes',
  'consumers',
  'signals',
  'odds',
  'audit',
  'metrics',
] as const;

export const DEFAULT_TOPICS: readonly string[] = [
  'alerts',
  'tasks',
  'nodes',
  'consumers',
  'metrics',
];

export const ROOM_TOPIC_PREFIX = 'room:';
export const MAX_ROOM_TOPICS = 20;

export type AdminClientFrame =
  | { type: 'hello'; token: string; topics?: string[] }
  | { type: 'subscribe'; topics: string[] }
  | { type: 'unsubscribe'; topics: string[] }
  | { type: 'resync' }
  | { type: 'ping' };

export type AdminServerFrame =
  | {
      type: 'welcome';
      principal: { id: string; roles: readonly string[] };
      topics: string[];
    }
  | { type: 'rejected'; reason: string }
  | { type: 'snapshot'; data: AdminSnapshot }
  | { type: 'event'; event: OpsEvent }
  | { type: 'metrics'; data: AdminMetrics }
  | { type: 'room'; room: string; data: unknown }
  | { type: 'error'; message: string }
  | { type: 'pong' };
