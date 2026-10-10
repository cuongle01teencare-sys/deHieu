import { z } from 'zod';

/** Dạng dữ liệu /api/v4/{live|prematch}/brand/{brand}/{lang}/{version} (rút từ HAR). */
export const SptPubOutcomeSchema = z.looseObject({
  k: z.string(), // decimal odds dạng chuỗi, "0.0" khi khóa
  b: z.number().optional(), // 1 = khóa
});

/** specifier ("" | "mapnr=3" | "hcp=-1.5") → outcomeId → outcome */
export const SptPubMarketSchema = z.record(
  z.string(),
  z.record(z.string(), SptPubOutcomeSchema.nullable()).nullable(),
);

export const SptPubEventDescSchema = z.looseObject({
  scheduled: z.number(), // unix giây
  type: z.string(),
  virtual: z.boolean().optional(),
  sport: z.string(),
  competitors: z.array(z.looseObject({ id: z.string(), name: z.string() })),
});

export const SptPubEventSchema = z.looseObject({
  desc: SptPubEventDescSchema.optional(),
  markets: z.record(z.string(), SptPubMarketSchema.nullable()).optional(),
});

export const SptPubFeedSchema = z.looseObject({
  version: z.number(),
  snapshot_complete: z.boolean().optional(),
  events: z.record(z.string(), SptPubEventSchema.nullable()).optional(),
});

export type SptPubFeedDTO = z.infer<typeof SptPubFeedSchema>;
export type SptPubOutcomeDTO = z.infer<typeof SptPubOutcomeSchema>;
