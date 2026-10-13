/** Một loại task mà app biết chạy. */
export interface TaskKindInfo {
  readonly kind: string;
  readonly tenant: string;
  /** Cho phép nhiều instance cùng kind chạy song song. */
  readonly multiInstance: boolean;
  /** JSON Schema của params (để xem trong /tasks/kinds). */
  readonly paramsSchema?: unknown;
}

export type ParamsValidation =
  | { readonly ok: true; readonly params: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };

/** Port: kind → tenant. App dùng để tự suy tenant thay vì tin dữ liệu người gọi gửi lên. */
export interface TaskKindRegistry {
  find(kind: string): TaskKindInfo | null;
  list(): TaskKindInfo[];
  /** Kiểm tra params theo kind; trả params đã điền mặc định. */
  validateParams(kind: string, params: unknown): ParamsValidation;
}

export const TASK_KIND_REGISTRY = Symbol('TASK_KIND_REGISTRY');
