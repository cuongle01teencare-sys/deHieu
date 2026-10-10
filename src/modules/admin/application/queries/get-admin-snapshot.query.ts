import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { Incident } from '../../domain/incident.js';
import type { AdminSources } from '../admin-sources.js';
import type { HealthMonitor, HealthResult } from '../health.js';
import type { IncidentTracker } from '../incident-tracker.js';

export type GetAdminSnapshotQuery = Record<string, never>;

export interface AdminSnapshot {
  readonly at: number;
  readonly incidents: readonly Incident[];
  readonly health: readonly HealthResult[];
  readonly tasks: Awaited<ReturnType<AdminSources['tasks']>>;
  readonly nodes: ReturnType<AdminSources['nodes']>;
  readonly consumers: ReturnType<AdminSources['consumers']>;
  readonly arbitrage: Awaited<ReturnType<AdminSources['arbitrage']>>;
  readonly lanes: Awaited<ReturnType<AdminSources['lanes']>>;
  readonly settings: Awaited<ReturnType<AdminSources['settings']>>;
}

/** Toàn cảnh một lần (mở dashboard / kết nối stream). */
export class GetAdminSnapshotHandler implements QueryHandler<
  GetAdminSnapshotQuery,
  AdminSnapshot
> {
  constructor(
    private readonly _src: AdminSources,
    private readonly _incidents: IncidentTracker,
    private readonly _health: HealthMonitor,
    private readonly _now: () => number = Date.now,
  ) {}

  async execute(): Promise<AdminSnapshot> {
    const [tasks, arbitrage, lanes, settings] = await Promise.all([
      this._src.tasks(),
      this._src.arbitrage(),
      this._src.lanes(),
      this._src.settings(),
    ]);
    return {
      at: this._now(),
      incidents: this._incidents.open(),
      health: this._health.latest(),
      tasks,
      nodes: this._src.nodes(),
      consumers: this._src.consumers(),
      arbitrage,
      lanes,
      settings,
    };
  }
}
