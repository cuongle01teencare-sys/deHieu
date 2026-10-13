/**
 * Đọc file .har (DevTools → Network → Save all as HAR) của trang dùng sptpub.
 *   pnpm tsx scripts/inspect-sptpub.ts <file.har> [chữ cần tìm trong mô tả market, mặc định "handicap"]
 * In ra: (1) mô tả market khớp từ khóa, (2) market id | specifier → outcome ids cho cs2 (109), lol (110).
 */
import { readFileSync } from 'node:fs';

const [harPath, keyword = 'handicap'] = process.argv.slice(2);
if (!harPath) {
  console.error('Cách dùng: pnpm tsx scripts/inspect-sptpub.ts <file.har> [từ khóa]');
  process.exit(1);
}

interface HarEntry {
  request: { url: string };
  response: { content: { text?: string; encoding?: string } };
}
const har = JSON.parse(readFileSync(harPath, 'utf8')) as {
  log: { entries: HarEntry[] };
};

const bodyOf = (e: HarEntry): any => {
  const { text, encoding } = e.response.content;
  if (!text) return null;
  try {
    return JSON.parse(
      encoding === 'base64' ? Buffer.from(text, 'base64').toString('utf8') : text,
    );
  } catch {
    return null;
  }
};

const DESC = /\/api\/v3\/descriptions\/brand\/[^/]+\/markets\//;
const FEED = /\/api\/v4\/(live|prematch)\/brand\//;
const entries = har.log.entries;
const descs = entries.filter((e) => DESC.test(e.request.url));
const feeds = entries.filter((e) => FEED.test(e.request.url));
console.log(
  `entries=${entries.length} descriptions=${descs.length} feed=${feeds.length}` +
    ` (không có body: ${[...descs, ...feeds].filter((e) => !e.response.content.text).length})`,
);

// 1) Mô tả market: object nào có chuỗi chứa từ khóa thì in ra (kèm đường dẫn)
const re = new RegExp(keyword, 'i');
const walk = (o: any, path: string): void => {
  if (!o || typeof o !== 'object') return;
  if (Object.values(o).some((v) => typeof v === 'string' && re.test(v)))
    console.log(path, JSON.stringify(o).slice(0, 500));
  for (const [k, v] of Object.entries(o)) walk(v, `${path}/${k}`);
};
console.log(`\n=== mô tả market khớp "${keyword}"`);
for (const e of descs) walk(bodyOf(e), '');

// 2) Feed: theo thứ tự trong HAR, nhớ sport của event từ desc
const sportOf = new Map<string, string>();
const seen = new Map<string, Set<string>>();
for (const e of feeds) {
  const body = bodyOf(e);
  for (const [id, ev] of Object.entries<any>(body?.events ?? {})) {
    if (ev?.desc) sportOf.set(id, String(ev.desc.sport));
    const sport = sportOf.get(id);
    if (!ev?.markets || (sport !== '109' && sport !== '110')) continue;
    for (const [mid, specs] of Object.entries<any>(ev.markets))
      for (const [spec, outs] of Object.entries<any>(specs ?? {})) {
        const k = `${sport} | m=${mid} | ${spec || '(rỗng)'}`;
        const s = seen.get(k) ?? new Set<string>();
        Object.keys(outs ?? {}).forEach((o) => s.add(o));
        seen.set(k, s);
      }
  }
}
console.log('\n=== feed: sport | market | specifier → outcome ids');
for (const [k, s] of [...seen].sort()) console.log(k, '→', [...s].join(','));
