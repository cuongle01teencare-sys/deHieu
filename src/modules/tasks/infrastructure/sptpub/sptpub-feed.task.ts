import type { Task, TaskContext } from '../../application/task.js';
import { getJson, HttpStatusError, sleep } from '../shared/abortable.js';
import { sptpubUrl, type SptPubEndpoint } from './sptpub-url.js';
import { SptPubFeedState } from './sptpub-feed-state.js';

export type SptPubFeed = 'live' | 'prematch';

export interface SptPubFeedParams extends SptPubEndpoint {
  readonly intervalMs: number; // live 1_000, prematch 2_000
  /** Số lần lỗi mạng liên tiếp trước khi làm lại snapshot từ đầu. Mặc định 5. */
  readonly maxConsecutiveErrors?: number;
  /**
   * Chu kỳ tự tải lại snapshot để bù phần sptpub đổi/gỡ mà KHÔNG gửi delta. 0 = tắt.
   * Chỉ phần chênh lệch được phát (kênh 'resync'), không phát lại cả snapshot.
   */
  readonly resnapshotEveryMs?: number;
}

const DEFAULT_RESNAPSHOT_MS = 5_000;
const MAX_SNAPSHOT_PARTS = 50;

/**
 * Luồng sptpub (đọc từ HAR csgoempire):
 *   GET .../{feed}/brand/{brand}/{lang}/0          → { epoch, version, top_events_versions, rest_events_versions }
 *   GET .../{version}  (snapshot_complete:false)   → phần snapshot + version kế tiếp
 *   ...                (snapshot_complete:true)    → hết snapshot
 *   GET .../{version}  (không có snapshot_complete)→ delta + version kế tiếp, lặp mãi
 * Mỗi response luôn trả `version` kế tiếp, nên chỉ cần đi theo chuỗi version.
 * `epoch` đổi = sptpub xoay phiên → chụp lại từ đầu.
 *
 * sptpub có lúc đổi/gỡ market mà không gửi delta → task giữ bản sao trạng thái (SptPubFeedState),
 * mỗi `resnapshotEveryMs` tải lại snapshot (không phát), so với bản sao rồi chỉ phát phần lệch.
 *
 * Kênh emit:
 *   'snapshot-start' : bắt đầu chụp lại toàn bộ (ACL dùng để dọn trận/market đã biến mất)
 *   'snapshot'       : một phần snapshot (payload thô)
 *   'delta'          : thay đổi (payload thô)
 *   'resync'         : phần lệch giữa bản sao và snapshot mới, cùng dạng delta (+ `resync` thống kê)
 */
export class SptPubFeedTask implements Task<SptPubFeedParams> {
  /** live hoặc prematch do kind quyết định (sptpub.live / sptpub.prematch), không nằm trong params. */
  constructor(
    private readonly _feed: SptPubFeed,
    private readonly _now: () => number = Date.now,
  ) {}

  async run(ctx: TaskContext<SptPubFeedParams>): Promise<void> {
    const p = ctx.params;
    const base = `api/v4/${this._feed}/brand/${p.brandId}/${p.lang}`;
    const maxErrors = p.maxConsecutiveErrors ?? 5;
    const resnapshotMs = p.resnapshotEveryMs ?? DEFAULT_RESNAPSHOT_MS;
    const get = (v: string) =>
      getJson(sptpubUrl(p, `${base}/${v}`), ctx.signal);

    let version = '0';
    let inSnapshot = false;
    let errors = 0;
    let epoch: string | null = null;
    let state = new SptPubFeedState();
    let snapshotAt = 0;

    while (!ctx.signal.aborted) {
      // ---- định kỳ: tải lại snapshot (không phát) rồi chỉ phát phần lệch
      if (
        resnapshotMs > 0 &&
        !inSnapshot &&
        version !== '0' &&
        this._now() - snapshotAt >= resnapshotMs
      ) {
        snapshotAt = this._now();
        try {
          const fresh = await fetchSnapshot(get);
          if (fresh.epoch !== null && epoch !== null && fresh.epoch !== epoch) {
            version = '0'; // xoay phiên giữa chừng → chụp lại đầy đủ (có snapshot-start)
            continue;
          }
          const events = state.diffTo(fresh.state);
          const changed = Object.keys(events).length;
          if (changed)
            ctx.emit(
              {
                version: Number(fresh.version),
                events,
                resync: { events: changed, at: this._now() },
              },
              'resync',
            );
          state = fresh.state;
          version = fresh.version;
        } catch (e: unknown) {
          if (ctx.signal.aborted) return;
          ctx.warn(e); // giữ chuỗi delta hiện tại, lần sau thử lại
        }
        await sleep(p.intervalMs, ctx.signal);
        continue;
      }

      let body: unknown;
      try {
        body = await get(version);
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
        inSnapshot = false;
        await sleep(p.intervalMs, ctx.signal);
        continue;
      }

      const bodyEpoch = readEpoch(body);
      if (version === '0') {
        epoch = bodyEpoch;
        state = new SptPubFeedState();
        ctx.emit({ feed: this._feed }, 'snapshot-start');
        inSnapshot = true;
      } else if (bodyEpoch !== null && epoch !== null && bodyEpoch !== epoch) {
        version = '0'; // sptpub xoay phiên → chụp lại từ đầu
        inSnapshot = false;
        continue;
      } else if (inSnapshot) {
        state.apply(readEvents(body));
        ctx.emit(body, 'snapshot');
        if (readSnapshotComplete(body)) {
          inSnapshot = false;
          snapshotAt = this._now();
        }
      } else {
        state.apply(readEvents(body));
        ctx.emit(body, 'delta');
      }

      version = next;
      // snapshot: lấy liền các phần còn lại; delta: chờ intervalMs
      if (!inSnapshot) await sleep(p.intervalMs, ctx.signal);
    }
  }
}

/** Tải trọn một snapshot theo chuỗi version (không phát gì). */
async function fetchSnapshot(
  get: (v: string) => Promise<unknown>,
): Promise<{ state: SptPubFeedState; version: string; epoch: string | null }> {
  const idx = await get('0');
  let version = readVersion(idx);
  if (version === null)
    throw new Error('resync: index sptpub không có version');
  const epoch = readEpoch(idx);
  const state = new SptPubFeedState();
  for (let i = 0; i < MAX_SNAPSHOT_PARTS; i++) {
    const body = await get(version);
    const next = readVersion(body);
    if (next === null)
      throw new Error('resync: phần snapshot không có version');
    state.apply(readEvents(body));
    version = next;
    if (readSnapshotComplete(body)) return { state, version, epoch };
  }
  throw new Error(`resync: snapshot quá ${MAX_SNAPSHOT_PARTS} phần`);
}

const readVersion = (body: unknown): string | null => {
  const v = (body as { version?: unknown } | null)?.version;
  return typeof v === 'number' || typeof v === 'string' ? String(v) : null;
};

const readEpoch = (body: unknown): string | null => {
  const v = (body as { epoch?: unknown } | null)?.epoch;
  return typeof v === 'number' || typeof v === 'string' ? String(v) : null;
};

const readEvents = (body: unknown): unknown =>
  (body as { events?: unknown } | null)?.events;

const readSnapshotComplete = (body: unknown): boolean =>
  (body as { snapshot_complete?: unknown } | null)?.snapshot_complete === true;
