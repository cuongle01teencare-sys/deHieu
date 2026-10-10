import { nextRestartDelay } from '../restart-policy.js';
import { canTransition } from '../task-state.js';

describe('nextRestartDelay', () => {
  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [5, 16_000],
  ])('lần thất bại %i → %i ms', (n, ms) => {
    expect(nextRestartDelay(n)).toBe(ms);
  });

  it('không vượt quá maxDelayMs', () => {
    expect(
      nextRestartDelay(5, {
        baseDelayMs: 1_000,
        maxDelayMs: 3_000,
        maxConsecutiveFailures: 10,
      }),
    ).toBe(3_000);
  });

  it('trả về null khi vượt số lần cho phép', () => {
    expect(nextRestartDelay(6)).toBeNull();
  });
});

describe('canTransition', () => {
  it('cho phép RUNNING → STOPPING, chặn STOPPED → RUNNING', () => {
    expect(canTransition('RUNNING', 'STOPPING')).toBe(true);
    expect(canTransition('STOPPED', 'RUNNING')).toBe(false);
  });
});
