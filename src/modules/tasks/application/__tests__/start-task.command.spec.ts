import { StartTaskHandler } from '../commands/start-task.command.js';
import type { TaskKindRegistry } from '../task-kind.registry.js';
import type { TaskSupervisor } from '../task-supervisor.js';
import type {
  PersistedTask,
  PersistedTaskDesired,
  TaskSpecStore,
} from '../task-spec.store.js';

/** Bản lưu bền giả trong RAM (application test không dùng adapter infrastructure). */
class InMemoryTaskSpecStore implements TaskSpecStore {
  private readonly _tasks = new Map<string, PersistedTask>();
  list() {
    return Promise.resolve([...this._tasks.values()]);
  }
  save(task: PersistedTask) {
    this._tasks.set(task.spec.taskId, task);
    return Promise.resolve();
  }
  setDesired(taskId: string, desired: PersistedTaskDesired) {
    const cur = this._tasks.get(taskId);
    if (cur) this._tasks.set(taskId, { ...cur, desired });
    return Promise.resolve();
  }
  delete(taskId: string) {
    this._tasks.delete(taskId);
    return Promise.resolve();
  }
}

const kinds: TaskKindRegistry = {
  find: (kind) =>
    kind === 'sptpub.live'
      ? { kind, tenant: 'sptpub', multiInstance: false }
      : kind === 'polymarket.descriptor'
        ? { kind, tenant: 'polymarket', multiInstance: true }
        : null,
  list: () => [
    { kind: 'sptpub.live', tenant: 'sptpub', multiInstance: false },
    {
      kind: 'polymarket.descriptor',
      tenant: 'polymarket',
      multiInstance: true,
    },
  ],
  validateParams: (_kind, params) =>
    params && typeof params === 'object' && 'bad' in params
      ? { ok: false, error: '✖ bad' }
      : { ok: true, params: { ...(params as object), filled: true } },
};

const supervisor = (records: unknown[] = []) => {
  const start = vi.fn().mockResolvedValue({ status: 'NOT_FOUND' });
  const list = vi.fn().mockResolvedValue(records);
  return { start, sup: { start, list } as unknown as TaskSupervisor };
};

describe('StartTaskHandler', () => {
  it('tự suy tenant từ kind', async () => {
    const { start, sup } = supervisor();
    const h = new StartTaskHandler(sup, kinds, new InMemoryTaskSpecStore());
    await h.execute({
      taskId: 't1',
      kind: 'sptpub.live',
      params: {},
      runtime: { type: 'worker' },
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        tenant: 'sptpub',
        params: { filled: true }, // dùng params đã kiểm tra + điền mặc định
        persist: false,
      }),
    );
  });

  it('params sai → INVALID_PARAMS, không tạo task', async () => {
    const { start, sup } = supervisor();
    const h = new StartTaskHandler(sup, kinds, new InMemoryTaskSpecStore());
    const r = await h.execute({
      taskId: 't3',
      kind: 'sptpub.live',
      params: { bad: 1 },
      runtime: { type: 'worker' },
    });
    expect(r.status === 'FAILED' && r.reason).toContain('INVALID_PARAMS');
    expect(start).not.toHaveBeenCalled();
  });

  it('kind lạ → FAILED, không tạo task', async () => {
    const { start, sup } = supervisor();
    const h = new StartTaskHandler(sup, kinds, new InMemoryTaskSpecStore());
    const r = await h.execute({
      taskId: 't2',
      kind: 'bet88.feed',
      params: {},
      runtime: { type: 'worker' },
    });
    expect(r.status).toBe('FAILED');
    expect(r.status === 'FAILED' && r.reason).toContain('UNKNOWN_KIND');
    expect(start).not.toHaveBeenCalled();
  });

  it('kind đơn instance đang chạy ở task khác → KIND_ALREADY_RUNNING', async () => {
    const { start, sup } = supervisor([
      { spec: { taskId: 'old', kind: 'sptpub.live' }, state: 'RUNNING' },
    ]);
    const h = new StartTaskHandler(sup, kinds, new InMemoryTaskSpecStore());
    const r = await h.execute({
      taskId: 'new',
      kind: 'sptpub.live',
      params: {},
      runtime: { type: 'worker' },
    });
    expect(r.status === 'FAILED' && r.reason).toContain('KIND_ALREADY_RUNNING');
    expect(start).not.toHaveBeenCalled();
  });

  it('kind multiInstance: chạy được nhiều task (vd mỗi môn một descriptor)', async () => {
    const { start, sup } = supervisor([
      {
        spec: { taskId: 'poly-lol', kind: 'polymarket.descriptor' },
        state: 'RUNNING',
      },
    ]);
    const h = new StartTaskHandler(sup, kinds, new InMemoryTaskSpecStore());
    await h.execute({
      taskId: 'poly-cs2',
      kind: 'polymarket.descriptor',
      params: { tagIds: [100780] },
      runtime: { type: 'worker' },
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'poly-cs2' }),
    );
  });

  it('persist = true → lưu bền với desired running', async () => {
    const { sup } = supervisor();
    const store = new InMemoryTaskSpecStore();
    const h = new StartTaskHandler(sup, kinds, store);
    await h.execute({
      taskId: 'p1',
      kind: 'sptpub.live',
      params: {},
      runtime: { type: 'worker' },
      persist: true,
    });
    const saved = await store.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.desired).toBe('running');
    expect(saved[0]?.spec).toMatchObject({ taskId: 'p1', persist: true });
  });

  it('chạy lại task cũ không gửi persist → giữ cờ persist của hồ sơ cũ', async () => {
    const { start, sup } = supervisor([
      {
        spec: { taskId: 'p1', kind: 'sptpub.live', persist: true },
        state: 'STOPPED',
      },
    ]);
    const store = new InMemoryTaskSpecStore();
    const h = new StartTaskHandler(sup, kinds, store);
    await h.execute({
      taskId: 'p1',
      kind: 'sptpub.live',
      params: {},
      runtime: { type: 'worker' },
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ persist: true }),
    );
    expect((await store.list())[0]?.desired).toBe('running');
  });

  it('persist = false → xóa bản lưu bền cũ cùng taskId', async () => {
    const { sup } = supervisor();
    const store = new InMemoryTaskSpecStore();
    await store.save({
      spec: {
        taskId: 'p1',
        kind: 'sptpub.live',
        tenant: 'sptpub',
        params: {},
        runtime: { type: 'worker' },
        persist: true,
      },
      desired: 'stopped',
    });
    const h = new StartTaskHandler(sup, kinds, store);
    await h.execute({
      taskId: 'p1',
      kind: 'sptpub.live',
      params: {},
      runtime: { type: 'worker' },
      persist: false,
    });
    expect(await store.list()).toEqual([]);
  });

  it('task đang chạy cùng taskId → ALREADY_RUNNING, không ghi đè bản lưu bền', async () => {
    const { start, sup } = supervisor([
      { spec: { taskId: 'p1', kind: 'sptpub.live' }, state: 'RUNNING' },
    ]);
    const store = new InMemoryTaskSpecStore();
    const h = new StartTaskHandler(sup, kinds, store);
    const r = await h.execute({
      taskId: 'p1',
      kind: 'sptpub.live',
      params: {},
      runtime: { type: 'worker' },
      persist: true,
    });
    expect(r.status === 'FAILED' && r.reason).toContain('ALREADY_RUNNING');
    expect(start).not.toHaveBeenCalled();
    expect(await store.list()).toEqual([]);
  });
});
