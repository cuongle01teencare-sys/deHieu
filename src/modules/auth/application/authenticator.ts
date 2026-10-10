import type { Principal } from '../domain/principal.js';

export interface Credentials {
  /** Header Authorization nguyên bản, vd 'Bearer xxx'. */
  readonly authorization?: string;
}

/** Port: xác thực người gọi. Adapter: token tĩnh (hiện tại), JWT/OAuth (sau này). */
export interface Authenticator {
  authenticate(credentials: Credentials): Promise<Principal | null>;
}

export const AUTHENTICATOR = Symbol('AUTHENTICATOR');
