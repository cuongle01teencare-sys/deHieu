import type { HealthResult } from './health.js';
import type { IncidentTracker } from './incident-tracker.js';

/** Những gì watchdog cần biết về một task (không phụ thuộc kiểu nội bộ của module tasks). */
export interface WatchedTask {
  readonly taskId: string;
  readonly kind: string;
  readonly state: string;
  readonly consecutiveFailures: number;
  readonly lastDataAt: number | null;
  readonly lastError: string | null;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface WatchedNode {
  readonly nodeId: string;
  readonly connected: boolean;
  readonly disconnectedAt: number | null;
}

export interface WatchedConsumer {
  readonly consumerId: string;
  readonly role: string;
  readonly connected: boolean;
  readonly pending: number;
}

export interface WatchedLane {
  readonly lane: string;
  readonly queued: number;
}

export interface WatchdogSources {
  tasks(): Promise<readonly WatchedTask[]>;
  nodes(): readonly WatchedNode[];
  consumers(): readonly WatchedConsumer[];
  lanes(): readonly WatchedLane[];
  health(): readonly HealthResult[];
}

export interface WatchdogOptions {
  /** Task RUNNING mà im lặng quá ngưỡng này → source.stale. */
  readonly staleAfterMs: (task: WatchedTask) => number;
  readonly flappingFailures: number;
  /** Node rớt quá lâu hơn ngưỡng này mới báo (bỏ qua chớp mạng). */
  readonly nodeGraceMs: number;
  readonly consumerGraceMs: number;
  readonly consumerBacklog: number;
  readonly laneBacklog: number;
}

/** Ngưỡng im lặng mặc định: 5× chu kỳ poll (≥ 30s); stream không có chu kỳ → 15 phút. */
export const defaultStaleAfterMs = (t: WatchedTask): number => {
  const interval = t.params['intervalMs'];
  if (typeof interval === 'number' && interval > 0)
    return Math.max(interval * 5, 30_000);
  if (t.kind.endsWith('.stream')) return 15 * 60_000;
  return 2 * 60_000;
};

export const DEFAULT_WATCHDOG_OPTIONS: WatchdogOptions = {
  staleAfterMs: defaultStaleAfterMs,
  flappingFailures: 3,
  nodeGraceMs: 15_000,
  consumerGraceMs: 30_000,
  consumerBacklog: 50,
  laneBacklog: 1_000,
};

const ACTIVE = new Set([
  'CREATED',
  'INITIALIZING',
  'READY',
  'STARTING',
  'RUNNING',
  'RESTARTING',
]);

/**
 * Kiểm tra định kỳ (mỗi vài giây) và mở/đóng sự cố mức 1.
 * Dựa trên trạng thái hiện tại chứ không trên sự kiện → không lỡ sự cố dù sự kiện bị mất.
 */
export class OpsWatchdog {
  /** taskId → lúc thấy RUNNING lần đầu (mốc im lặng khi chưa có dữ liệu). */
  private readonly _runningSince = new Map<string, number>();
  private readonly _consumerDownSince = new Map<string, number>();

  constructor(
    private readonly _src: WatchdogSources,
    private readonly _incidents: IncidentTracker,
    private readonly _opts: WatchdogOptions = DEFAULT_WATCHDOG_OPTIONS,
    private readonly _now: () => number = Date.now,
  ) {}

  async tick(): Promise<void> {
    const now = this._now();
    await this._checkTasks(now);
    this._checkNodes(now);
    this._checkConsumers(now);
    this._checkLanes();
    this._checkHealth();
  }

  private async _checkTasks(now: number) {
    const tasks = await this._src.tasks();
    const alive = new Set(tasks.map((t) => t.taskId));

    for (const t of tasks) {
      const who = `${t.taskId} (${t.kind})`;

      // 1) chết hẳn
      const failedKey = `task.failed:${t.taskId}`;
      if (t.state === 'FAILED')
        this._incidents.raise(failedKey, {
          kind: 'task.failed',
          severity: 'critical',
          title: `Publisher chết: ${who}`,
          message: `Hết lượt khởi động lại sau ${t.consecutiveFailures} lần. Lỗi cuối: ${t.lastError ?? 'không rõ'}`,
          details: { taskId: t.taskId, kind: t.kind },
        });
      else this._incidents.clear(failedKey);

      // 2) chập chờn
      const flapKey = `task.flapping:${t.taskId}`;
      if (
        ACTIVE.has(t.state) &&
        t.consecutiveFailures >= this._opts.flappingFailures
      )
        this._incidents.raise(flapKey, {
          kind: 'task.flapping',
          severity: 'warning',
          title: `Publisher chập chờn: ${who}`,
          message: `${t.consecutiveFailures} lần lỗi liên tiếp. Lỗi cuối: ${t.lastError ?? 'không rõ'}`,
          details: { taskId: t.taskId, kind: t.kind },
        });
      else
        this._incidents.clear(
          flapKey,
          t.state === 'FAILED' ? 'escalated_to_failed' : 'recovered',
        );

      // 3) chạy mà im lặng
      const staleKey = `source.stale:${t.taskId}`;
      if (t.state === 'RUNNING') {
        if (!this._runningSince.has(t.taskId))
          this._runningSince.set(t.taskId, now);
        const since = Math.max(
          t.lastDataAt ?? 0,
          this._runningSince.get(t.taskId) ?? now,
        );
        const silentMs = now - since;
        const limit = this._opts.staleAfterMs(t);
        if (silentMs > limit)
          this._incidents.raise(staleKey, {
            kind: 'source.stale',
            severity: 'critical',
            title: `Nguồn im lặng: ${who}`,
            message: `RUNNING nhưng ${Math.round(silentMs / 1000)}s không có dữ liệu (ngưỡng ${Math.round(limit / 1000)}s).${t.lastError ? ` Lỗi gần nhất: ${t.lastError}` : ''}`,
            details: {
              taskId: t.taskId,
              kind: t.kind,
              silentMs,
              lastDataAt: t.lastDataAt,
            },
          });
        else this._incidents.clear(staleKey);
      } else {
        this._runningSince.delete(t.taskId);
        this._incidents.clear(staleKey, 'task_not_running');
      }
    }

    // task đã bị xóa → đóng mọi sự cố của nó
    for (const key of this._incidents.openKeys()) {
      const m = /^(task\.failed|task\.flapping|source\.stale):(.+)$/.exec(key);
      if (m?.[2] && !alive.has(m[2])) {
        this._runningSince.delete(m[2]);
        this._incidents.clear(key, 'task_removed');
      }
    }
  }

  private _checkNodes(now: number) {
    for (const n of this._src.nodes()) {
      const key = `node.down:${n.nodeId}`;
      const downFor = n.disconnectedAt === null ? 0 : now - n.disconnectedAt;
      if (!n.connected && downFor >= this._opts.nodeGraceMs)
        this._incidents.raise(key, {
          kind: 'node.down',
          severity: 'critical',
          title: `Node mất kết nối: ${n.nodeId}`,
          message: `Mất kết nối ${Math.round(downFor / 1000)}s. Các task remote trên node này đã dừng.`,
          details: { nodeId: n.nodeId, disconnectedAt: n.disconnectedAt },
        });
      else if (n.connected) this._incidents.clear(key);
    }
  }

  private _checkConsumers(now: number) {
    for (const c of this._src.consumers()) {
      const downKey = `consumer.down:${c.consumerId}`;
      if (c.connected) {
        this._consumerDownSince.delete(c.consumerId);
        this._incidents.clear(downKey);
      } else {
        const since = this._consumerDownSince.get(c.consumerId) ?? now;
        this._consumerDownSince.set(c.consumerId, since);
        if (now - since >= this._opts.consumerGraceMs)
          this._incidents.raise(downKey, {
            kind: 'consumer.down',
            severity: c.role === 'trader' ? 'critical' : 'warning',
            title: `Consumer mất kết nối: ${c.consumerId} (${c.role})`,
            message: `Mất kết nối ${Math.round((now - since) / 1000)}s; ${c.pending} kèo đang chờ giao.`,
            details: { consumerId: c.consumerId, role: c.role },
          });
      }

      const backlogKey = `consumer.backlog:${c.consumerId}`;
      if (c.pending >= this._opts.consumerBacklog)
        this._incidents.raise(backlogKey, {
          kind: 'consumer.backlog',
          severity: 'warning',
          title: `Consumer tồn đọng: ${c.consumerId}`,
          message: `${c.pending} kèo chưa được ack (ngưỡng ${this._opts.consumerBacklog}).`,
          details: { consumerId: c.consumerId, pending: c.pending },
        });
      else this._incidents.clear(backlogKey);
    }
  }

  private _checkLanes() {
    for (const l of this._src.lanes()) {
      const key = `lane.backlog:${l.lane}`;
      if (l.queued >= this._opts.laneBacklog)
        this._incidents.raise(key, {
          kind: 'lane.backlog',
          severity: 'warning',
          title: `Làn xử lý bị dồn: ${l.lane}`,
          message: `${l.queued} cập nhật đang chờ (ngưỡng ${this._opts.laneBacklog}).`,
          details: { lane: l.lane, queued: l.queued },
        });
      else this._incidents.clear(key);
    }
  }

  private _checkHealth() {
    for (const h of this._src.health()) {
      const key = `infra.down:${h.name}`;
      if (!h.ok)
        this._incidents.raise(key, {
          kind: 'infra.down',
          severity: 'critical',
          title: `Hạ tầng lỗi: ${h.name}`,
          message: h.error ?? 'không phản hồi',
          details: { name: h.name },
        });
      else this._incidents.clear(key);
    }
  }
}
