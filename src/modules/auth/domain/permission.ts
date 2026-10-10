/**
 * Quyền dạng "tài-nguyên:hành-động", vd 'tasks:read', 'team-aliases:write'.
 * Mỗi module tự khai báo quyền của mình; auth không cần biết danh sách cụ thể.
 * Quyền được cấp có thể dùng '*' ở từng phần: '*', 'tasks:*', '*:read'.
 */
export type Permission = string;

export const permissionMatches = (
  granted: Permission,
  required: Permission,
): boolean => {
  if (granted === '*' || granted === required) return true;
  const [gr, ga] = granted.split(':');
  const [rr, ra] = required.split(':');
  return (gr === '*' || gr === rr) && (ga === '*' || ga === ra);
};

/** Có đủ TẤT CẢ quyền yêu cầu không. */
export const hasAllPermissions = (
  granted: readonly Permission[],
  required: readonly Permission[],
): boolean =>
  required.every((r) => granted.some((g) => permissionMatches(g, r)));
