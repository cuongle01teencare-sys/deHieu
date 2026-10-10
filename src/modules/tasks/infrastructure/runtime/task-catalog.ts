import type { TaskFactory } from '../../application/task.js';
import { SptPubDescriptorTask } from '../sptpub/sptpub-descriptor.task.js';
import { SptPubFeedTask } from '../sptpub/sptpub-feed.task.js';
import { PolymarketEventsTask } from '../polymarket/polymarket-events.task.js';
import { PolymarketMarketStreamTask } from '../polymarket/polymarket-market-stream.task.js';

export interface TaskCatalogEntry {
  /** Nguồn dữ liệu mà task này lấy. App tự suy tenant từ kind, không nhận từ request. */
  readonly tenant: string;
  readonly create: TaskFactory;
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
  },
  'sptpub.live': { tenant: 'sptpub', create: () => new SptPubFeedTask('live') },
  'sptpub.prematch': {
    tenant: 'sptpub',
    create: () => new SptPubFeedTask('prematch'),
  },
  // polymarket: descriptor = danh sách trận + token; stream = giá (app tự tách live/prematch)
  'polymarket.descriptor': {
    tenant: 'polymarket',
    create: () => new PolymarketEventsTask(),
  },
  'polymarket.stream': {
    tenant: 'polymarket',
    create: () => new PolymarketMarketStreamTask(),
  },
};

/** Chỉ phần factory — dùng bên trong worker thread / microservice. */
export const TASK_FACTORIES: Readonly<Record<string, TaskFactory>> =
  Object.fromEntries(
    Object.entries(TASK_CATALOG).map(([kind, e]) => [kind, e.create]),
  );
