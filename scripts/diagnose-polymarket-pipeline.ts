/**
 * Chẩn đoán: Polymarket có N trận nhưng app chỉ hiện ít hơn — trận rơi ở chặng nào?
 *
 *   pnpm tsx scripts/diagnose-polymarket-pipeline.ts --tags 65 [--cycles 2] [--interval 5000] [--sport lol]
 *
 * Chạy ĐÚNG code của app (src/): PolymarketEventsTask (gọi @polymarket/client như app) → PolymarketOddsTranslator,
 * đi đủ `--cycles` vòng quét (có đối chiếu cuối vòng như app), rồi in từng trận:
 *   số market, số dòng kèo app GIỮ ĐƯỢC cuối cùng, số lần gỡ, lý do bị bỏ qua (theo từng trận).
 * Kiểm tra thêm: dòng kèo mã hóa/giải mã như Redis có hỏng không, và dòng nào sẽ bị gỡ vì "trận đã kết thúc"
 * (startsAt + MATCH_MAX_DURATION_HOURS < bây giờ).
 */
import { PolymarketEventsTask } from '../src/modules/tasks/infrastructure/polymarket/polymarket-events.task.js';
import type { TaskContext } from '../src/modules/tasks/application/task.js';
import type { TaskDataMessage } from '../src/modules/tasks/application/task-protocol.js';
import { PolymarketOddsTranslator } from '../src/modules/odds/infrastructure/acl/polymarket/polymarket-odds.translator.js';
import { TeamNameResolver } from '../src/modules/odds/application/team-name.resolver.js';
import { OddsLine } from '../src/modules/odds/domain/odds-line.js';

type Json = Record<string, any>;
const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const tagIds = (arg('tags', '65') ?? '65').split(',').map(Number);
const cycles = Number(arg('cycles', '2'));
const intervalMs = Number(arg('interval', '5000'));
const sportFilter = arg('sport');
const maxHours = Number(process.env.MATCH_MAX_DURATION_HOURS ?? 8);

const teams = new TeamNameResolver({
  findAll: () => Promise.resolve({ status: 'SUCEED', data: [] }),
} as never);

// lý do bỏ qua theo từng trận: dịch từng event riêng để biết lý do thuộc trận nào
let currentEvent = '';
const skips = new Map<string, Map<string, number>>();
const translator = new PolymarketOddsTranslator(
  teams,
  () => Promise.resolve(),
  (_kind, reason) => {
    const m = skips.get(currentEvent) ?? new Map<string, number>();
    m.set(reason, (m.get(reason) ?? 0) + 1);
    skips.set(currentEvent, m);
  },
);

const lines = new Map<string, OddsLine>(); // room → dòng polymarket app đang giữ
const removed = new Map<string, number>(); // event slug → số lần bị gỡ
const events = new Map<string, Json>(); // slug → event thô (lần cuối thấy)
let seq = 0;
const asMsg = (channel: string, payload: unknown): TaskDataMessage => ({
  taskId: 'diag',
  tenant: 'polymarket',
  kind: 'polymarket.descriptor',
  seq: ++seq,
  sentAt: Date.now(),
  receivedAt: Date.now(),
  channel,
  payload,
});

async function feed(channel: string, payload: unknown) {
  if (channel !== 'events') {
    currentEvent = `(${channel})`;
    apply(await translator.translate(asMsg(channel, payload)), '');
    return;
  }
  for (const ev of payload as Json[]) {
    const slug = String(ev.slug ?? ev.id);
    events.set(slug, ev);
    currentEvent = slug;
    apply(await translator.translate(asMsg('events', [ev])), slug);
  }
}

function apply(changes: Awaited<ReturnType<typeof translator.translate>>, slug: string) {
  for (const c of changes) {
    if (c.type === 'set') lines.set(c.key.toString(), c.line);
    else {
      const prev = lines.get(c.key.toString());
      lines.delete(c.key.toString());
      const s = prev?.props.ref.url?.split('/').pop() ?? slug;
      removed.set(s, (removed.get(s) ?? 0) + 1);
    }
  }
}

// ------------------------------------------------------------------ chạy task thật
console.log(`Chạy PolymarketEventsTask tagIds=[${tagIds}] trong ${cycles} vòng quét...`);
const abort = new AbortController();
let chain: Promise<void> = Promise.resolve(); // xử lý tuần tự đúng thứ tự phát, như app
let done = 0;
const warnings: string[] = [];
const ctx: TaskContext<{ tagIds: number[]; intervalMs: number }> = {
  taskId: 'diag',
  tenant: 'polymarket',
  params: { tagIds, intervalMs },
  signal: abort.signal,
  emit: (payload, channel) => {
    const ch = channel ?? '';
    chain = chain.then(() => feed(ch, payload));
    if (ch === 'cycle-complete' && ++done >= cycles) abort.abort();
  },
  onCommand: () => undefined,
  warn: (e) => warnings.push(e instanceof Error ? e.message : String(e)),
};
const timer = setTimeout(() => abort.abort(), 5 * 60_000);
await new PolymarketEventsTask().run(ctx as never);
clearTimeout(timer);
await chain;

// ------------------------------------------------------------------ báo cáo
const now = Date.now();
const bySlug = new Map<string, OddsLine[]>();
for (const l of lines.values()) {
  const s = l.props.ref.url?.split('/').pop() ?? '?';
  bySlug.set(s, [...(bySlug.get(s) ?? []), l]);
}
const rows = [...events.values()]
  .filter((e) => !sportFilter || e.sports?.sport?.sport === sportFilter)
  .map((e) => {
    const slug = String(e.slug ?? e.id);
    const ls = bySlug.get(slug) ?? [];
    const broken = ls.filter((l) => !OddsLine.decode(l.props.tenant, l.encode())).length;
    const expiring = ls.filter((l) => l.props.startsAt < now - maxHours * 3_600_000).length;
    const sk = [...(skips.get(slug) ?? [])].map(([r, n]) => `${r}×${n}`).join(' ');
    const ml = (e.markets ?? []).find((m: Json) => m.sports?.sportsMarketType === 'moneyline');
    return {
      title: String(e.title ?? slug).slice(0, 48),
      sport: e.sports?.sport?.sport ?? '∅',
      markets: (e.markets ?? []).length,
      ml: ml ? `${ml.state?.closed ? 'đóng' : 'mở'}${ml.state?.acceptingOrders === false ? ',ngừng nhận lệnh' : ''}` : 'không có',
      lines: ls.length,
      removed: removed.get(slug) ?? 0,
      broken,
      expiring,
      skips: sk,
    };
  })
  .sort((a, b) => b.lines - a.lines);

console.log(`\nTrận đã thấy: ${rows.length}, có dòng kèo trong app: ${rows.filter((r) => r.lines > 0).length}`);
console.table(rows);
if (warnings.length) console.log(`Cảnh báo task (${warnings.length}):\n  ${[...new Set(warnings)].slice(0, 5).join('\n  ')}`);
console.log(
  '\nĐọc: "lines" = số dòng app giữ cuối cùng. lines=0 mà ml "mở" → xem cột skips/removed. ' +
    '"broken" > 0 = dòng hỏng khi lưu Redis (không hiện trên web). "expiring" > 0 = sẽ bị gỡ vì quá giờ trận.',
);
process.exit(0);
