export interface RestartPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxConsecutiveFailures: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxConsecutiveFailures: 5,
};

/**
 * Lần thất bại thứ n (bắt đầu từ 1) → độ trễ trước khi khởi động lại.
 * Trả về null khi đã vượt ngưỡng: chuyển FAILED và chờ admin.
 */
export const nextRestartDelay = (
  failures: number,
  policy: RestartPolicy = DEFAULT_RESTART_POLICY,
): number | null => {
  if (failures > policy.maxConsecutiveFailures) return null;
  return Math.min(policy.baseDelayMs * 2 ** (failures - 1), policy.maxDelayMs);
};
