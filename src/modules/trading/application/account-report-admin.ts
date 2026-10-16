import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import {
  buildAccountReport,
  REPORT_MODES,
  type AccountReport,
  type ReportMode,
} from './account-report.js';
import type { TradeSettlementRepository } from './trade-settlement.js';
import type { TradingAccountRepository } from './trading.ports.js';

const MAX_ROWS = 20_000;

/** Trang chi tiết tài khoản: lãi/lỗ theo kỳ, từng lệnh, thật ↔ giấy. */
export class AccountReportAdmin {
  constructor(
    private readonly _accounts: TradingAccountRepository,
    private readonly _repo: TradeSettlementRepository,
  ) {}

  async report(
    id: string,
    q: { modes?: readonly string[]; timeZone?: string; since?: number },
  ): Promise<OperationStatus<AccountReport>> {
    const account = await this._accounts.get(id);
    if (!account) return { status: 'NOT_FOUND' };
    const modes = (q.modes ?? ['live']).filter((m): m is ReportMode =>
      (REPORT_MODES as readonly string[]).includes(m),
    );
    const timeZone = q.timeZone ?? 'Asia/Ho_Chi_Minh';
    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch {
      return { status: 'FAILED', reason: 'TIMEZONE_INVALID' };
    }
    const rows = await this._repo.accountTrades({
      accountId: id,
      since: q.since,
      limit: MAX_ROWS,
    });
    return {
      status: 'SUCEED',
      data: buildAccountReport({
        account: {
          id: account.id,
          label: account.label,
          venue: account.config.venue,
        },
        rows,
        modes: modes.length ? modes : ['live'],
        timeZone,
        truncated: rows.length >= MAX_ROWS,
      }),
    };
  }
}
