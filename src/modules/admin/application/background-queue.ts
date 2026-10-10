type Job = () => Promise<void>;

/**
 * Hàng đợi chạy nền tuần tự: push() trả về ngay, DB chậm/lỗi không làm trễ luồng chính.
 * Giới hạn kích thước; đầy thì bỏ việc cũ nhất (đếm vào `dropped`).
 */
export class BackgroundQueue {
  private readonly _jobs: Job[] = [];
  private _running = false;
  private _dropped = 0;

  constructor(
    private readonly _onError: (e: unknown) => void = () => undefined,
    private readonly _max = 10_000,
  ) {}

  push(job: Job): void {
    if (this._jobs.length >= this._max) {
      this._jobs.shift();
      this._dropped++;
    }
    this._jobs.push(job);
    void this._drain();
  }

  async flush(): Promise<void> {
    while (this._running || this._jobs.length)
      await new Promise((r) => setTimeout(r, 5));
  }

  stats() {
    return { queued: this._jobs.length, dropped: this._dropped };
  }

  private async _drain() {
    if (this._running) return;
    this._running = true;
    try {
      for (let job = this._jobs.shift(); job; job = this._jobs.shift()) {
        try {
          await job();
        } catch (e: unknown) {
          this._onError(e);
        }
      }
    } finally {
      this._running = false;
    }
  }
}
