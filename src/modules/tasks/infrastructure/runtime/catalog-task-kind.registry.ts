import { z } from 'zod';
import type {
  ParamsValidation,
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
      paramsSchema: z.toJSONSchema(e.params, { io: 'input' }),
    }));
  }

  validateParams(kind: string, params: unknown): ParamsValidation {
    const e = this._catalog[kind];
    if (!e) return { ok: false, error: `UNKNOWN_KIND: ${kind}` };
    const r = e.params.safeParse(params);
    return r.success
      ? { ok: true, params: r.data }
      : { ok: false, error: z.prettifyError(r.error) };
  }
}
