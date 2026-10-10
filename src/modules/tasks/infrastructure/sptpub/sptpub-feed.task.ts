import type { Task, TaskContext } from '../../application/task.js';
import { getJson, HttpStatusError, sleep } from '../shared/abortable.js';
import { sptpubUrl, type SptPubEndpoint } from './sptpub-url.js';

export type SptPubFeed = 'live' | 'prematch';

export interface SptPubFeedParams extends SptPubEndpoint {
  readonly intervalMs: number; // live 1_000, prematch 2_000
  /** Số lần lỗi mạng liên tiếp trước khi làm lại snapshot từ đầu. Mặc định 5. */
  readonly maxConsecutiveErrors?: number;
}

/**
 * Luồng sptpub (đọc từ HAR csgoempire):
 *   GET .../{feed}/brand/{brand}/{lang}/0          → { version, top_events_versions, rest_events_versions }
 *   GET .../{version}  (snapshot_complete:false)   → phần snapshot + version kế tiếp
 *   ...                (snapshot_complete:true)    → hết snapshot
 *   GET .../{version}  (không có snapshot_complete)→ delta + version kế tiếp, lặp mãi
 * Mỗi response luôn trả `version` kế tiếp, nên chỉ cần đi theo chuỗi version.
 *
 * Kênh emit:
 *   'snapshot-start' : bắt đầu chụp lại toàn bộ (ACL dùng để dọn trận đã biến mất)
 *   'snapshot'       : một phần snapshot (payload thô)
 *   'delta'          : thay đổi (payload thô)
 * Task KHÔNG hiểu events/markets — chỉ đọc trường `version` để biết gọi tiếp gì.
 */
export class SptPubFeedTask implements Task<SptPubFeedParams> {
  /** live hoặc prematch do kind quyết định (sptpub.live / sptpub.prematch), không nằm trong params. */
  constructor(private readonly _feed: SptPubFeed) {}

  async run(ctx: TaskContext<SptPubFeedParams>): Promise<void> {
    const p = ctx.params;
    const base = `api/v4/${this._feed}/brand/${p.brandId}/${p.lang}`;
    const maxErrors = p.maxConsecutiveErrors ?? 5;

    let version = '0';
    let inSnapshot = false;
    let errors = 0;

    while (!ctx.signal.aborted) {
      let body: unknown;
      try {
        body = await getJson(sptpubUrl(p, `${base}/${version}`), ctx.signal);
        errors = 0;
      } catch (e: unknown) {
        if (ctx.signal.aborted) return;
        ctx.warn(e);
        errors++;
        // 4xx (version hết hạn...) hoặc lỗi liên tiếp → chụp lại từ đầu
        if (
          (e instanceof HttpStatusError && e.status < 500) ||
          errors >= maxErrors
        ) {
          version = '0';
          inSnapshot = false;
          errors = 0;
        }
        await sleep(p.intervalMs, ctx.signal);
        continue;
      }

      const next = readVersion(body);
      if (next === null) {
        version = '0'; // response lạ → chụp lại
        await sleep(p.intervalMs, ctx.signal);
        continue;
      }

      if (version === '0') {
        ctx.emit({ feed: this._feed }, 'snapshot-start');
        inSnapshot = true;
      } else if (inSnapshot) {
        ctx.emit(body, 'snapshot');
        if (readSnapshotComplete(body)) inSnapshot = false;
      } else {
        ctx.emit(body, 'delta');
      }

      version = next;
      // snapshot: lấy liền các phần còn lại; delta: chờ intervalMs
      if (!inSnapshot) await sleep(p.intervalMs, ctx.signal);
    }
  }
}

const readVersion = (body: unknown): string | null => {
  const v = (body as { version?: unknown } | null)?.version;
  return typeof v === 'number' || typeof v === 'string' ? String(v) : null;
};

const readSnapshotComplete = (body: unknown): boolean =>
  (body as { snapshot_complete?: unknown } | null)?.snapshot_complete === true;
