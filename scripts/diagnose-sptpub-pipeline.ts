/**
 * Chẩn đoán: delta sptpub đúng ở nguồn nhưng odds trong app bị kẹt — lỗi nằm ở chặng nào của app?
 *
 *   pnpm tsx scripts/diagnose-sptpub-pipeline.ts --base https://api-h-xxxx.sptpub.com --brand <brandId> [--feed prematch] [--minutes 10] [--interval 2000] [--event <eventId>]
 *
 * Dựng lại ĐÚNG đường đi của app ngay trong script (dùng code thật của src/, chỉ thay worker thread
 * bằng kênh trong cùng process và Redis bằng store mã hóa/giải mã chuỗi giống Redis):
 *   SptPubFeedTask → TaskRuntime → TaskSupervisor (lọc seq, heartbeat) → IngestTaskDataHandler
 *   → TranslatorRouter → SptPubOddsTranslator → LaneDispatcher → OddsLineApplier → room store
 * Song song chạy một bản "raw" tự gộp delta (không qua code app) làm đối chứng.
 * Hết giờ → tải snapshot MỚI rồi so: (1) dòng kèo app ghi vào room, (2) bản raw, với bản mới.
 */
import { SptPubFeedTask } from '../src/modules/tasks/infrastructure/sptpub/sptpub-feed.task.js';
import { TaskRuntime } from '../src/modules/tasks/infrastructure/runtime/task-runtime.js';
import { TaskSupervisor } from '../src/modules/tasks/application/task-supervisor.js';
import { InMemoryTaskRegistry } from '../src/modules/tasks/infrastructure/persistence/in-memory-task.registry.js';
import { NoopTaskAlertNotifier } from '../src/modules/tasks/infrastructure/notifier/noop-task-alert.notifier.js';
import type {
  TaskConnection,
  TaskLauncher,
} from '../src/modules/tasks/application/task-launcher.js';
import type {
  AppToTaskMessage,
  TaskToAppMessage,
} from '../src/modules/tasks/application/task-protocol.js';
import { SptPubOddsTranslator } from '../src/modules/odds/infrastructure/acl/sptpub/sptpub-odds.translator.js';
import { TeamNameResolver } from '../src/modules/odds/application/team-name.resolver.js';
import { TranslatorRouter } from '../src/modules/odds/application/translator-router.js';
import { IngestTaskDataHandler } from '../src/modules/odds/application/commands/ingest-task-data.command.js';
import { IngestStats } from '../src/modules/odds/application/ingest-stats.js';
import { LaneDispatcher } from '../src/modules/odds/application/lane-dispatcher.js';
import { OddsLineApplier } from '../src/modules/odds/application/odds-line-applier.js';
import { ArbitrageEvaluator } from '../src/modules/odds/application/arbitrage-evaluator.js';
import { InMemorySignalStateStore } from '../src/modules/odds/infrastructure/persistence/in-memory/in-memory-signal-state.store.js';
import { InMemoryArbitrageSettingsStore } from '../src/modules/odds/infrastructure/settings/in-memory-arbitrage-settings.store.js';
import type { OddsRoomStore } from '../src/modules/odds/application/odds-room.store.js';
import { MatchKey } from '../src/modules/odds/domain/match-key.js';
import { OddsLine } from '../src/modules/odds/domain/odds-line.js';
import { OddsRoom } from '../src/modules/odds/domain/odds-room.js';

type Json = Record<string, any>;

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const baseUrl = arg('base')?.replace(/\/+$/, '');
const brandId = arg('brand');
const feed = (arg('feed', 'prematch') as 'prematch' | 'live')!;
const minutes = Number(arg('minutes', '10'));
const intervalMs = Number(arg('interval', '2000'));
const watchEvent = arg('event');
if (!baseUrl || !brandId) {
  console.error(
    'Cách dùng: pnpm tsx scripts/diagnose-sptpub-pipeline.ts --base https://api-h-xxxx.sptpub.com --brand <brandId> [--minutes 10] [--event <eventId>]',
  );
  process.exit(1);
}
const kind = `sptpub.${feed}`;
const SPORTS = new Set(['109', '110', '111', '194']);
const MARKETS = new Set(['186', '327', '328', '330']);
const t = () => new Date().toISOString().slice(11, 19);

// ------------------------------------------------------------------ room store giống Redis
/** Lưu chuỗi đã mã hóa như HSET, đọc lại bằng decode — bắt cả lỗi mã hóa. */
class EncodedRoomStore implements OddsRoomStore {
  readonly rooms = new Map<string, Map<string, string>>();
  setLine(key: MatchKey, line: OddsLine) {
    const id = key.toString();
    const r = this.rooms.get(id) ?? new Map<string, string>();
    r.set(line.props.tenant, line.encode());
    this.rooms.set(id, r);
    return Promise.resolve();
  }
  removeLine(key: MatchKey, tenant: string) {
    const r = this.rooms.get(key.toString());
    r?.delete(tenant);
    if (r?.size === 0) this.rooms.delete(key.toString());
    return Promise.resolve();
  }
  get(key: MatchKey) {
    return Promise.resolve(this._room(key, this.rooms.get(key.toString())));
  }
  list() {
    return Promise.resolve(
      [...this.rooms].flatMap(([id, raw]) => {
        const k = MatchKey.parse(id);
        return k ? [this._room(k, raw)] : [];
      }),
    );
  }
  clear() {
    const n = this.rooms.size;
    this.rooms.clear();
    return Promise.resolve({ rooms: n, lines: 0 });
  }
  private _room(key: MatchKey, raw?: Map<string, string>) {
    const lines = new Map<string, OddsLine>();
    for (const [tenant, v] of raw ?? []) {
      const l = OddsLine.decode(tenant, v);
      if (l) lines.set(tenant, l);
    }
    return new OddsRoom(key, lines);
  }
}

// ------------------------------------------------------------------ launcher trong cùng process
/** Thay worker thread: TaskRuntime chạy ngay đây, tin nhắn đi bất đồng bộ như postMessage. */
const counters = { emitted: 0, delivered: 0, lastEmittedSeq: 0 };
class InProcessLauncher implements TaskLauncher {
  supports() {
    return true;
  }
  launch(): Promise<TaskConnection> {
    let toApp: ((m: TaskToAppMessage) => void) | null = null;
    let toTask: ((m: AppToTaskMessage) => void) | null = null;
    let exited = false;
    const runtime = new TaskRuntime(
      {
        send: (m) => {
          if (m.type === 'data') {
            counters.emitted++;
            counters.lastEmittedSeq = m.seq;
          }
          setImmediate(() => !exited && toApp?.(m));
        },
        onMessage: (h) => {
          toTask = h;
        },
      },
      { [kind]: () => new SptPubFeedTask(feed) },
    );
    return Promise.resolve({
      send: (m) => setImmediate(() => toTask?.(m)),
      onMessage: (h) => {
        toApp = h;
      },
      onExit: () => undefined,
      terminate: async () => {
        exited = true;
        await runtime.dispose();
      },
    });
  }
}

// ------------------------------------------------------------------ dựng pipeline của app
const teams = new TeamNameResolver({
  findAll: () => Promise.resolve({ status: 'SUCEED', data: [] }),
} as never);
const stats = new IngestStats();
const translator = new SptPubOddsTranslator(teams, stats.reporter('sptpub'));
const router = new TranslatorRouter([translator]);
const rooms = new EncodedRoomStore();
const evaluator = new ArbitrageEvaluator(
  rooms,
  new InMemorySignalStateStore(),
  new InMemoryArbitrageSettingsStore(),
  { publish: () => Promise.resolve() },
);
const laneErrors: string[] = [];
const lanes = new LaneDispatcher(new OddsLineApplier(rooms, evaluator), (l, e) =>
  laneErrors.push(`${l}: ${String(e)}`),
);
const ingest = new IngestTaskDataHandler(router, lanes, stats);
const supervisor = new TaskSupervisor(
  [new InProcessLauncher()],
  new InMemoryTaskRegistry(),
  new NoopTaskAlertNotifier(),
);
const ingestErrors: string[] = [];
const taskEvents: string[] = [];
supervisor.onData(async (msg) => {
  counters.delivered++;
  try {
    await ingest.execute(msg);
  } catch (e) {
    ingestErrors.push(`#${msg.seq} ${String(e)}`);
  }
});
supervisor.onLifecycle((e) => {
  if (e.type === 'state')
    taskEvents.push(`${t()} ${e.from}→${e.record.state}${e.reason ? ` (${e.reason})` : ''}`);
  if (e.type === 'task_error') taskEvents.push(`${t()} lỗi: ${e.message}`);
});

// ------------------------------------------------------------------ bản raw đối chứng
const url = (v: string) => `${baseUrl}/api/v4/${feed}/brand/${brandId}/en/${v}`;
const getJson = async (v: string): Promise<Json | null> => {
  try {
    const r = await fetch(url(v), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? ((await r.json()) as Json) : null;
  } catch {
    return null;
  }
};

class RawState {
  readonly odds = new Map<string, Json>(); // e|m|s|o → outcome
  readonly sport = new Map<string, string>();
  apply(events: Json | undefined) {
    for (const [e, ev] of Object.entries(events ?? {})) {
      if (ev === null) {
        this._drop(`${e}|`);
        continue;
      }
      if (ev.desc?.sport) this.sport.set(e, String(ev.desc.sport));
      if (!SPORTS.has(this.sport.get(e) ?? '')) continue;
      for (const [m, specs] of Object.entries((ev.markets ?? {}) as Json)) {
        if (!MARKETS.has(m)) continue;
        if (specs === null) {
          this._drop(`${e}|${m}|`);
          continue;
        }
        for (const [s, outs] of Object.entries(specs as Json)) {
          if (outs === null) {
            this._drop(`${e}|${m}|${s}|`);
            continue;
          }
          for (const [o, out] of Object.entries(outs as Json))
            if (out === null) this.odds.delete(`${e}|${m}|${s}|${o}`);
            else this.odds.set(`${e}|${m}|${s}|${o}`, out as Json);
        }
      }
    }
  }
  private _drop(prefix: string) {
    for (const k of [...this.odds.keys()]) if (k.startsWith(prefix)) this.odds.delete(k);
  }
}

async function rawSnapshot(state: RawState): Promise<string | null> {
  const idx = await getJson('0');
  if (!idx) return null;
  let v = String(idx.version);
  for (let i = 0; i < 50; i++) {
    const b = await getJson(v);
    if (!b) return null;
    state.apply(b.events);
    v = String(b.version);
    if (b.snapshot_complete === true) return v;
  }
  return null;
}

async function rawFollow(state: RawState, until: number) {
  let v = await rawSnapshot(state);
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (!v) {
      v = await rawSnapshot(state);
      continue;
    }
    const b = await getJson(v);
    if (!b) {
      v = null;
      continue;
    }
    state.apply(b.events);
    v = String(b.version);
  }
}

// ------------------------------------------------------------------ chạy
const until = Date.now() + minutes * 60_000;
console.log(
  `Chạy pipeline của app (${kind}) + bản raw đối chứng trong ${minutes} phút, delta mỗi ${intervalMs}ms...`,
);
const started = await supervisor.start({
  taskId: 'diag',
  tenant: 'sptpub',
  kind,
  params: { baseUrl, brandId, lang: 'en', intervalMs },
  runtime: { type: 'worker' },
});
if (started.status !== 'SUCEED') throw new Error(JSON.stringify(started));

const raw = new RawState();
const watchLog: string[] = [];
let lastWatch = '';
const watcher = setInterval(() => {
  if (!watchEvent) return;
  const cur = [...rooms.rooms]
    .flatMap(([id, r]) =>
      [...r].filter(([, v]) => v.includes(`e=${watchEvent}`)).map(([, v]) => `${id} ${v.split('|').slice(0, 3).join(' ')}`),
    )
    .join(' ; ');
  if (cur !== lastWatch) watchLog.push(`${t()} ${cur || '(không có dòng)'}`);
  lastWatch = cur;
}, 1000);

await rawFollow(raw, until);
clearInterval(watcher);
await supervisor.stop('diag');
await new Promise((r) => setTimeout(r, 1000));

const fresh = new RawState();
await rawSnapshot(fresh);
console.log(`\nSnapshot mới: ${fresh.odds.size} odds (CS2/LoL/Dota2/Valorant, market 186/327/328/330)`);
if (!fresh.odds.size) console.log('  ⚠ Không tải được snapshot mới — kết quả không có giá trị.');

// (1) dòng kèo app ghi vào room vs snapshot mới
const k = (o: Json | undefined) => (o ? Number(o.k) : NaN);
const locked = (o: Json | undefined) => !o || !!o.b || !(Number(o.k) > 1);
const appDiffs: string[] = [];
let appLines = 0;
// script không đăng ký onTaskGone nên stop KHÔNG gỡ dòng: room còn nguyên để so
const frozen: [string, Map<string, OddsLine>][] = [...rooms.rooms].map(([id, r]) => [
  id,
  new Map([...r].flatMap(([tn, v]) => {
    const l = OddsLine.decode(tn, v);
    return l ? [[tn, l] as [string, OddsLine]] : [];
  })),
]);
for (const [id, r] of frozen) {
  const line = r.get('sptpub');
  if (!line) continue;
  appLines++;
  const ref = line.props.ref;
  const base = `${ref.e}|${ref.m}|${ref.s}|`;
  const a = fresh.odds.get(base + ref.o0);
  const b = fresh.odds.get(base + ref.o1);
  if (!a && !b) {
    appDiffs.push(`${id}: app còn dòng nhưng nguồn đã gỡ`);
    continue;
  }
  const expectLocked = locked(a) || locked(b);
  if (expectLocked !== (line.props.status === 'suspended'))
    appDiffs.push(`${id}: trạng thái app=${line.props.status} nguồn=${expectLocked ? 'khóa' : 'mở'}`);
  else if (!expectLocked && (line.props.odds[0] !== k(a) || line.props.odds[1] !== k(b)))
    appDiffs.push(`${id}: app=${line.props.odds.join('/')} nguồn=${k(a)}/${k(b)} (event ${ref.e}, cập nhật ${new Date(line.props.updatedAt).toISOString().slice(11, 19)})`);
}

// (2) raw vs snapshot mới (đối chứng)
const rawDiffs: string[] = [];
for (const key of new Set([...raw.odds.keys(), ...fresh.odds.keys()])) {
  const x = raw.odds.get(key);
  const y = fresh.odds.get(key);
  if (JSON.stringify(x ?? null) !== JSON.stringify(y ?? null))
    rawDiffs.push(`${key}: raw=${x ? x.k + (x.b ? 'b' : '') : '∅'} mới=${y ? y.k + (y.b ? 'b' : '') : '∅'}`);
}

console.log(`\n== Pipeline của app`);
console.log(`  tin task phát ${counters.emitted}, supervisor chuyển vào ingest ${counters.delivered}${counters.emitted !== counters.delivered ? '  ← SUPERVISOR BỎ TIN' : ''}`);
const s = stats.snapshot();
if (s) console.log(`  ingest: ${JSON.stringify(s).slice(0, 600)}`);
console.log(`  lỗi ingest ${ingestErrors.length}, lỗi làn ${laneErrors.length}`);
[...ingestErrors, ...laneErrors].slice(0, 5).forEach((e) => console.log(`    ${e}`));
console.log(`  vòng đời task:\n    ${taskEvents.join('\n    ')}`);
console.log(`  dòng kèo sptpub trong room: ${appLines}, lệch so với nguồn: ${appDiffs.length}`);
appDiffs.slice(0, 20).forEach((d) => console.log(`    ${d}`));
console.log(`\n== Raw đối chứng: lệch ${rawDiffs.length}/${fresh.odds.size}`);
rawDiffs.slice(0, 10).forEach((d) => console.log(`    ${d}`));
if (watchEvent) console.log(`\n== Event ${watchEvent} trong room theo thời gian:\n    ${watchLog.join('\n    ')}`);
console.log(
  '\nĐọc kết quả: raw ~0 lệch mà app lệch giá → lỗi trong pipeline app (xem dòng lệch + "SUPERVISOR BỎ TIN"/lỗi). Cả hai ~0 → pipeline đúng, nghi Redis dùng chung / tiến trình khác ghi đè.',
);
process.exit(0);
