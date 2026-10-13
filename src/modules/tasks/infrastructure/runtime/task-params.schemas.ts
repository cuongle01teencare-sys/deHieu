import { z } from 'zod';

/**
 * Schema params của từng kind — kiểm tra lúc POST /tasks để lỗi cấu hình
 * (thiếu tagIds, gõ sai tên trường...) bị từ chối ngay thay vì task chạy "im lặng".
 * strictObject: trường lạ → lỗi, để bắt lỗi gõ nhầm.
 */
const sptpubEndpoint = {
  baseUrl: z.url(),
  brandId: z.string().min(1),
  lang: z.string().min(1).default('en'),
};

export const SptPubDescriptorParamsSchema = z.strictObject({
  ...sptpubEndpoint,
  intervalMs: z.number().int().min(5_000).default(60_000),
});

export const SptPubFeedParamsSchema = z.strictObject({
  ...sptpubEndpoint,
  intervalMs: z.number().int().min(250).default(1_000),
  maxConsecutiveErrors: z.number().int().positive().optional(),
  /** Chu kỳ tự tải lại snapshot để bù phần sptpub đổi/gỡ mà không gửi delta; 0 = tắt. */
  resnapshotEveryMs: z
    .number()
    .int()
    .refine(
      (v) => v === 0 || v >= 1_000,
      'resnapshotEveryMs: 0 (tắt) hoặc ≥ 1000',
    )
    .default(5_000)
    .describe(
      'Chu kỳ tự tải lại snapshot (ms), chỉ phát phần lệch, để bù phần sptpub đổi/gỡ mà không gửi delta; 0 = tắt',
    ),
});

const polymarketEndpoints = z
  .strictObject({
    gammaRest: z.url().optional(),
    clobRest: z.url().optional(),
    clobMarketWs: z.url().optional(),
  })
  .optional();

export const PolymarketEventsParamsSchema = z.strictObject({
  tagIds: z.array(z.number().int()).min(1),
  intervalMs: z.number().int().min(5_000).default(30_000),
  live: z
    .boolean()
    .optional()
    .describe(
      'Bật = chỉ trận đang live. Tắt/bỏ trống = mọi trận (đang live + sắp diễn ra)',
    ),
  pageSize: z.number().int().min(1).max(500).optional(),
  endpoints: polymarketEndpoints,
});

export const PolymarketMarketStreamParamsSchema = z.strictObject({
  assetIds: z.array(z.string()).optional(),
  resubscribeDebounceMs: z.number().int().nonnegative().optional(),
  endpoints: polymarketEndpoints,
});
