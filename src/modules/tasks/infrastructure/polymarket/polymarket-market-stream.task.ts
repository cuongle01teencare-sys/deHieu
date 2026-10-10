import { createPublicClient } from '@polymarket/client';
import {
  polymarketEnvironment,
  type PolymarketEndpoints,
} from './polymarket-environment.js';
import { z } from 'zod';
import type { Task, TaskContext } from '../../application/task.js';
import { sleep } from '../shared/abortable.js';

export interface PolymarketMarketStreamParams {
  /** Token ban đầu (tùy chọn). Thường để trống, app gửi lệnh subscribe sau. */
  readonly assetIds?: readonly string[];
  /** Gom các lệnh subscribe liên tiếp trước khi kết nối lại. Mặc định 500ms. */
  readonly resubscribeDebounceMs?: number;
  /** Ghi đè endpoint (staging, bản giả để test). Bỏ trống = production. */
  readonly endpoints?: PolymarketEndpoints;
}

const AssetsCommand = z.object({ assetIds: z.array(z.string()) });

/**
 * Task dạng STREAM. App quyết định theo dõi token nào qua lệnh:
 *   'subscribe'   { assetIds } → thêm (idempotent: token đã có thì bỏ qua)
 *   'unsubscribe' { assetIds } → bớt
 * Khi tập token đổi → đóng subscription cũ, mở lại với tập mới.
 * emit(event dạng chuẩn của SDK: book | price_change | best_bid_ask | market_resolved..., 'market').
 */
export class PolymarketMarketStreamTask implements Task<PolymarketMarketStreamParams> {
  async run(ctx: TaskContext<PolymarketMarketStreamParams>): Promise<void> {
    const client = createPublicClient({
      environment: polymarketEnvironment(ctx.params.endpoints),
    });
    const assets = new Set(ctx.params.assetIds ?? []);
    const debounceMs = ctx.params.resubscribeDebounceMs ?? 500;

    let current: { close(): Promise<void> } | null = null;
    let changed: boolean;
    let wake: () => void = () => undefined;

    const restart = () => {
      changed = true;
      wake();
      void current?.close(); // kết thúc vòng for-await hiện tại
    };

    ctx.onCommand((name, data) => {
      const { assetIds } = AssetsCommand.parse(data);
      const before = assets.size;
      if (name === 'subscribe') {
        const fresh = assetIds.filter((a) => !assets.has(a));
        fresh.forEach((a) => assets.add(a));
        if (fresh.length) restart();
      } else if (name === 'unsubscribe') {
        assetIds.forEach((a) => assets.delete(a));
        if (assets.size !== before) restart();
      } else {
        throw new Error(`UNKNOWN_COMMAND: ${name}`);
      }
    });
    ctx.signal.addEventListener('abort', () => {
      wake();
      void current?.close();
    });

    while (!ctx.signal.aborted) {
      if (assets.size === 0) {
        await new Promise<void>((r) => (wake = r)); // chờ lệnh subscribe đầu tiên
        continue;
      }
      await sleep(debounceMs, ctx.signal);
      changed = false;

      try {
        const handle = await client.subscribe([
          {
            topic: 'market',
            assetIds: [...assets],
            customFeatureEnabled: true,
          },
        ]);
        current = handle;
        for await (const event of handle) {
          if (ctx.signal.aborted || changed) break;
          ctx.emit(event, 'market');
        }
        await handle.close();
      } catch {
        if (ctx.signal.aborted) return;
        if (!changed) await sleep(1_000, ctx.signal); // mất kết nối: thử lại, giữ nguyên tập token
      } finally {
        current = null;
      }
    }
  }
}
