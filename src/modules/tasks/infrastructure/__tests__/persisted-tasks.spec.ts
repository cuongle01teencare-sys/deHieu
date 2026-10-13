import { TaskSupervisor } from '../../application/task-supervisor.js';
import { StartTaskHandler } from '../../application/commands/start-task.command.js';
import { StopTaskHandler } from '../../application/commands/stop-task.command.js';
import { DeleteTaskHandler } from '../../application/commands/delete-task.command.js';
import { RestartTaskHandler } from '../../application/commands/restart-task.command.js';
import { RestorePersistedTasks } from '../../application/restore-persisted-tasks.js';
import type { TaskKindRegistry } from '../../application/task-kind.registry.js';
import type {
  NodeChange,
  NodeDirectory,
  NodeView,
} from '../../application/node-directory.js';
import type { TaskLauncher } from '../../application/task-launcher.js';
import type { TaskSpec } from '../../domain/task-spec.js';
import { InMemoryTaskRegistry } from '../persistence/in-memory-task.registry.js';
import { InMemoryTaskSpecStore } from '../persistence/in-memory-task-spec.store.js';
import { NoopTaskAlertNotifier } from '../notifier/noop-task-alert.notifier.js';

const kinds: TaskKindRegistry = {
  find: (kind) => ({
    kind,
    tenant: kind.split('.')[0] ?? kind,
    multiInstance: true,
  }),
  list: () => [],
  validateParams: (_k, params) => ({
    ok: true,
    params: params as Record<string, unknown>,
  }),
};

/** Launcher giả: task trả lời ready/started ngay. */
const fakeLauncher = (): TaskLauncher & { launched: string[] } => {
  const launched: string[] = [];
  return {
    launched,
    supports: () => true,
    launch: (spec: TaskSpec) => {
      launched.push(spec.taskId);
      let onMsg: (m: unknown) => void = () => undefined;
      return Promise.resolve({
        send: (m: { type: string }) => {
          if (m.type === 'init') queueMicrotask(() => onMsg({ type: 'ready' }));
          if (m.type === 'start')
            queueMicrotask(() => onMsg({ type: 'started' }));
          if (m.type === 'stop')
            queueMicrotask(() => onMsg({ type: 'stopped' }));
        },
        onMessage: (l: (m: unknown) => void) => {
          onMsg = l;
        },
        onExit: () => undefined,
        terminate: () => Promise.resolve(),
      });
    },
  } as unknown as TaskLauncher & { launched: string[] };
};

class FakeNodes implements NodeDirectory {
  nodes: NodeView[] = [];
  private _l: ((c: NodeChange) => void)[] = [];
  list() {
    return this.nodes;
  }
  onChange(l: (c: NodeChange) => void) {
    this._l.push(l);
  }
  connect(nodeId: string) {
    this.nodes.push({
      nodeId,
      connected: true,
      connectedAt: Date.now(),
      disconnectedAt: null,
      tasks: 0,
    });
    this._l.forEach((l) => l({ type: 'connected', nodeId }));
  }
}

const setup = () => {
  const launcher = fakeLauncher();
  const sup = new TaskSupervisor(
    [launcher],
    new InMemoryTaskRegistry(),
    new NoopTaskAlertNotifier(),
  );
  const store = new InMemoryTaskSpecStore();
  const start = new StartTaskHandler(sup, kinds, store);
  const nodes = new FakeNodes();
  const restore = new RestorePersistedTasks(store, sup, start, nodes, {
    log: () => undefined,
    warn: () => undefined,
  });
  return {
    launcher,
    sup,
    store,
    start,
    nodes,
    restore,
    stop: new StopTaskHandler(sup, store),
    del: new DeleteTaskHandler(sup, store),
    restart: new RestartTaskHandler(sup, start),
  };
};

const spec = (taskId: string, extra: Partial<TaskSpec> = {}): TaskSpec => ({
  taskId,
  kind: 'polymarket.descriptor',
  tenant: 'polymarket',
  params: { tagIds: [65] },
  runtime: { type: 'worker' },
  persist: true,
  ...extra,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('task lưu bền (persist)', () => {
  it('stop → giữ bản lưu nhưng desired = stopped; delete → xóa khỏi bản lưu', async () => {
    const t = setup();
    await t.start.execute({ ...spec('a'), persist: true });
    await flush();
    await t.stop.execute({ taskId: 'a' });
    expect((await t.store.list())[0]?.desired).toBe('stopped');
    await t.del.execute({ taskId: 'a' });
    expect(await t.store.list()).toEqual([]);
  });

  it('restart (POST /tasks/:id/start) chạy lại với spec cũ, desired về running', async () => {
    const t = setup();
    await t.start.execute({ ...spec('a'), persist: true });
    await flush();
    await t.stop.execute({ taskId: 'a' });
    const r = await t.restart.execute({ taskId: 'a' });
    expect(r.status).toBe('SUCEED');
    expect((await t.store.list())[0]?.desired).toBe('running');
    expect(t.launcher.launched).toEqual(['a', 'a']);
  });

  it('khởi động app: running → chạy lại, stopped → chỉ hiện STOPPED', async () => {
    const t = setup();
    await t.store.save({ spec: spec('run'), desired: 'running' });
    await t.store.save({ spec: spec('off'), desired: 'stopped' });
    await t.restore.run();
    await flush();
    expect(t.launcher.launched).toEqual(['run']);
    expect((await t.sup.get('run'))?.state).toBe('RUNNING');
    expect((await t.sup.get('off'))?.state).toBe('STOPPED');
    expect((await t.sup.get('off'))?.spec.persist).toBe(true);
  });

  it('task trên node chưa kết nối → chờ node kết nối rồi mới chạy', async () => {
    const t = setup();
    await t.store.save({
      spec: spec('remote', { runtime: { type: 'remote', nodeId: 'n1' } }),
      desired: 'running',
    });
    await t.restore.run();
    expect(t.launcher.launched).toEqual([]);
    expect((await t.sup.get('remote'))?.state).toBe('STOPPED');
    t.nodes.connect('n1');
    await flush();
    await flush();
    expect(t.launcher.launched).toEqual(['remote']);
  });
});

describe('TaskSupervisor: dừng task đang chờ khởi động lại', () => {
  it('stop lúc RESTARTING → hủy hẹn giờ, task không tự sống lại', async () => {
    vi.useFakeTimers();
    try {
      let launches = 0;
      const failing = {
        supports: () => true,
        launch: () => {
          launches++;
          return Promise.reject(new Error('boom'));
        },
      } as unknown as TaskLauncher;
      const sup = new TaskSupervisor(
        [failing],
        new InMemoryTaskRegistry(),
        new NoopTaskAlertNotifier(),
      );
      await sup.start(spec('x'));
      expect((await sup.get('x'))?.state).toBe('RESTARTING');
      await sup.stop('x');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(launches).toBe(1);
      expect((await sup.get('x'))?.state).toBe('STOPPED');
    } finally {
      vi.useRealTimers();
    }
  });
});
