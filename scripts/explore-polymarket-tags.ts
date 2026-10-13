/**
 * Khám phá tagId esports của Polymarket (dùng cho tham số `tagIds` của task polymarket.descriptor).
 *   pnpm tsx scripts/explore-polymarket-tags.ts            # mặc định: các môn esports quen thuộc
 *   pnpm tsx scripts/explore-polymarket-tags.ts cs2 lol    # chỉ vài môn
 *
 * In ra 3 phần:
 *   1. listSports(): mỗi môn → danh sách tagId (nguồn chính xác nhất).
 *   2. Tag "esports" + các tag liên quan.
 *   3. Thử từng tagId: số event đang mở + phân bố theo môn → biết tag nào là "chung esports",
 *      tag nào chỉ một môn, tag nào lẫn cả thể thao khác.
 */
import { createPublicClient, production } from '@polymarket/client';

const client = createPublicClient({ environment: production });

const DEFAULT_SPORTS = ['cs2', 'lol', 'dota2', 'val', 'mlbb', 'r6siege', 'sc2', 'ow', 'codmw', 'rl', 'hok'];
const wanted = new Set(process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SPORTS);

/** tags của SportsMetadata có thể là "1,64,100639", mảng số, hoặc mảng object {id} tùy phiên bản API. */
function tagIdsOf(tags: unknown): number[] {
  if (typeof tags === 'string') return tags.split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
  if (Array.isArray(tags))
    return tags
      .map((t) => (typeof t === 'object' && t !== null ? Number((t as { id?: unknown }).id) : Number(t)))
      .filter(Number.isFinite);
  return [];
}

async function section<T>(title: string, run: () => Promise<T>): Promise<T | null> {
  console.log(`\n=== ${title}`);
  try {
    return await run();
  } catch (e) {
    console.log('  lỗi:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------- 1. listSports
const sportTags = new Map<number, Set<string>>(); // tagId → các môn có tag đó
const sports = await section('1. listSports(): môn → tagId', async () => {
  const all = await client.listSports();
  const rows = all
    .filter((s) => wanted.has(String(s.sport)))
    .map((s) => {
      const ids = tagIdsOf((s as { tags?: unknown }).tags);
      ids.forEach((id) => (sportTags.get(id) ?? sportTags.set(id, new Set()).get(id)!).add(String(s.sport)));
      return { sport: s.sport, tagIds: ids.join(','), series: (s as { series?: unknown }).series ?? '' };
    });
  console.table(rows);
  const missing = [...wanted].filter((w) => !all.some((s) => s.sport === w));
  if (missing.length) console.log('  không có trong listSports:', missing.join(', '));
  console.log(`  (tổng ${all.length} môn; mã môn esports khác có thể xem bằng cách bỏ lọc)`);
  return all;
});

// ---------- 2. tag "esports" + liên quan
await section('2. Tag "esports" và các tag liên quan', async () => {
  const esports = await client.fetchTag({ slug: 'esports' });
  console.log(`  esports → id=${esports.id} label="${esports.label}" activeEvents=${(esports as { activeEventsCount?: unknown }).activeEventsCount ?? '?'}`);
  sportTags.set(Number(esports.id), sportTags.get(Number(esports.id)) ?? new Set(['(tag esports)']));
  const related = await client.fetchRelatedTagResources({ slug: 'esports' });
  console.table(
    related.slice(0, 40).map((t) => ({ id: t.id, slug: t.slug, label: t.label })),
  );
  for (const t of related) if (!sportTags.has(Number(t.id))) sportTags.set(Number(t.id), new Set([`(liên quan: ${t.slug})`]));
});

// ---------- 3. thử từng tagId
await section('3. Thử từng tagId: event đang mở + phân bố môn (trang đầu, tối đa 100 event)', async () => {
  const ids = [...sportTags.keys()].filter((id) => id > 0);
  const rows: Record<string, unknown>[] = [];
  for (const id of ids) {
    try {
      const page = await client.listEvents({ tagIds: [id], closed: false, pageSize: 100 }).firstPage();
      const bySport = new Map<string, number>();
      for (const ev of page.items) {
        const s = ev.sports?.sport?.sport ?? '(không có)';
        bySport.set(s, (bySport.get(s) ?? 0) + 1);
      }
      const top = [...bySport].sort((a, b) => b[1] - a[1]);
      rows.push({
        tagId: id,
        từ: [...(sportTags.get(id) ?? [])].join(','),
        events: `${page.items.length}${page.hasMore ? '+' : ''}`,
        môn: top.slice(0, 6).map(([s, n]) => `${s}:${n}`).join(' '),
        chỉEsports: top.every(([s]) => wanted.has(s)) ? 'có' : 'không',
      });
    } catch (e) {
      rows.push({ tagId: id, lỗi: e instanceof Error ? e.message : String(e) });
    }
  }
  console.table(rows);
  console.log(
    '\nGợi ý: tag "chung" của esports = tag xuất hiện ở MỌI môn trong phần 1 và cột chỉEsports = "có".\n' +
      'Tag id=1 thường là "Sports" (lẫn bóng đá, NBA...) → đừng dùng. Ghép nhiều tagId được: tagIds=[a,b].',
  );
});

void sports;
