import { describe, expect, it } from 'vitest';
import { AesGcmSecretCipher } from '../security/aes-gcm.secret-cipher.js';

describe('AesGcmSecretCipher', () => {
  const key = 'x'.repeat(48);

  it('mã hóa/giải mã; mỗi lần một IV khác nhau', () => {
    const c = new AesGcmSecretCipher(key);
    const a = c.encrypt('0xsecret');
    const b = c.encrypt('0xsecret');
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret');
    expect(c.decrypt(a)).toBe('0xsecret');
  });

  it('sai khóa chủ hoặc bản mã bị sửa → lỗi', () => {
    const a = new AesGcmSecretCipher(key).encrypt('0xsecret');
    expect(() => new AesGcmSecretCipher('y'.repeat(48)).decrypt(a)).toThrow();
    const parts = a.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() =>
      new AesGcmSecretCipher(key).decrypt(parts.join(':')),
    ).toThrow();
  });

  it('không có khóa chủ → available() = false', () => {
    const c = new AesGcmSecretCipher(undefined);
    expect(c.available()).toBe(false);
    expect(() => c.encrypt('x')).toThrow();
  });
});
