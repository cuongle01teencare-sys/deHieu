export type TaskState =
  | 'CREATED'
  | 'INITIALIZING'
  | 'READY'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'RESTARTING'
  | 'FAILED';

// Admin dừng được task ở mọi trạng thái đang sống (kể cả lúc đang khởi tạo):
// có kết nối → STOPPING → STOPPED, chưa có kết nối → STOPPED ngay.
const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  CREATED: ['INITIALIZING', 'FAILED', 'STOPPED'],
  INITIALIZING: ['READY', 'FAILED', 'RESTARTING', 'STOPPING', 'STOPPED'],
  READY: ['STARTING', 'STOPPING', 'FAILED', 'RESTARTING'],
  STARTING: ['RUNNING', 'FAILED', 'RESTARTING', 'STOPPING'],
  RUNNING: ['STOPPING', 'FAILED', 'RESTARTING'],
  STOPPING: ['STOPPED', 'FAILED'],
  STOPPED: [],
  RESTARTING: ['INITIALIZING', 'FAILED', 'STOPPED'],
  FAILED: ['INITIALIZING'], // admin khởi động lại thủ công
};

export const canTransition = (from: TaskState, to: TaskState): boolean =>
  TRANSITIONS[from].includes(to);

/** Trạng thái coi như task đang "sống" — start lần nữa sẽ bị từ chối. */
export const isActive = (s: TaskState): boolean =>
  !['STOPPED', 'FAILED'].includes(s);
