import { z } from 'zod';

/**
 * Tham số ngày tháng trong query string: nhận cả Unix ms ("1791816000000") lẫn ISO 8601
 * ("2026-10-12T15:00:00Z"). Chuỗi rỗng = không lọc.
 * (z.coerce.date() đơn thuần gọi new Date("1791816000000") → Invalid Date vì đó là CHUỖI số.)
 */
export const queryDate = () =>
  z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === '') return undefined;
      if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v);
      return v;
    },
    z.coerce
      .date({ error: 'Ngày không hợp lệ: dùng Unix ms hoặc ISO 8601' })
      .optional(),
  );
