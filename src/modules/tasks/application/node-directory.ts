/** Một node task-runner (microservice) app từng thấy trong lần chạy này. */
export interface NodeView {
  readonly nodeId: string;
  readonly connected: boolean;
  readonly connectedAt: number | null;
  readonly disconnectedAt: number | null;
  /** Số task đang chạy trên node. */
  readonly tasks: number;
}

export type NodeChange =
  | { readonly type: 'connected'; readonly nodeId: string }
  | {
      readonly type: 'disconnected';
      readonly nodeId: string;
      readonly affectedTasks: readonly string[];
    };

/** Port: danh sách node + thông báo khi node kết nối / mất kết nối. */
export interface NodeDirectory {
  list(): NodeView[];
  onChange(listener: (change: NodeChange) => void): void;
}

export const NODE_DIRECTORY = Symbol('NODE_DIRECTORY');
