import type * as PolymarketClient from '@polymarket/client';
import { PolymarketEventsTask } from '../polymarket/polymarket-events.task.js';

const listEvents = vi.fn();
vi.mock('@polymarket/client', async (importOriginal) => ({
  ...(await importOriginal<typeof PolymarketClient>()),
  createPublicClient: () => ({ listEvents }),
}));

async function runOnce(live?: boolean) {
  listEvents.mockReset();
  const abort = new AbortController();
  listEvents.mockImplementation(function* () {
    abort.abort();
    yield { items: [] };
  });
  await new PolymarketEventsTask().run({
    taskId: 't',
    tenant: 'polymarket',
    params: {
      tagIds: [65],
      intervalMs: 1,
      ...(live === undefined ? {} : { live }),
    },
    signal: abort.signal,
    emit: () => undefined,
    onCommand: () => undefined,
    warn: () => undefined,
  });
  return listEvents.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('PolymarketEventsTask: tham số live', () => {
  it('live=false hoặc bỏ trống → KHÔNG gửi live (gamma live=false loại mất trận chưa có cờ live)', async () => {
    expect(await runOnce(false)).not.toHaveProperty('live');
    expect(await runOnce()).not.toHaveProperty('live');
  });

  it('live=true → chỉ lấy trận đang live', async () => {
    expect(await runOnce(true)).toMatchObject({ live: true, tagIds: [65] });
  });
});
