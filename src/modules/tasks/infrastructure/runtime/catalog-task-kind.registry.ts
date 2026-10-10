import type {
  TaskKindInfo,
  TaskKindRegistry,
} from '../../application/task-kind.registry.js';
import type { TaskCatalogEntry } from './task-catalog.js';

export class CatalogTaskKindRegistry implements TaskKindRegistry {
  constructor(
    private readonly _catalog: Readonly<Record<string, TaskCatalogEntry>>,
  ) {}

  find(kind: string): TaskKindInfo | null {
    const e = this._catalog[kind];
    return e ? { kind, tenant: e.tenant } : null;
  }

  list(): TaskKindInfo[] {
    return Object.entries(this._catalog).map(([kind, e]) => ({
      kind,
      tenant: e.tenant,
    }));
  }
}
