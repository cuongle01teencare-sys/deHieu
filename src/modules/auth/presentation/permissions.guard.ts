import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTHENTICATOR,
  type Authenticator,
} from '../application/authenticator.js';
import { AuthorizationService } from '../application/authorization.service.js';
import type { Permission } from '../domain/permission.js';
import type { Principal } from '../domain/principal.js';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './auth.decorators.js';

interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}

/** Guard toàn cục: 401 nếu chưa xác thực, 403 nếu thiếu quyền. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly _reflector: Reflector,
    @Inject(AUTHENTICATOR) private readonly _authenticator: Authenticator,
    @Inject(AuthorizationService)
    private readonly _authorization: AuthorizationService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this._reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets))
      return true;

    const req = ctx.switchToHttp().getRequest<HttpRequest>();
    const header = req.headers['authorization'];
    const principal = await this._authenticator.authenticate({
      authorization: Array.isArray(header) ? header[0] : header,
    });
    if (!principal) throw new UnauthorizedException();
    req.principal = principal;

    const required =
      this._reflector.getAllAndMerge<Permission[]>(PERMISSIONS_KEY, targets) ??
      [];
    if (!(await this._authorization.can(principal, required)))
      throw new ForbiddenException(`Thiếu quyền: ${required.join(', ')}`);
    return true;
  }
}
