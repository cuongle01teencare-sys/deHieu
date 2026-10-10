/**
 * CONTRACT CHUNG cho mọi publisher. Cùng một implementation chạy được trong
 * worker thread lẫn microservice — task không biết mình đang ở đâu, cũng không
 * biết store/nghiệp vụ: chỉ lấy dữ liệu và emit dữ liệu thô.
 */
export interface TaskContext<TParams = unknown> {
  readonly taskId: string;
  readonly tenant: string;
  readonly params: Readonly<TParams>;
  /** Bị abort khi app gửi `stop`. run() phải kết thúc sau khi signal abort. */
  readonly signal: AbortSignal;
  /** Gửi dữ liệu thô về app. `channel` tùy chọn để ACL phân loại (vd 'snapshot', 'delta'). */
  emit(payload: unknown, channel?: string): void;
  /** Lệnh điều khiển từ app trong lúc chạy, vd subscribe/unsubscribe assetIds. */
  onCommand(handler: TaskCommandHandler): void;
}

export type TaskCommandHandler = (
  name: string,
  data: unknown,
) => void | Promise<void>;

export interface Task<TParams = unknown> {
  /** Chạy tới khi ctx.signal bị abort. Ném lỗi = task chết, app sẽ khởi động lại. */
  run(ctx: TaskContext<TParams>): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mỗi task có kiểu params riêng
export type TaskFactory = () => Task<any>;
