import { SptPubFeedTask } from '../sptpub/sptpub-feed.task.js';
import type { SptPubFeedParams } from '../sptpub/sptpub-feed.task.js';
import type { TaskContext } from '../../application/task.js';

/** Nguồn giả: index /0 → 1 phần snapshot (version 100) → delta rỗng nối tiếp. */
const fakeSptpub = (epochOf: () => number) =>
  vi.stubGlobal('fetch', (url: string) => {
    const v = url.split('/').pop() ?? '';
    const body =
      v === '0'
        ? { epoch: epochOf(), version: 100 }
        : v === '100'
          ? {
              epoch: epochOf(),
              version: 200,
              snapshot_complete: true,
              events: {},
            }
          : { epoch: epochOf(), version: Number(v) + 1, events: {} };
    return Promise.resolve(new Response(JSON.stringify(body)));
  });

const ctxOf = (
  params: Partial<SptPubFeedParams>,
  onEmit: (channel: string, abort: () => void) => void,
): TaskContext<SptPubFeedParams> => {
  const abort = new AbortController();
  return {
    taskId: 't',
    tenant: 'sptpub',
    params: {
      baseUrl: 'https://x.sptpub.com',
      brandId: 'b',
      lang: 'en',
      intervalMs: 1,
      ...params,
    },
    signal: abort.signal,
    emit: (_p, c) => onEmit(c ?? '', () => abort.abort()),
    onCommand: () => undefined,
    warn: () => undefined,
  };
};

describe('SptPubFeedTask', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mỗi resnapshotEveryMs tải lại snapshot ngầm, chỉ phát phần lệch (resync) rồi đi tiếp delta', async () => {
    // nguồn: lần đầu 2.58 + market 330; sau đó sptpub đổi 2.62 và gỡ 330 mà KHÔNG gửi delta
    let price = '2.58';
    let with330 = true;
    vi.stubGlobal('fetch', (url: string) => {
      const v = url.split('/').pop() ?? '';
      const markets: Record<string, unknown> = {
        '186': { '': { '4': { k: price }, '5': { k: '1.45' } } },
        ...(with330 ? { '330': { 'mapnr=1': { '4': { k: '2' } } } } : {}),
      };
      const body =
        v === '0'
          ? { epoch: 1, version: 100 }
          : v === '100'
            ? {
                epoch: 1,
                version: 200,
                snapshot_complete: true,
                events: { A: { markets } },
              }
            : { epoch: 1, version: Number(v) + 1, events: {} };
      return Promise.resolve(new Response(JSON.stringify(body)));
    });
    let now = 0;
    const emitted: { channel: string; payload: unknown }[] = [];
    const abort = new AbortController();
    await new SptPubFeedTask('prematch', () => (now += 1_000)).run({
      ...ctxOf({ resnapshotEveryMs: 5_000 }, () => undefined),
      signal: abort.signal,
      emit: (payload, channel) => {
        emitted.push({ channel: channel ?? '', payload });
        if (channel === 'snapshot') {
          price = '2.62';
          with330 = false;
        }
        if (channel === 'resync') abort.abort();
      },
    });
    const channels = emitted.map((e) => e.channel);
    expect(channels.slice(0, 2)).toEqual(['snapshot-start', 'snapshot']);
    expect(channels.at(-1)).toBe('resync');
    expect(new Set(channels.slice(2, -1))).toEqual(new Set(['delta']));
    const resync = emitted.at(-1)?.payload as {
      version: number;
      events: unknown;
    };
    expect(resync.version).toBe(200);
    expect(resync.events).toEqual({
      A: { markets: { '186': { '': { '4': { k: '2.62' } } }, '330': null } },
    });
  });

  it('nguồn không đổi → tải lại ngầm nhưng không phát gì', async () => {
    fakeSptpub(() => 1);
    let now = 0;
    const channels: string[] = [];
    let fetches = 0;
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (u: string) => {
      fetches++;
      return inner(u);
    });
    const abort = new AbortController();
    await new SptPubFeedTask('prematch', () => (now += 1_000)).run({
      ...ctxOf({ resnapshotEveryMs: 2_000 }, () => undefined),
      signal: abort.signal,
      emit: (_p, c) => {
        channels.push(c ?? '');
        if (channels.length === 12) abort.abort();
      },
    });
    expect(channels.filter((c) => c === 'snapshot-start')).toHaveLength(1);
    expect(channels).not.toContain('resync');
    expect(fetches).toBeGreaterThan(channels.length); // có tải lại ngầm
  });

  it('resnapshotEveryMs = 0 → không tự tải lại', async () => {
    fakeSptpub(() => 1);
    let now = 0;
    const channels: string[] = [];
    await new SptPubFeedTask('prematch', () => (now += 60_000)).run(
      ctxOf({ resnapshotEveryMs: 0 }, (c, abort) => {
        channels.push(c);
        if (channels.length === 10) abort();
      }),
    );
    expect(channels.filter((x) => x === 'snapshot-start')).toHaveLength(1);
  });

  it('epoch đổi → chụp lại từ đầu (snapshot-start)', async () => {
    let epoch = 1;
    let calls = 0;
    fakeSptpub(() => (++calls > 2 ? ++epoch : epoch));
    const channels: string[] = [];
    await new SptPubFeedTask('live').run(
      ctxOf({ resnapshotEveryMs: 0 }, (c, abort) => {
        channels.push(c);
        if (channels.filter((x) => x === 'snapshot-start').length === 2)
          abort();
      }),
    );
    expect(channels).toEqual(['snapshot-start', 'snapshot', 'snapshot-start']);
  });
});
