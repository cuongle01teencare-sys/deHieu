/** Ai đang gọi API. Vai trò là chuỗi tự do (admin, manager, staff...) — không hardcode. */
export interface Principal {
  readonly id: string;
  readonly roles: readonly string[];
}
