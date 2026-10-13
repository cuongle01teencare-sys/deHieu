/**
 * Chẩn đoán luồng sptpub prematch/live: headers có làm dữ liệu bị lệch không?
 *
 *   pnpm tsx scripts/diagnose-sptpub-feed.ts --base https://api-h-xxxx.sptpub.com --brand <brandId> [--feed prematch] [--minutes 5] [--interval 2000] [--event <eventId>]
 *
 * Chạy song song HAI bản sao đúng cách task sptpub.{feed} đang làm (lấy snapshot theo chuỗi version,
 * rồi cứ intervalMs lấy delta và gộp vào trạng thái):
 *   A "app"     : headers giống hệt task hiện tại (chỉ accept: application/json)
 *   B "browser" : thêm Origin/Referer/User-Agent/Accept-Language giống trình duyệt csgoempire
 * Hết thời gian → tải một snapshot MỚI (headers trình duyệt) và so từng odds của A và B với bản mới.
 * Kèm: epoch có đổi không, header cache (cf-cache-status, age), lỗi HTTP, thời gian phản hồi.
 */

type Json = Record<string, any>;

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const base = arg('base')?.replace(/\/+$/, '');
const brand = arg('brand');
const feed = arg('feed', 'prematch')!;
const minutes = Number(arg('minutes', '5'));
const interval = Number(arg('interval', '2000'));
const watchEvent = arg('event');
if (!base || !brand) {
  console.error(
    'Cách dùng: pnpm tsx scripts/diagnose-sptpub-feed.ts --base https://api-h-xxxx.sptpub.com --brand <brandId> [--feed prematch] [--minutes 5]',
  );
  process.exit(1);
}

const SPORTS = new Set(['109', '110', '111', '194']); // cs2, lol, dota2, valorant
const MARKETS = new Set(['186', '327', '328', '330']);

const HEADERS: Record<string, Record<string, string>> = {
  app: { accept: 'application/json' },
  browser: {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    origin: 'https://csgoempire.com',
    referer: 'https://csgoempire.com/',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
};

const url = (v: string) => `${base}/api/v4/${feed}/brand/${brand}/en/${v}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Follower {
  name: string;
  state: Map<string, string>; // eventId|market|spec|outcome → k (+ "b" khi khóa)
  sport: Map<string, string>;
  epochs: Set<string>;
  requests: number;
  errors: string[];
  deltas: number;
  updates: number;
  slowest: number;
  cache: Map<string, number>;
  watch: string[];
}

const newFollower = (name: string): Follower => ({
  name,
  state: new Map(),
  sport: new Map(),
  epochs: new Set(),
  requests: 0,
  errors: [],
  deltas: 0,
  updates: 0,
  slowest: 0,
  cache: new Map(),
  watch: [],
});

async function get(f: Follower, v: string): Promise<Json | null> {
  const t0 = Date.now();
  f.requests++;
  try {
    const res = await fetch(url(v), {
      headers: HEADERS[f.name],
      signal: AbortSignal.timeout(10_000),
    });
    f.slowest = Math.max(f.slowest, Date.now() - t0);
    const cache = `${res.headers.get('cf-cache-status') ?? '-'} age=${res.headers.get('age') ?? '-'}`;
    f.cache.set(cache, (f.cache.get(cache) ?? 0) + 1);
    if (!res.ok) {
      f.errors.push(`HTTP ${res.status} @${v}`);
      return null;
    }
    const body = (await res.json()) as Json;
    if (body.epoch !== undefined) f.epochs.add(String(body.epoch));
    return body;
  } catch (e) {
    f.errors.push(`${e instanceof Error ? e.message : String(e)} @${v}`);
    return null;
  }
}

function apply(f: Follower, events: Json | undefined, isDelta: boolean) {
  for (const [id, ev] of Object.entries(events ?? {})) {
    if (!ev) continue;
    if (ev.desc?.sport) f.sport.set(id, String(ev.desc.sport));
    if (!SPORTS.has(f.sport.get(id) ?? '')) continue;
    for (const [m, specs] of Object.entries((ev.markets ?? {}) as Json)) {
      if (!MARKETS.has(m) || !specs) continue;
      for (const [s, outs] of Object.entries(specs as Json)) {
        if (!outs) continue;
        for (const [o, out] of Object.entries(outs as Json)) {
          if (!out) continue;
          const val = `${out.k}${out.b ? 'b' : ''}`;
          f.state.set(`${id}|${m}|${s}|${o}`, val);
          if (isDelta) f.updates++;
          if (watchEvent === id && m === '186')
            f.watch.push(`${new Date().toISOString().slice(11, 19)} ${f.name} ${o}=${val}`);
        }
      }
    }
  }
}

/** Snapshot đầy đủ theo chuỗi version (giống task). Trả về version để lấy delta tiếp. */
async function snapshot(f: Follower): Promise<string | null> {
  const idx = await get(f, '0');
  if (!idx) return null;
  let v = String(idx.version);
  for (let i = 0; i < 50; i++) {
    const body = await get(f, v);
    if (!body) return null;
    apply(f, body.events, false);
    v = String(body.version);
    if (body.snapshot_complete === true) return v;
  }
  f.errors.push('snapshot quá 50 phần');
  return null;
}

async function follow(f: Follower, until: number) {
  let v = await snapshot(f);
  while (Date.now() < until) {
    if (v === null) {
      await sleep(interval);
      v = await snapshot(f);
      continue;
    }
    await sleep(interval);
    const body = await get(f, v);
    if (!body) {
      v = null; // giống task: lỗi → (sau vài lần) chụp lại
      continue;
    }
    f.deltas++;
    apply(f, body.events, true);
    v = String(body.version);
  }
}

function diff(a: Follower, fresh: Follower) {
  const keys = new Set([...fresh.state.keys(), ...a.state.keys()]);
  const out: string[] = [];
  for (const k of keys) {
    const x = a.state.get(k);
    const y = fresh.state.get(k);
    if (x !== y) out.push(`${k}: ${a.name}=${x ?? '∅'} mới=${y ?? '∅'}`);
  }
  return out;
}

const until = Date.now() + minutes * 60_000;
const followers = [newFollower('app'), newFollower('browser')];
console.log(
  `Theo dõi ${feed} trong ${minutes} phút, delta mỗi ${interval}ms, 2 bộ headers song song...`,
);
await Promise.all(followers.map((f) => follow(f, until)));

const fresh = newFollower('browser');
await snapshot(fresh);
console.log(`\nSnapshot mới: ${fresh.state.size} odds (CS2/LoL/Dota2/Valorant)\n`);
if (!fresh.state.size)
  console.log('  ⚠ Không tải được snapshot mới (xem lỗi bên dưới) — kết quả so sánh không có giá trị.\n');

for (const f of followers) {
  const d = diff(f, fresh);
  console.log(`== ${f.name}`);
  console.log(
    `  request ${f.requests}, delta ${f.deltas}, cập nhật odds ${f.updates}, chậm nhất ${f.slowest}ms`,
  );
  console.log(`  epoch: ${[...f.epochs].join(', ')}${f.epochs.size > 1 ? '  ← ĐỔI EPOCH' : ''}`);
  console.log(
    `  cache: ${[...f.cache].map(([k, n]) => `${k} ×${n}`).join(' | ')}`,
  );
  if (f.errors.length)
    console.log(`  lỗi (${f.errors.length}): ${f.errors.slice(0, 5).join(' ; ')}`);
  console.log(`  lệch so với snapshot mới: ${d.length}/${fresh.state.size}`);
  d.slice(0, 15).forEach((x) => console.log(`    ${x}`));
  if (f.watch.length) console.log(`  event ${watchEvent}:\n    ${f.watch.join('\n    ')}`);
}
console.log(
  '\nĐọc kết quả: "app" lệch nhiều mà "browser" không lệch → do headers. Cả hai đều 0 → nguồn và cách đọc đúng, lỗi nằm sau task (app). Epoch đổi → cần tải lại khi epoch đổi.',
);
