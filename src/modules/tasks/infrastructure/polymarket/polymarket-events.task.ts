import { createPublicClient } from '@polymarket/client';
import {
  polymarketEnvironment,
  type PolymarketEndpoints,
} from './polymarket-environment.js';
import type { Task, TaskContext } from '../../application/task.js';
import { sleep } from '../shared/abortable.js';

export interface PolymarketEventsParams {
  /** Tag của gamma, vd [100639] (esports). */
  readonly tagIds: readonly number[];
  readonly intervalMs: number; // vd 30_000
  /** true = chỉ trận đang live. Bỏ trống = cả sắp diễn ra. */
  readonly live?: boolean;
  readonly pageSize?: number; // mặc định 100
  /** Ghi đè endpoint (staging, bản giả để test). Bỏ trống = production. */
  readonly endpoints?: PolymarketEndpoints;
}

/**
 * Lấy danh sách trận + market (outcomes, tokenId, giá...) bằng @polymarket/client.
 * Mỗi trang → emit(Event[] dạng chuẩn của SDK, 'events'). Không lọc, không ánh xạ.
 */
export class PolymarketEventsTask implements Task<PolymarketEventsParams> {
  async run(ctx: TaskContext<PolymarketEventsParams>): Promise<void> {
    const p = ctx.params;
    const client = createPublicClient({
      environment: polymarketEnvironment(p.endpoints),
    });

    while (!ctx.signal.aborted) {
      try {
        const pages = client.listEvents({
          tagIds: [...p.tagIds],
          closed: false,
          ...(p.live === undefined ? {} : { live: p.live }),
          pageSize: p.pageSize ?? 100,
        });
        for await (const page of pages) {
          if (ctx.signal.aborted) return;
          ctx.emit(page.items, 'events');
        }
      } catch (e: unknown) {
        if (ctx.signal.aborted) return; // lỗi tạm thời: vòng sau thử lại
        ctx.warn(e);
      }
      await sleep(p.intervalMs, ctx.signal);
    }
  }
}
