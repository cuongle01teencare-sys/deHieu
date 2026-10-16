import { describe, expect, it } from 'vitest';
import { checkFailureReason } from '../account-check-admin.js';

describe('lý do lỗi kiểm tra tài khoản', () => {
  it('giữ mã lỗi + chi tiết (không cắt mất phần sau dấu ":")', () => {
    expect(
      checkFailureReason(
        new Error('CSGOEMPIRE_BALANCE_READ_FAILED: metadata HTTP 403'),
      ),
    ).toBe('CSGOEMPIRE_BALANCE_READ_FAILED: metadata HTTP 403');
    expect(checkFailureReason(new Error('POLYMARKET_WALLET_MISMATCH'))).toBe(
      'POLYMARKET_WALLET_MISMATCH',
    );
  });

  it('lỗi không mã của thư viện: nêu tên lớp lỗi + nội dung thay vì chỉ ACCOUNT_CHECK_FAILED', () => {
    class RequestRejectedError extends Error {
      override name = 'RequestRejectedError';
    }
    expect(
      checkFailureReason(
        new RequestRejectedError('Trading restricted in your region'),
      ),
    ).toBe(
      'ACCOUNT_CHECK_FAILED: RequestRejectedError — Trading restricted in your region',
    );
  });

  it('che private key / token lọt vào nội dung lỗi', () => {
    const key = `0x${'ab'.repeat(32)}`;
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const r = checkFailureReason(new Error(`invalid key ${key} token ${jwt}`));
    expect(r).not.toContain('abab');
    expect(r).not.toContain('eyJ');
    expect(r).toContain('[ẩn]');
  });
});
