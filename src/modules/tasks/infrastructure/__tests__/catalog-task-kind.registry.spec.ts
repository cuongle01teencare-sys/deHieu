import { CatalogTaskKindRegistry } from '../runtime/catalog-task-kind.registry.js';
import { TASK_CATALOG } from '../runtime/task-catalog.js';

const kinds = new CatalogTaskKindRegistry(TASK_CATALOG);

describe('CatalogTaskKindRegistry.validateParams', () => {
  it('polymarket.descriptor thiếu tagIds → lỗi nêu rõ trường', () => {
    const r = kinds.validateParams('polymarket.descriptor', {
      intervalMs: 30_000,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('tagIds');
  });

  it('điền mặc định', () => {
    const r = kinds.validateParams('polymarket.descriptor', {
      tagIds: [100639],
    });
    expect(r).toEqual({
      ok: true,
      params: { tagIds: [100639], intervalMs: 30_000 },
    });
  });

  it('trường lạ (gõ nhầm / nhầm kind) → lỗi', () => {
    const r = kinds.validateParams('polymarket.stream', { intervalMs: 2000 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('intervalMs');
  });

  it('sptpub hợp lệ', () => {
    const r = kinds.validateParams('sptpub.prematch', {
      baseUrl: 'https://api-h-x.sptpub.com',
      brandId: '1',
      lang: 'en',
      intervalMs: 2000,
    });
    expect(r.ok).toBe(true);
  });

  it('/tasks/kinds kèm JSON Schema của params', () => {
    const d = kinds.list().find((k) => k.kind === 'polymarket.descriptor');
    expect(JSON.stringify(d?.paramsSchema)).toContain('tagIds');
  });
});
