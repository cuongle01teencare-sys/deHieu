/**
 * Bản sao trạng thái feed sptpub (snapshot + delta) giữ TRONG worker, để tự đối chiếu.
 *
 * Vì sao: sptpub có lúc đổi/gỡ market mà KHÔNG gửi delta (đã kiểm chứng: market gỡ chỉ biến mất
 * khỏi snapshot). Task định kỳ tải lại snapshot, so với bản sao này và chỉ phát phần chênh lệch
 * dưới dạng một delta tổng hợp — app không phải xử lý lại cả snapshot (~3,7 MB) mỗi chu kỳ.
 *
 * Chỉ hiểu khung dữ liệu chung (event → desc / markets → specifier → outcome), không hiểu nghĩa nghiệp vụ.
 */
type Outcome = unknown;
type Specs = Map<string, Map<string, Outcome>>; // specifier → outcomeId → outcome
interface EventState {
  desc?: unknown;
  markets: Map<string, Specs>; // marketId → specs
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export class SptPubFeedState {
  private readonly _events = new Map<string, EventState>();

  get size(): number {
    return this._events.size;
  }

  /** Gộp `events` của một phần snapshot hoặc delta (null = gỡ ở mọi cấp). */
  apply(events: unknown): void {
    if (!isObj(events)) return;
    for (const [id, ev] of Object.entries(events)) {
      if (ev === null) {
        this._events.delete(id);
        continue;
      }
      if (!isObj(ev)) continue;
      const cur: EventState = this._events.get(id) ?? {
        markets: new Map<string, Specs>(),
      };
      this._events.set(id, cur);
      if (ev.desc !== undefined) cur.desc = ev.desc;
      if (!isObj(ev.markets)) continue;
      for (const [m, specs] of Object.entries(ev.markets)) {
        if (specs === null) {
          cur.markets.delete(m);
          continue;
        }
        if (!isObj(specs)) continue;
        const ms: Specs =
          cur.markets.get(m) ?? new Map<string, Map<string, Outcome>>();
        cur.markets.set(m, ms);
        for (const [s, outs] of Object.entries(specs)) {
          if (outs === null) {
            ms.delete(s);
            continue;
          }
          if (!isObj(outs)) continue;
          const os = ms.get(s) ?? new Map<string, Outcome>();
          ms.set(s, os);
          for (const [o, out] of Object.entries(outs))
            if (out === null) os.delete(o);
            else os.set(o, out);
        }
      }
    }
  }

  /**
   * Phần chênh lệch để đưa bản sao này về đúng `fresh`, ở dạng `events` của một delta sptpub:
   * event/market/specifier/outcome không còn → null; mới hoặc khác → giá trị mới.
   * Không lệch → object rỗng.
   */
  diffTo(fresh: SptPubFeedState): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const id of this._events.keys())
      if (!fresh._events.has(id)) out[id] = null;
    for (const [id, f] of fresh._events) {
      const o = this._events.get(id);
      if (!o) {
        out[id] = toJson(f);
        continue;
      }
      const ev: Json = {};
      if (!same(o.desc, f.desc)) ev.desc = f.desc;
      const markets: Json = {};
      for (const m of new Set([...o.markets.keys(), ...f.markets.keys()])) {
        const om = o.markets.get(m);
        const fm = f.markets.get(m);
        if (!fm) {
          markets[m] = null;
          continue;
        }
        const specs: Json = {};
        for (const s of new Set([...(om?.keys() ?? []), ...fm.keys()])) {
          const os = om?.get(s);
          const fs = fm.get(s);
          if (!fs) {
            specs[s] = null;
            continue;
          }
          const outs: Json = {};
          for (const k of new Set([...(os?.keys() ?? []), ...fs.keys()])) {
            const a = os?.get(k);
            const b = fs.get(k);
            if (b === undefined) outs[k] = null;
            else if (!same(a, b)) outs[k] = b;
          }
          if (Object.keys(outs).length) specs[s] = outs;
        }
        if (Object.keys(specs).length) markets[m] = specs;
      }
      if (Object.keys(markets).length) ev.markets = markets;
      // chỉ kèm desc khi desc đổi (giống delta thật): translator đã có trận này từ trước
      if (Object.keys(ev).length) out[id] = ev;
    }
    return out;
  }
}

const toJson = (e: EventState): Json => ({
  ...(e.desc !== undefined ? { desc: e.desc } : {}),
  markets: Object.fromEntries(
    [...e.markets].map(([m, specs]) => [
      m,
      Object.fromEntries(
        [...specs].map(([s, outs]) => [s, Object.fromEntries(outs)]),
      ),
    ]),
  ),
});
