/**
 * Màu tenant: bộ Okabe–Ito (an toàn mù màu) qua biến CSS --tenant-1..5 nên tự đổi theo dark/light.
 * Chỉ dùng cho chấm nhỏ cạnh tên, tiêu đề cột ma trận, series biểu đồ — không tô khối lớn.
 * Tenant mới tự lấy màu theo băm tên.
 */
const KNOWN: Record<string, number> = { sptpub: 1, polymarket: 2 };

export function tenantIndex(tenant: string): number {
  const k = KNOWN[tenant];
  if (k) return k;
  let h = 0;
  for (const c of tenant) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 3 + (h % 3);
}

/** Giá trị CSS dùng được ở style / SVG fill: `var(--tenant-1)`. */
export const tenantVar = (tenant: string): string => `var(--tenant-${tenantIndex(tenant)})`;

/** Thứ tự cột ổn định: tenant đã biết trước, còn lại theo bảng chữ cái. */
export function sortTenants(list: Iterable<string>): string[] {
  return [...new Set(list)].sort((a, b) => {
    const ka = KNOWN[a] ?? 99;
    const kb = KNOWN[b] ?? 99;
    return ka - kb || a.localeCompare(b);
  });
}
