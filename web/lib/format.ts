/** Định dạng số liệu theo nguyên tắc thiết kế: odds 2 chữ số, margin %, tuổi dữ liệu tương đối. */

const nf = new Intl.NumberFormat('en-US');

export const fmtInt = (n: number): string => nf.format(Math.round(n));

/** 12345 → "12.3k" khi lớn, giữ nguyên khi nhỏ. */
export const fmtCompact = (n: number): string =>
  n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : fmtInt(n);

export const fmtOdds = (o: number | null | undefined): string =>
  o == null || !Number.isFinite(o) ? '—' : o.toFixed(2);

/** 0.0235 → "+2.35%", -0.012 → "-1.20%". */
export const fmtMargin = (m: number | null | undefined): string => {
  if (m == null || !Number.isFinite(m)) return '—';
  const pct = (m * 100).toFixed(2);
  return m > 0 ? `+${pct}%` : `${pct}%`;
};

export const fmtPct = (ratio: number, digits = 1): string =>
  `${(ratio * 100).toFixed(digits)}%`;

/** Tuổi dữ liệu: 3200 → "3s", 125000 → "2m", 7200000 → "2h". */
export const fmtAge = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
};

/** "3 phút trước", "42 giây trước". */
export const fmtSince = (at: number, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s} giây trước`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} giờ trước` : `${Math.round(h / 24)} ngày trước`;
};

/** Trận sắp đấu: "Bắt đầu sau 34 phút"; đã qua giờ: "Đã bắt đầu 12 phút". */
export const fmtStarts = (startsAt: number, now = Date.now()): string => {
  const diff = startsAt - now;
  const m = Math.round(Math.abs(diff) / 60_000);
  const txt =
    m < 60 ? `${m} phút` : m < 48 * 60 ? `${Math.round(m / 60)} giờ` : `${Math.round(m / 1440)} ngày`;
  return diff >= 0 ? `Bắt đầu sau ${txt}` : `Đã bắt đầu ${txt}`;
};

/** "12 Oct 2026, 21:27 ICT" theo giờ Việt Nam. */
export const fmtStamp = (at: number): string => {
  const d = new Date(at);
  const date = d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  return `${date}, ${time} ICT`;
};

export const fmtClock = (at: number): string =>
  new Date(at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' });

/** 'room:cs2:alliance~sinners:game-winner' → 'cs2:alliance~sinners'. */
export const matchOfRoom = (room: string): string =>
  room.replace(/^room:/, '').replace(/:[^:]+$/, '');

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** Giờ:phút theo giờ Việt Nam. */
export const fmtHM = (at: number): string =>
  new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

/** Thời điểm tương đối gọn: "sau 34m", "12m trước". */
export const fmtRelative = (at: number, now = Date.now()): string => {
  const diff = at - now;
  const a = fmtAge(Math.abs(diff));
  return diff >= 0 ? `sau ${a}` : `${a} trước`;
};

/** Tốc độ /s: 182.4 → "182", 3.25 → "3.3", 0.04 → "0.04". */
export const fmtRate = (r: number | null | undefined): string => {
  if (r == null || !Number.isFinite(r)) return '—';
  if (r >= 100) return fmtInt(r);
  if (r >= 1) return r.toFixed(1);
  if (r === 0) return '0';
  return r.toFixed(2);
};

/** Khoảng thời gian: 300000 → "5 phút". */
export const fmtDuration = (ms: number): string => {
  const s = Math.round(Math.abs(ms) / 1000);
  if (s < 60) return `${s} giây`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút`;
  return `${(m / 60).toFixed(m % 60 ? 1 : 0)} giờ`;
};
