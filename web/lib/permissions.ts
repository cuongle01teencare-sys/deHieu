/** Kiểm tra quyền theo cùng quy tắc backend: `tài-nguyên:hành-động`, `*` dùng được ở từng phần. */
export function hasPermission(granted: readonly string[], needed: string): boolean {
  const [nr, na] = needed.split(':');
  return granted.some((g) => {
    if (g === '*') return true;
    const [gr, ga] = g.split(':');
    return (gr === '*' || gr === nr) && (ga === '*' || ga === na);
  });
}
