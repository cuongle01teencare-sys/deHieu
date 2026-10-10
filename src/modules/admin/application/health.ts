/** Port: kiểm tra một phụ thuộc hạ tầng (Dragonfly/Redis, Postgres...). Ném lỗi = không khỏe. */
export interface HealthProbe {
  readonly name: string;
  check(): Promise<void>;
}

export const HEALTH_PROBES = Symbol('HEALTH_PROBES');

export interface HealthResult {
  readonly name: string;
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error: string | null;
  readonly checkedAt: number;
}

/** Chạy mọi probe (song song, có timeout) và nhớ kết quả gần nhất. */
export class HealthMonitor {
  private _latest: HealthResult[] = [];

  constructor(
    private readonly _probes: readonly HealthProbe[],
    private readonly _timeoutMs = 3_000,
    private readonly _now: () => number = Date.now,
  ) {}

  latest(): HealthResult[] {
    return this._latest;
  }

  async check(): Promise<HealthResult[]> {
    this._latest = await Promise.all(this._probes.map((p) => this._run(p)));
    return this._latest;
  }

  private async _run(p: HealthProbe): Promise<HealthResult> {
    const started = this._now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        p.check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`TIMEOUT sau ${this._timeoutMs}ms`)),
            this._timeoutMs,
          );
        }),
      ]);
      return {
        name: p.name,
        ok: true,
        latencyMs: this._now() - started,
        error: null,
        checkedAt: this._now(),
      };
    } catch (e: unknown) {
      return {
        name: p.name,
        ok: false,
        latencyMs: this._now() - started,
        error: e instanceof Error ? e.message : String(e),
        checkedAt: this._now(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
