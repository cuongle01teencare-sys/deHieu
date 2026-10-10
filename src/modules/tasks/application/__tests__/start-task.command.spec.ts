import { StartTaskHandler } from '../commands/start-task.command.js';
import type { TaskKindRegistry } from '../task-kind.registry.js';
import type { TaskSupervisor } from '../task-supervisor.js';

const kinds: TaskKindRegistry = {
  find: (kind) => (kind === 'sptpub.live' ? { kind, tenant: 'sptpub' } : null),
  list: () => [{ kind: 'sptpub.live', tenant: 'sptpub' }],
};

describe('StartTaskHandler', () => {
  it('tự suy tenant từ kind', async () => {
    const start = vi.fn().mockResolvedValue({ status: 'NOT_FOUND' });
    const h = new StartTaskHandler(
      {
        start,
        list: vi.fn().mockResolvedValue([]),
      } as unknown as TaskSupervisor,
      kinds,
    );
    await h.execute({
      taskId: 't1',
      kind: 'sptpub.live',
      params: {},
      runtime: { type: 'worker' },
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', tenant: 'sptpub' }),
    );
  });

  it('kind lạ → FAILED, không tạo task', async () => {
    const start = vi.fn();
    const h = new StartTaskHandler(
      {
        start,
        list: vi.fn().mockResolvedValue([]),
      } as unknown as TaskSupervisor,
      kinds,
    );
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

  it('kind đang chạy ở task khác → KIND_ALREADY_RUNNING', async () => {
    const start = vi.fn();
    const list = vi
      .fn()
      .mockResolvedValue([
        { spec: { taskId: 'old', kind: 'sptpub.live' }, state: 'RUNNING' },
      ]);
    const h = new StartTaskHandler(
      { start, list } as unknown as TaskSupervisor,
      kinds,
    );
    const r = await h.execute({
      taskId: 'new',
      kind: 'sptpub.live',
      params: {},
      runtime: { type: 'worker' },
    });
    expect(r.status === 'FAILED' && r.reason).toContain('KIND_ALREADY_RUNNING');
    expect(start).not.toHaveBeenCalled();
  });
});
