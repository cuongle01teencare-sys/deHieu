import { createPublicClient, production } from '@polymarket/client';

/** Các loại market quan tâm (tên lấy từ fetchSportsMarketTypes()). */
const TYPES = new Set([
  'moneyline',
  'child_moneyline',
  'map_handicap',
  'match_handicap',
  'esports_match_result',
  'totals',
]);
const SPORTS = new Set(['cs2', 'lol', 'dota2', 'val']);

const client = createPublicClient({ environment: production });

let events = 0;
let markets = 0;
const bySport = new Map<string, number>();
const byType = new Map<string, number>(); // `${sport}|${type}` → số market
const rows = new Map<string, unknown>(); // `${sport}|${type}|${line}` → mẫu rút gọn
const raw = new Map<string, unknown>(); // `${type}` → 1 market thô (cs2/lol)

for await (const page of client.listEvents({
  tagIds: [100639],
  closed: false,
  pageSize: 100,
}))
  for (const ev of page.items) {
    events++;
    const sport = ev.sports?.sport?.sport ?? '(null)';
    bySport.set(sport, (bySport.get(sport) ?? 0) + 1);
    for (const m of ev.markets ?? []) {
      markets++;
      const type = m.sports?.sportsMarketType ?? '(null)';
      if (!SPORTS.has(sport)) continue;
      byType.set(`${sport}|${type}`, (byType.get(`${sport}|${type}`) ?? 0) + 1);
      if (!TYPES.has(type)) continue;
      const k = `${sport}|${type}|${m.sports?.line ?? ''}`;
      if (!rows.has(k))
        rows.set(k, {
          sport,
          type,
          line: m.sports?.line,
          question: m.question,
          group: m.groupItemTitle,
          yes: m.outcomes.yes.label,
          no: m.outcomes.no.label,
        });
      if (!raw.has(type)) raw.set(type, { event: ev.slug, market: m });
    }
  }

console.log(`events=${events} markets=${markets}`);
console.log('event theo sport:', Object.fromEntries(bySport));
console.log('market theo sport|type (cs2/lol):', Object.fromEntries(byType));
console.table([...rows.values()]);
for (const [type, sample] of raw)
  console.log(`\n=== mẫu thô: ${type}\n`, JSON.stringify(sample, null, 2));
