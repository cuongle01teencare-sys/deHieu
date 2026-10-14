import type { TaskSupervisor } from '../../../tasks/application/task-supervisor.js';
import type {
  RunningTrader,
  TraderTaskGateway,
} from '../../application/trading.ports.js';
import type { TraderRuntimeConfig } from '../../application/trader-config.js';
import { TRADER_TASK_KIND } from '../../application/trader-data.handler.js';

/** Task trader chạy dưới TaskSupervisor (worker thread hoặc node từ xa); cấu hình gửi bằng lệnh 'config'. */
export class SupervisorTraderTaskGateway implements TraderTaskGateway {
  constructor(private readonly _supervisor: TaskSupervisor) {}

  async listRunning(): Promise<RunningTrader[]> {
    return (await this._supervisor.list()).flatMap((t) => {
      const profileId = (t.spec.params as { profileId?: unknown }).profileId;
      return t.spec.kind === TRADER_TASK_KIND &&
        t.state === 'RUNNING' &&
        typeof profileId === 'string'
        ? [{ taskId: t.spec.taskId, profileId }]
        : [];
    });
  }

  async push(taskId: string, config: TraderRuntimeConfig): Promise<boolean> {
    const r = await this._supervisor.command(taskId, 'config', config);
    return r.status === 'SUCEED';
  }
}
