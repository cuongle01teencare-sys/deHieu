import { WebSocket } from 'ws';
import { safeEqual } from '../safe-equal.js';
import { ConsumerHub } from '../../../../modules/odds/infrastructure/consumer/consumer-hub.js';
import { WsRemoteTaskLauncher } from '../../../../modules/tasks/infrastructure/remote/ws-remote.task-launcher.js';

const TOKEN = 'consumer-token-0123456789';

/** Cổng thật của server đang nghe ở port 0 (chờ tới khi server nghe xong). */
const portOf = async (o: unknown): Promise<number> => {
  const s = (o as { _server: { address(): { port: number } | null } })._server;
  for (let i = 0; i < 100 && !s.address(); i++)
    await new Promise((r) => setTimeout(r, 10));
  return s.address()!.port;
};

const open = (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: unknown[] = [];
  ws.on('message', (raw) =>
    frames.push(JSON.parse((raw as Buffer).toString())),
  );
  ws.on('error', () => undefined);
  const opened = new Promise<void>((r) => ws.once('open', () => r()));
  const closed = new Promise<number>((r) =>
    ws.once('close', (code) => r(code)),
  );
  return { ws, frames, opened, closed };
};

describe('safeEqual', () => {
  it('đúng khi trùng, sai khi khác / khác độ dài / không phải string / rỗng', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abd', 'abc')).toBe(false);
    expect(safeEqual('abcd', 'abc')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
    expect(safeEqual(123, 'abc')).toBe(false);
    expect(safeEqual('', '')).toBe(false);
  });
});

describe('ConsumerHub: củng cố kết nối', () => {
  let hub: ConsumerHub;
  beforeEach(() => {
    hub = new ConsumerHub({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      helloTimeoutMs: 150,
      maxPayloadBytes: 1024,
    });
    hub.listen();
  });
  afterEach(() => hub.close());

  it('token sai → rejected rồi đóng', async () => {
    const c = open(await portOf(hub));
    await c.opened;
    c.ws.send(
      JSON.stringify({
        type: 'hello',
        v: 1,
        consumerId: 'b',
        role: 'trader',
        token: 'sai',
      }),
    );
    await c.closed;
    expect(c.frames[0]).toEqual({ type: 'rejected', reason: 'BAD_HELLO' });
  });

  it('không gửi hello → bị ngắt sau helloTimeoutMs', async () => {
    const c = open(await portOf(hub));
    await c.opened;
    const t0 = Date.now();
    await c.closed;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
  });

  it('frame vượt maxPayload → đóng kết nối (1009)', async () => {
    const c = open(await portOf(hub));
    await c.opened;
    c.ws.send('x'.repeat(4096));
    expect(await c.closed).toBe(1009);
  });

  it('token đúng → welcome và không bị ngắt vì hết giờ hello', async () => {
    const c = open(await portOf(hub));
    await c.opened;
    c.ws.send(
      JSON.stringify({
        type: 'hello',
        v: 1,
        consumerId: 'b',
        role: 'trader',
        token: TOKEN,
      }),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(c.frames[0]).toMatchObject({ type: 'welcome' });
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
  });
});

describe('WsRemoteTaskLauncher: củng cố kết nối', () => {
  let launcher: WsRemoteTaskLauncher;
  beforeEach(() => {
    launcher = new WsRemoteTaskLauncher(0, 'task-token-0123456789', {
      host: '127.0.0.1',
      helloTimeoutMs: 150,
      maxPayloadBytes: 1024,
    });
    launcher.listen();
  });
  afterEach(() => launcher.close());

  it('token sai → BAD_TOKEN; đúng → node xuất hiện', async () => {
    const bad = open(await portOf(launcher));
    await bad.opened;
    bad.ws.send(
      JSON.stringify({
        type: 'hello',
        nodeId: 'n1',
        token: 'task-token-0123456788',
      }),
    );
    await bad.closed;
    expect(bad.frames[0]).toEqual({ type: 'rejected', reason: 'BAD_TOKEN' });

    const good = open(await portOf(launcher));
    await good.opened;
    good.ws.send(
      JSON.stringify({
        type: 'hello',
        nodeId: 'n1',
        token: 'task-token-0123456789',
      }),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(launcher.connectedNodes()).toEqual(['n1']);
    good.ws.close();
  });

  it('không gửi hello → bị ngắt; frame quá lớn → 1009', async () => {
    const idle = open(await portOf(launcher));
    await idle.opened;
    await idle.closed;

    const big = open(await portOf(launcher));
    await big.opened;
    big.ws.send('x'.repeat(4096));
    expect(await big.closed).toBe(1009);
  });
});
