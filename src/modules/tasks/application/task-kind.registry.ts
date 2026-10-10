/** Một loại task mà app biết chạy. */
export interface TaskKindInfo {
  readonly kind: string;
  readonly tenant: string;
}

/** Port: kind → tenant. App dùng để tự suy tenant thay vì tin dữ liệu người gọi gửi lên. */
export interface TaskKindRegistry {
  find(kind: string): TaskKindInfo | null;
  list(): TaskKindInfo[];
}

export const TASK_KIND_REGISTRY = Symbol('TASK_KIND_REGISTRY');
