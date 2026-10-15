/** Vị trí của một trận trong giải: trận thứ `no` trên `of` trận sàn đang liệt kê. */
export interface TournamentPosition {
  readonly no: number;
  readonly of: number;
}

/**
 * Thứ tự trận trong giải theo MỘT sàn: gom các trận cùng giải sàn đang liệt kê, xếp theo giờ bắt
 * đầu (cùng giờ thì theo mã trận) → trận thứ mấy. Tính trong RAM ngay lúc dịch dữ liệu, gắn vào
 * dòng kèo nên consumer nhận được luôn, không phải fetch thêm.
 * Lưu ý: sàn thường chỉ liệt kê trận sắp đá / đang đá, nên "thứ 8" là thứ 8 trong số trận sàn còn hiện.
 */
export class TournamentOrder {
  private readonly _byTour = new Map<string, Map<string, number>>();
  private readonly _tourOf = new Map<string, string>();
  /** Thứ hạng đã tính theo giải; xóa khi giải đổi thành viên / giờ. */
  private readonly _cache = new Map<string, Map<string, number>>();

  set(eventId: string, tournament: string, startsAt: number): void {
    const prev = this._tourOf.get(eventId);
    if (
      prev === tournament &&
      this._byTour.get(prev)?.get(eventId) === startsAt
    )
      return;
    if (prev !== undefined) this.delete(eventId);
    const m = this._byTour.get(tournament) ?? new Map<string, number>();
    m.set(eventId, Number.isFinite(startsAt) ? startsAt : 0);
    this._byTour.set(tournament, m);
    this._tourOf.set(eventId, tournament);
    this._cache.delete(tournament);
  }

  delete(eventId: string): void {
    const tour = this._tourOf.get(eventId);
    if (tour === undefined) return;
    this._tourOf.delete(eventId);
    const m = this._byTour.get(tour);
    m?.delete(eventId);
    if (m && !m.size) this._byTour.delete(tour);
    this._cache.delete(tour);
  }

  has(eventId: string): boolean {
    return this._tourOf.has(eventId);
  }

  position(eventId: string): TournamentPosition | null {
    const tour = this._tourOf.get(eventId);
    if (tour === undefined) return null;
    const m = this._byTour.get(tour)!;
    let ranks = this._cache.get(tour);
    if (!ranks) {
      ranks = new Map(
        [...m.entries()]
          .sort(
            (a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
          )
          .map(([id], i) => [id, i + 1]),
      );
      this._cache.set(tour, ranks);
    }
    const no = ranks.get(eventId);
    return no ? { no, of: m.size } : null;
  }

  /** Các trường gắn vào ref của dòng kèo: tour (tên/mã giải), tno, tof. */
  refFields(eventId: string, label: string | null): Record<string, string> {
    const p = this.position(eventId);
    if (!p) return {};
    return {
      ...(label ? { tour: label } : {}),
      tno: String(p.no),
      tof: String(p.of),
    };
  }
}
