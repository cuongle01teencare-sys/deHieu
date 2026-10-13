import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * So sánh bí mật (token) trong thời gian hằng, không lộ độ dài hay vị trí ký tự sai qua thời gian phản hồi.
 * Băm hai vế trước để timingSafeEqual luôn so hai buffer cùng độ dài.
 * Vế `given` đến từ client nên có thể không phải string → false.
 */
export function safeEqual(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
