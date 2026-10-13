import type { TaskSupervisor } from '../../tasks/application/task-supervisor.js';
import type { NodeView } from '../../tasks/application/node-directory.js';
import type { ConsumerView } from '../../odds/application/consumer-control.js';
import type { ArbitrageStats } from '../../odds/application/queries/get-arbitrage-stats.query.js';
import type { LaneStats } from '../../odds/application/lane-dispatcher.js';
import type { ArbitrageSettings } from '../../odds/application/arbitrage-settings.js';
import type { IngestSnapshot } from '../../odds/application/ingest-stats.js';

export type TaskView = Awaited<ReturnType<TaskSupervisor['list']>>[number];

/**
 * Mọi thứ admin cần ĐỌC từ các module khác, gom vào một chỗ
 * (composition root nối vào lớp application của tasks/odds).
 */
export interface AdminSources {
  tasks(): Promise<TaskView[]>;
  nodes(): NodeView[];
  consumers(): ConsumerView[];
  arbitrage(): Promise<ArbitrageStats>;
  lanes(): Promise<LaneStats[]>;
  settings(): Promise<ArbitrageSettings>;
  /** Bộ đếm theo chặng của luồng ingest. */
  ingest(): Promise<IngestSnapshot>;
}

export const ADMIN_SOURCES = Symbol('ADMIN_SOURCES');
