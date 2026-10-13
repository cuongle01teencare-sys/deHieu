import type { QueryHandler } from '../../../../shared/application/cqrs.js';
import type { IngestSnapshot, IngestStats } from '../ingest-stats.js';

/** Bộ đếm theo chặng của luồng ingest (tenant × kind). */
export class GetIngestStatsHandler implements QueryHandler<
  void,
  IngestSnapshot
> {
  constructor(private readonly _stats: IngestStats) {}

  execute(): Promise<IngestSnapshot> {
    return Promise.resolve(this._stats.snapshot());
  }
}
