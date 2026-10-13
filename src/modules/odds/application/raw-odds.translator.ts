import type { TaskDataMessage } from '../../tasks/application/task-protocol.js';
import type { MatchKey } from '../domain/match-key.js';
import type { OddsLine } from '../domain/odds-line.js';
import type { RemovalReason } from '../domain/removal-reason.js';
import type { Phase } from '../domain/phase.js';

export type OddsLineChange =
  | { readonly type: 'set'; readonly key: MatchKey; readonly line: OddsLine }
  | {
      readonly type: 'remove';
      readonly key: MatchKey;
      readonly tenant: string;
      /** Kênh của dòng bị gỡ — để đưa vào đúng làn xử lý. */
      readonly phase: Phase;
      /** Biết rõ vì sao gỡ (vd publisher_stopped); bỏ trống = leg_removed. */
      readonly reason?: RemovalReason;
    };

/**
 * Port ANTI-CORRUPTION LAYER: dữ liệu thô của một tenant → thay đổi dòng kèo của domain.
 * Định dạng tenant đổi → chỉ sửa adapter của tenant đó.
 */
export interface RawOddsTranslator {
  /** Tenant ghi vào room (field trong Hash). */
  readonly tenant: string;
  /**
   * Các kind (trong TASK_CATALOG) mà translator này đọc được. App chọn translator theo kind
   * của message; mỗi kind chỉ được một translator nhận.
   */
  readonly kinds: readonly string[];
  translate(msg: TaskDataMessage): Promise<OddsLineChange[]>;
  /**
   * Publisher `taskId` (loại `kind`) đã dừng hẳn → trả về các dòng kèo cần gỡ,
   * vì dữ liệu nó từng gửi không còn được cập nhật nữa.
   */
  release(taskId: string, kind: string): Promise<OddsLineChange[]>;
  /** Rebuild cached room keys after aliases change, preserving price timestamps. */
  reindexTeams?(): OddsLineChange[];
}

export const RAW_ODDS_TRANSLATORS = Symbol('RAW_ODDS_TRANSLATORS');
