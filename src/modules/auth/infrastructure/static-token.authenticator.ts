import { timingSafeEqual } from 'node:crypto';
import type {
  Authenticator,
  Credentials,
} from '../application/authenticator.js';
import type { Principal } from '../domain/principal.js';

interface Entry {
  token: Buffer;
  principal: Principal;
}

/**
 * Token tĩnh từ env API_TOKENS, định dạng:
 *   token:principalId:role1|role2, token2:principalId2:role
 * Dùng tạm cho tới khi có hệ thống đăng nhập; thay bằng adapter JWT không đụng chỗ khác.
 */
export class StaticTokenAuthenticator implements Authenticator {
  private readonly _entries: Entry[];

  constructor(spec: string) {
    this._entries = spec
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [token, id, roles] = s.split(':');
        if (!token || !id || !roles)
          throw new Error(`[API_TOKENS] mục không hợp lệ: "${s}"`);
        return {
          token: Buffer.from(token),
          principal: { id, roles: roles.split('|').filter(Boolean) },
        };
      });
  }

  authenticate({ authorization }: Credentials): Promise<Principal | null> {
    const m = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
    if (!m) return Promise.resolve(null);
    const given = Buffer.from(m[1].trim());
    const hit = this._entries.find(
      (e) => e.token.length === given.length && timingSafeEqual(e.token, given),
    );
    return Promise.resolve(hit?.principal ?? null);
  }
}
