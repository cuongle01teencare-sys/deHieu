import type { RawOddsTranslator } from './raw-odds.translator.js';

/** kind → translator. Hai translator cùng nhận một kind = lỗi cấu hình, báo ngay lúc khởi động. */
export class TranslatorRouter {
  private readonly _byKind = new Map<string, RawOddsTranslator>();

  constructor(translators: readonly RawOddsTranslator[]) {
    for (const t of translators)
      for (const kind of t.kinds) {
        const taken = this._byKind.get(kind);
        if (taken)
          throw new Error(
            `kind "${kind}" đã được ${taken.tenant} nhận, không thể gán thêm cho ${t.tenant}`,
          );
        this._byKind.set(kind, t);
      }
  }

  find(kind: string): RawOddsTranslator | undefined {
    return this._byKind.get(kind);
  }
}
