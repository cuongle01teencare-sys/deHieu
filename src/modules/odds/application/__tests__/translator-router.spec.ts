import type { RawOddsTranslator } from '../raw-odds.translator.js';
import { TranslatorRouter } from '../translator-router.js';

const t = (tenant: string, kinds: string[]): RawOddsTranslator => ({
  tenant,
  kinds,
  translate: () => Promise.resolve([]),
  release: () => Promise.resolve([]),
});

describe('TranslatorRouter', () => {
  it('chọn translator theo kind', () => {
    const a = t('a', ['a.feed']);
    const b = t('b', ['b.events', 'b.stream']);
    const r = new TranslatorRouter([a, b]);
    expect(r.find('b.stream')).toBe(b);
    expect(r.find('c.feed')).toBeUndefined();
  });

  it('hai translator cùng nhận một kind → lỗi ngay lúc khởi tạo', () => {
    expect(
      () => new TranslatorRouter([t('a', ['x.feed']), t('b', ['x.feed'])]),
    ).toThrow(/x\.feed/);
  });

  it('serializes cache mutations without blocking another tenant', async () => {
    const a = t('a', ['a.feed']);
    const b = t('b', ['b.feed']);
    const r = new TranslatorRouter([a, b]);
    const order: string[] = [];
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const first = r.run(a, async () => {
      order.push('a1');
      await blocked;
    });
    const second = r.run(a, () => {
      order.push('a2');
      return Promise.resolve();
    });
    await r.run(b, () => {
      order.push('b');
      return Promise.resolve();
    });
    expect(order).toEqual(['a1', 'b']);
    unblock();
    await Promise.all([first, second]);
    expect(order).toEqual(['a1', 'b', 'a2']);
  });

  it('a failed translation does not poison the queue', async () => {
    const a = t('a', ['a.feed']);
    const r = new TranslatorRouter([a]);
    const failed = r.run(a, () => Promise.reject(new Error('bad payload')));
    const next = r.run(a, () => Promise.resolve('recovered'));
    await expect(failed).rejects.toThrow('bad payload');
    await expect(next).resolves.toBe('recovered');
  });

  it('does not wait for lane writes while serializing translator work', async () => {
    const a = t('a', ['a.feed']);
    const r = new TranslatorRouter([a]);
    let complete!: () => void;
    const applied = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const job = await r.run(a, () => Promise.resolve({ applied }));
    await expect(r.run(a, () => Promise.resolve('next phase'))).resolves.toBe(
      'next phase',
    );
    complete();
    await job.applied;
  });
});
