import { z } from 'zod';

/**
 * Cấu hình task trader nhận qua lệnh 'config' (do module trading tính sẵn: bảng vốn theo hạng,
 * giới hạn rủi ro, giới hạn tổng theo trận). Đây là hợp đồng giữa app và worker: worker kiểm tra
 * chặt, sai dạng = từ chối lệnh (giữ cấu hình cũ).
 */
const nonNeg = z.number().finite().min(0);

export const TraderConfigSchema = z.object({
  v: z.literal(1),
  profileId: z.string().min(1),
  profileName: z.string(),
  active: z.boolean(),
  inactiveReason: z.string().nullable(),
  mode: z.literal('paper'),
  accounts: z.object({
    csgoempire: z.object({ id: z.string(), label: z.string() }).nullable(),
    polymarket: z.object({ id: z.string(), label: z.string() }).nullable(),
  }),
  stakeTable: z.array(
    z.object({
      tierId: z.string(),
      tierName: z.string(),
      minMargin: z.number().finite(),
      maxMargin: z.number().finite().nullable(),
      stake: nonNeg,
      minStake: nonNeg,
      maxStake: nonNeg,
      scaleWithinTier: z.boolean(),
    }),
  ),
  strategy: z.object({
    id: z.string(),
    params: z.record(z.string(), z.unknown()),
  }),
  risk: z.object({
    minNetMargin: z.number().finite().min(0).max(1),
    matchCapUsd: nonNeg,
    maxSignalAgeMs: nonNeg,
    reentryCooldownMs: nonNeg.default(0),
  }),
  matchExposureCapUsd: nonNeg,
});

export type TraderConfig = z.infer<typeof TraderConfigSchema>;
