import { OddsLine } from '../odds-line.js';

describe('OddsLine', () => {
  const line = OddsLine.create({
    tenant: 'sptpub',
    odds: [1.35, 2.95],
    status: 'open',
    phase: 'live',
    updatedAt: 1790318269481,
    startsAt: 1790326800000,
    ref: { e: '2715058995911069723', m: '186', o0: '4', o1: '5' },
  });

  it('encode ra chuỗi parse được bằng regex, có kênh l|p', () => {
    const raw = line.encode();
    expect(raw).toBe(
      '1.35|2.95|o|l|1790318269481|1790326800000|e=2715058995911069723;m=186;o0=4;o1=5',
    );
    expect(OddsLine.PATTERN.test(raw)).toBe(true);
  });

  it('decode(encode(x)) giữ nguyên dữ liệu', () => {
    expect(OddsLine.decode('sptpub', line.encode())?.props).toEqual(line.props);
    const pre = OddsLine.create({ ...line.props, phase: 'prematch' });
    expect(OddsLine.decode('sptpub', pre.encode())?.props.phase).toBe(
      'prematch',
    );
  });

  it('từ chối odds <= 1', () => {
    expect(() => OddsLine.create({ ...line.props, odds: [0, 2] })).toThrow();
  });
});
