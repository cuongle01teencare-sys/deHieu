import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import type {
  EmpireBrowserGateway,
  TradingAccountRepository,
} from './trading.ports.js';
import type {
  EmpireLoginStatus,
  EmpireJwtPreview,
} from '../../../shared/application/empire-login.js';

export class EmpireLoginAdmin {
  constructor(
    private readonly accounts: TradingAccountRepository,
    private readonly browser: EmpireBrowserGateway,
  ) {}
  
  async start(id: string): Promise<OperationStatus<EmpireLoginStatus>> {
    const account = await this.accounts.get(id);
    if (!account) return { status: 'NOT_FOUND' };
    if (!account.enabled || account.config.venue !== 'csgoempire')
      return { status: 'FAILED', reason: 'CSGOEMPIRE_ACCOUNT_UNAVAILABLE' };
    if (!account.secretCipher)
      return {
        status: 'FAILED',
        reason:
          'CSGOEMPIRE_LOGIN_CREDENTIALS_MISSING: lưu tài khoản và mật khẩu trước',
      };
    return { status: 'SUCEED', data: this.browser.startLogin(account) };
  }

  async status(id: string): Promise<OperationStatus<EmpireLoginStatus | null>> {
    const account = await this.accounts.get(id);
    if (!account || account.config.venue !== 'csgoempire')
      return { status: 'NOT_FOUND' };
    return {
      status: 'SUCEED',
      data: this.browser.loginStatus(account.config.browserProfile),
    };
  }
  async cancel(id: string): Promise<OperationStatus<EmpireLoginStatus | null>> {
    const account = await this.accounts.get(id);
    if (!account || account.config.venue !== 'csgoempire')
      return { status: 'NOT_FOUND' };
    return {
      status: 'SUCEED',
      data: await this.browser.cancelLogin(account.config.browserProfile),
    };
  }
  async takeJwt(
    id: string,
    attemptId: string,
  ): Promise<OperationStatus<EmpireJwtPreview | null>> {
    const account = await this.accounts.get(id);
    if (!account || !account.enabled || account.config.venue !== 'csgoempire')
      return { status: 'NOT_FOUND' };
    return {
      status: 'SUCEED',
      data: this.browser.takeJwtPreview(
        account.config.browserProfile,
        attemptId,
      ),
    };
  }
}
