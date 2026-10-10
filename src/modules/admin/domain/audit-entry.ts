/** Một hành động thay đổi hệ thống qua API (mức 3). */
export interface AuditEntry {
  readonly id: string;
  readonly at: number;
  readonly principalId: string | null;
  readonly roles: readonly string[];
  readonly method: string;
  /** Route mẫu, vd /tasks/:taskId/stop */
  readonly route: string;
  readonly path: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** Body đã che trường nhạy cảm và cắt ngắn. */
  readonly body: unknown;
  readonly ok: boolean;
  readonly status: number;
  readonly error: string | null;
  readonly durationMs: number;
}
