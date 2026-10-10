import type { Task, TaskContext } from '../../application/task.js';
import { getJson, sleep } from '../shared/abortable.js';
import { sptpubUrl, type SptPubEndpoint } from './sptpub-url.js';

export interface SptPubDescriptorParams extends SptPubEndpoint {
  readonly intervalMs: number; // đề xuất 60_000
}

/**
 * GET /api/v3/descriptions/brand/{brandId}/markets/{lang} mỗi intervalMs.
 * emit(payload thô, 'markets'). Lỗi mạng → thử lại ở vòng sau, không làm chết task.
 */
export class SptPubDescriptorTask implements Task<SptPubDescriptorParams> {
  async run(ctx: TaskContext<SptPubDescriptorParams>): Promise<void> {
    const p = ctx.params;
    const url = sptpubUrl(
      p,
      `api/v3/descriptions/brand/${p.brandId}/markets/${p.lang}`,
    );

    while (!ctx.signal.aborted) {
      try {
        ctx.emit(await getJson(url, ctx.signal, 30_000), 'markets');
      } catch (e: unknown) {
        if (ctx.signal.aborted) return; // lỗi tạm thời: vòng sau thử lại
        ctx.warn(e);
      }
      await sleep(p.intervalMs, ctx.signal);
    }
  }
}
