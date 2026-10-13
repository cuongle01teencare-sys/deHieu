import type { RawOddsTranslator } from './raw-odds.translator.js';

/** kind → translator. Hai translator cùng nhận một kind = lỗi cấu hình, báo ngay lúc khởi động. */
export class TranslatorRouter {
  private readonly _byKind = new Map<string, RawOddsTranslator>();
  private readonly _pending = new Map<RawOddsTranslator, Promise<unknown>>();

  constructor(private readonly _translators: readonly RawOddsTranslator[]) {
    for (const t of _translators)
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

  /** Serialize cache mutations per translator; room writes still use independent lanes. */
  run<T>(translator: RawOddsTranslator, work: () => Promise<T>): Promise<T> {
    const previous = this._pending.get(translator) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this._pending.set(translator, next);
    void next
      .finally(() => {
        if (this._pending.get(translator) === next)
          this._pending.delete(translator);
      })
      .catch(() => undefined);
    return next;
  }

  all(): readonly RawOddsTranslator[] {
    return this._translators;
  }
}
