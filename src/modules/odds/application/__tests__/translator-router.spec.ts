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
});
