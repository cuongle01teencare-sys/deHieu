import type { OddsLineChange } from './raw-odds.translator.js';

/**
 * Lý do một phần dữ liệu thô bị translator bỏ qua (không thành dòng kèo).
 * Đếm theo tenant × kind để admin thấy dữ liệu "rơi" ở đâu.
 */
export const SKIP_REASONS = [
  'parse_failed', // payload sai schema (tenant đổi định dạng?)
  'unsupported_event', // stream hợp lệ nhưng không cung cấp best ask hay trạng thái đóng market
  'unsupported_sport', // môn chưa có trong mapping
  'invalid_event', // trận ảo / không phải match / thiếu đội
  'unsupported_market', // loại market chưa map
  'unsupported_line', // market đã map nhưng mức/mốc/số map ngoài danh sách
  'missing_fields', // thiếu id, giờ bắt đầu, token...
  'same_team_names', // hai đội trùng tên sau chuẩn hóa
  'no_moneyline_teams', // market Over/Under nhưng event không có moneyline để biết đội
  'unknown_asset', // giá của token không thuộc market nào đang theo dõi
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Translator gọi khi bỏ qua dữ liệu. Mặc định không làm gì (test, công cụ). */
export type SkipReporter = (kind: string, reason: SkipReason) => void;
export const NO_SKIP_REPORTER: SkipReporter = () => undefined;

export interface IngestCounter {
  readonly tenant: string;
  readonly kind: string;
  /** Số message đã nhận. */
  readonly received: number;
  /** Translator ném lỗi (khác với bỏ qua có chủ đích). */
  readonly failed: number;
  /** Số thay đổi dòng kèo sinh ra. */
  readonly set: number;
  readonly remove: number;
  readonly skipped: Readonly<Partial<Record<SkipReason, number>>>;
  readonly lastReceivedAt: number | null;
  readonly lastChangeAt: number | null;
}

export interface IngestSnapshot {
  /** Bộ đếm cộng dồn từ lúc này (app khởi động). Tốc độ = chênh lệch giữa hai lần lấy. */
  readonly since: number;
  readonly at: number;
  readonly items: readonly IngestCounter[];
}

type Mutable = {
  -readonly [K in keyof IngestCounter]: K extends 'skipped'
    ? Partial<Record<SkipReason, number>>
    : IngestCounter[K];
};

/** Bộ đếm theo chặng: nhận → (bỏ qua theo lý do | lỗi) → thay đổi dòng kèo. */
export class IngestStats {
  private readonly _m = new Map<string, Mutable>();
  private readonly _since: number;

  constructor(private readonly _now: () => number = Date.now) {
    this._since = _now();
  }

  received(tenant: string, kind: string): void {
    const c = this._c(tenant, kind);
    c.received++;
    c.lastReceivedAt = this._now();
  }

  emitted(
    tenant: string,
    kind: string,
    changes: readonly OddsLineChange[],
  ): void {
    if (!changes.length) return;
    const c = this._c(tenant, kind);
    for (const ch of changes)
      if (ch.type === 'set') c.set++;
      else c.remove++;
    c.lastChangeAt = this._now();
  }

  failed(tenant: string, kind: string): void {
    this._c(tenant, kind).failed++;
  }

  skipped(tenant: string, kind: string, reason: SkipReason): void {
    const s = this._c(tenant, kind).skipped;
    s[reason] = (s[reason] ?? 0) + 1;
  }

  /** Reporter gắn sẵn tenant, đưa cho translator. */
  reporter(tenant: string): SkipReporter {
    return (kind, reason) => this.skipped(tenant, kind, reason);
  }

  snapshot(): IngestSnapshot {
    return {
      since: this._since,
      at: this._now(),
      items: [...this._m.values()]
        .map((c) => ({ ...c, skipped: { ...c.skipped } }))
        .sort(
          (a, b) =>
            a.tenant.localeCompare(b.tenant) || a.kind.localeCompare(b.kind),
        ),
    };
  }

  private _c(tenant: string, kind: string): Mutable {
    const id = `${tenant}|${kind}`;
    let c = this._m.get(id);
    if (!c) {
      c = {
        tenant,
        kind,
        received: 0,
        failed: 0,
        set: 0,
        remove: 0,
        skipped: {},
        lastReceivedAt: null,
        lastChangeAt: null,
      };
      this._m.set(id, c);
    }
    return c;
  }
}
