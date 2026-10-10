/** Nơi một task (publisher) chạy. Cùng contract Task, khác transport. */
export type TaskRuntimeTarget =
  | { readonly type: 'worker' }
  | { readonly type: 'remote'; readonly nodeId: string };

/**
 * Mô tả một instance task. Tham số (url, intervalMs...) truyền lúc tạo,
 * không hardcode trong implementation.
 */
export interface TaskSpec<TParams = Record<string, unknown>> {
  readonly taskId: string;
  readonly tenant: string; // nguồn dữ liệu: 'sptpub' | 'polymarket' | ...
  readonly kind: string; // vd 'sptpub.feed', 'polymarket.market-stream'
  readonly params: TParams;
  readonly runtime: TaskRuntimeTarget;
}
