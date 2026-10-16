import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import type {
  TradingAccountCheck,
  TradingAccountChecker,
  TradingAccountRepository,
} from './trading.ports.js';

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
      const raw = e instanceof Error ? e.message.split(':')[0].trim() : '';
      return {
        status: 'FAILED',
        reason: /^[A-Z][A-Z_0-9]+$/.test(raw) ? raw : 'ACCOUNT_CHECK_FAILED',
      };
    }
  }
}
