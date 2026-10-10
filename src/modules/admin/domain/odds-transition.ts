/** Một lần dòng kèo đổi trạng thái: xuất hiện (from=null), open↔suspended, bị gỡ (to=removed). */
export interface OddsTransition {
  readonly at: number;
  readonly room: string;
  readonly tenant: string;
  readonly phase: string;
  readonly from: string | null;
  readonly to: string;
  readonly reason: string | null;
}
