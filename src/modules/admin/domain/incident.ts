export type IncidentSeverity = 'warning' | 'critical';

/**
 * Sự cố vận hành (mức 1). Định danh bằng `key` ổn định, vd 'source.stale:sptpub-live',
 * nên cùng một sự cố chỉ mở một lần cho tới khi hết.
 */
export interface Incident {
  readonly id: string;
  readonly key: string;
  /** Loại: task.failed | task.flapping | source.stale | node.down | infra.down | consumer.down | consumer.backlog | lane.backlog | odds.mass_removal */
  readonly kind: string;
  readonly severity: IncidentSeverity;
  readonly title: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly openedAt: number;
  readonly lastSeenAt: number;
  readonly resolvedAt: number | null;
  /** Vì sao đóng: recovered | app_restart | ... */
  readonly resolution: string | null;
  readonly acknowledgedAt: number | null;
  readonly acknowledgedBy: string | null;
}

/** Thông tin để mở (hoặc giữ mở) một sự cố. */
export interface IncidentSignal {
  readonly kind: string;
  readonly severity: IncidentSeverity;
  readonly title: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
