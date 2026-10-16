import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

const VERSION = 'v1';
const SALT = 'nest-de-hieu/trading-secret/v1';

/**
 * AES-256-GCM với khóa chủ từ env TRADING_SECRET_KEY (một khóa cho MỌI ví; mỗi bản mã có IV riêng).
 * Khóa chủ: chuỗi bất kỳ ≥ 32 ký tự (khuyên dùng `openssl rand -base64 48`), dẫn xuất qua scrypt.
 * Mất/đổi khóa chủ = không giải mã được key đã lưu → phải nhập lại private key.
 */
export class AesGcmSecretCipher {
  private readonly _key: Buffer | null;

  constructor(masterKey: string | undefined) {
    this._key = masterKey ? scryptSync(masterKey, SALT, 32) : null;
  }

  available(): boolean {
    return this._key !== null;
  }

  encrypt(plain: string): string {
    const key = this._require();
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return [VERSION, iv, c.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
      .join(':');
  }

  decrypt(cipher: string): string {
    const key = this._require();
    const [v, iv, tag, data] = cipher.split(':');
    if (v !== VERSION || !iv || !tag || !data)
      throw new Error('SECRET_CIPHER_FORMAT');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      d.update(Buffer.from(data, 'base64')),
      d.final(),
    ]).toString('utf8');
  }

  private _require(): Buffer {
    if (!this._key) throw new Error('TRADING_SECRET_KEY chưa được đặt');
    return this._key;
  }
}
