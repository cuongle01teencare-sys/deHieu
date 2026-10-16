import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import type {
  TradingAccountCheck,
  TradingAccountChecker,
  TradingAccountRepository,
} from './trading.ports.js';

/**
 * Lý do lỗi ĐỌC ĐƯỢC cho người vận hành: giữ mã lỗi + phần chi tiết sau dấu ":" (vd mã HTTP); lỗi không
 * có mã (vd lỗi của thư viện Polymarket) → ACCOUNT_CHECK_FAILED kèm tên lớp lỗi + nội dung. Che mọi
 * chuỗi giống private key / token trước khi trả ra ngoài.
 */
export function checkFailureReason(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  const message = (e instanceof Error ? e.message : String(e)).trim();
  const head = message.split(':')[0].trim();
  const coded = /^[A-Z][A-Z_0-9]+$/.test(head);
  const detail = coded ? message.slice(head.length + 1).trim() : message;
  const masked = mask(detail).replace(/\s+/g, ' ').slice(0, 300);
  if (coded) return masked ? `${head}: ${masked}` : head;
  const cls = name && name !== 'Error' ? name : '';
  const text = [cls, masked].filter(Boolean).join(' — ');
  return `ACCOUNT_CHECK_FAILED${text ? `: ${text}` : ''}`;
}

function mask(s: string) {
  return (
    s
      // private key / chữ ký (≥ 64 hex)
      .replace(/(0x)?[0-9a-fA-F]{64,}/g, '[ẩn]')
      // JWT
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[ẩn]')
      // chuỗi base64 / token dài
      .replace(/[A-Za-z0-9+/_=-]{48,}/g, '[ẩn]')
  );
}

/** Xem tài khoản thật + số dư mà bot sẽ dùng, trước khi vào lệnh. */
export class AccountCheckAdmin {
  constructor(
    private readonly accounts: TradingAccountRepository,
    private readonly checker: TradingAccountChecker,
  ) {}

  async check(id: string): Promise<OperationStatus<TradingAccountCheck>> {
    const account = await this.accounts.get(id);
    if (!account) return { status: 'NOT_FOUND' };
    try {
      return { status: 'SUCEED', data: await this.checker.check(account) };
    } catch (e) {
      return { status: 'FAILED', reason: checkFailureReason(e) };
    }
  }
}
