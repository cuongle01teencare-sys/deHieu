import { DomainError } from '../../../shared/domain/domain-error.js';
import type { Phase } from './phase.js';

export type LineStatus = 'open' | 'suspended';

export interface OddsLineProps {
  readonly tenant: string;
  /** Decimal odds theo thứ tự đội của MatchKey (teams[0], teams[1]). */
  readonly odds: readonly [number, number];
  readonly status: LineStatus;
  /** Kênh mà dòng kèo này thuộc về. */
  readonly phase: Phase;
  readonly updatedAt: number; // ms
  readonly startsAt: number; // ms, giờ bắt đầu trận theo tenant này
  /** ID gốc của tenant để bot đặt lệnh đúng trận/market/đội. */
  readonly ref: Readonly<Record<string, string>>;
}

/**
 * Một dòng kèo của một tenant trong một room. Lưu dạng CHUỖI để gọn và parse bằng regex:
 *   {oddsA}|{oddsB}|{o|s}|{l|p}|{updatedAt}|{startsAt}|{k=v;k=v}
 *   1.35|2.95|o|l|1790318269481|1790326800000|e=2715058995911069723;m=186;o0=4;o1=5
 */
export class OddsLine {
  static readonly PATTERN =
    /^([\d.]+)\|([\d.]+)\|([os])\|([lp])\|(\d+)\|(\d+)\|(.*)$/;

  private constructor(public readonly props: OddsLineProps) {}

  static create(props: OddsLineProps): OddsLine {
    const [a, b] = props.odds;
    if (!(a > 1) || !(b > 1))
      throw new DomainError(`OddsLine: odds phải > 1 (${a}, ${b})`);
    return new OddsLine({ ...props, ref: { ...props.ref } });
  }

  static decode(tenant: string, raw: string): OddsLine | null {
    const m = OddsLine.PATTERN.exec(raw);
    if (!m) return null;
    const ref: Record<string, string> = {};
    for (const pair of m[7] ? m[7].split(';') : []) {
      const i = pair.indexOf('=');
      if (i > 0) ref[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    }
    return new OddsLine({
      tenant,
      odds: [Number(m[1]), Number(m[2])],
      status: m[3] === 'o' ? 'open' : 'suspended',
      phase: m[4] === 'l' ? 'live' : 'prematch',
      updatedAt: Number(m[5]),
      startsAt: Number(m[6]),
      ref,
    });
  }

  encode(): string {
    const p = this.props;
    const ref = Object.entries(p.ref)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join(';');
    return [
      p.odds[0],
      p.odds[1],
      p.status === 'open' ? 'o' : 's',
      p.phase === 'live' ? 'l' : 'p',
      p.updatedAt,
      p.startsAt,
      ref,
    ].join('|');
  }

  get isOpen(): boolean {
    return this.props.status === 'open';
  }
}
