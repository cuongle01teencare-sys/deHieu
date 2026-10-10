import type { z } from 'zod';
import type { TaskFactory } from '../../application/task.js';
import {
  PolymarketEventsParamsSchema,
  PolymarketMarketStreamParamsSchema,
  SptPubDescriptorParamsSchema,
  SptPubFeedParamsSchema,
} from './task-params.schemas.js';
import { SptPubDescriptorTask } from '../sptpub/sptpub-descriptor.task.js';
import { SptPubFeedTask } from '../sptpub/sptpub-feed.task.js';
import { PolymarketEventsTask } from '../polymarket/polymarket-events.task.js';
import { PolymarketMarketStreamTask } from '../polymarket/polymarket-market-stream.task.js';

export interface TaskCatalogEntry {
  /** Nguồn dữ liệu mà task này lấy. App tự suy tenant từ kind, không nhận từ request. */
  readonly tenant: string;
  readonly create: TaskFactory;
  /** Kiểm tra + điền mặc định cho params lúc start. */
  readonly params: z.ZodType<Record<string, unknown>>;
}

/**
 * kind → { tenant, factory }. Thêm publisher mới = thêm 1 dòng ở đây
 * (kèm translator khai báo cùng kind trong module odds).
 * Quy ước tên kind: '<tenant>.descriptor' | '<tenant>.live' | '<tenant>.prematch'
 * (tenant nào không tách live/prematch ở nguồn thì dùng '<tenant>.stream', app tự tách).
 * Mỗi kind chỉ chạy MỘT instance.
 * Tần suất, url... KHÔNG nằm ở đây mà nằm trong params lúc tạo instance.
 */
export const TASK_CATALOG: Readonly<Record<string, TaskCatalogEntry>> = {
  // sptpub: 3 kênh tách biệt
  'sptpub.descriptor': {
    tenant: 'sptpub',
    create: () => new SptPubDescriptorTask(),
    params: SptPubDescriptorParamsSchema,
  },
  'sptpub.live': {
    tenant: 'sptpub',
    create: () => new SptPubFeedTask('live'),
    params: SptPubFeedParamsSchema,
  },
  'sptpub.prematch': {
    tenant: 'sptpub',
    create: () => new SptPubFeedTask('prematch'),
    params: SptPubFeedParamsSchema,
  },
  // polymarket: descriptor = danh sách trận + token; stream = giá (app tự tách live/prematch)
  'polymarket.descriptor': {
    tenant: 'polymarket',
    create: () => new PolymarketEventsTask(),
    params: PolymarketEventsParamsSchema,
  },
  'polymarket.stream': {
    tenant: 'polymarket',
    create: () => new PolymarketMarketStreamTask(),
    params: PolymarketMarketStreamParamsSchema,
  },
};

/** Chỉ phần factory — dùng bên trong worker thread / microservice. */
export const TASK_FACTORIES: Readonly<Record<string, TaskFactory>> =
  Object.fromEntries(
    Object.entries(TASK_CATALOG).map(([kind, e]) => [kind, e.create]),
  );
