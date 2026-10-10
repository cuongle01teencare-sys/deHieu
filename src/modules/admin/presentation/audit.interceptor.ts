import { randomUUID } from 'node:crypto';
import {
  HttpException,
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import { AuditRecorder } from '../application/audit-recorder.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE = /token|password|secret|authorization|webhook/i;
const MAX_BODY_CHARS = 4_000;

interface HttpRequestLike {
  method: string;
  originalUrl?: string;
  url: string;
  baseUrl?: string;
  route?: { path?: string };
  params?: Record<string, unknown>;
  body?: unknown;
  principal?: { id: string; roles: readonly string[] };
}

/** Che trường nhạy cảm (đệ quy) để không lưu bí mật vào audit. */
export const redact = (v: unknown, depth = 0): unknown => {
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [
      k,
      SENSITIVE.test(k) ? '***' : redact(x, depth + 1),
    ]),
  );
};

const limitBody = (v: unknown): unknown => {
  if (v === undefined) return null;
  const s = JSON.stringify(v);
  return s.length > MAX_BODY_CHARS
    ? { truncated: true, preview: s.slice(0, MAX_BODY_CHARS) }
    : v;
};

/**
 * Ghi audit MỌI request thay đổi hệ thống (POST/PUT/PATCH/DELETE): ai, route nào,
 * params/body (đã che bí mật), thành công hay lỗi. Không cần sửa từng controller.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(AuditRecorder) private readonly _audit: AuditRecorder) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<HttpRequestLike>();
    if (!MUTATING.has(req.method)) return next.handle();
    const res = ctx.switchToHttp().getResponse<{ statusCode?: number }>();
    const started = Date.now();

    const record = (ok: boolean, status: number, error: string | null) => {
      try {
        this._audit.record({
          id: randomUUID(),
          at: started,
          principalId: req.principal?.id ?? null,
          roles: req.principal?.roles ?? [],
          method: req.method,
          route: `${req.baseUrl ?? ''}${req.route?.path ?? ''}` || req.url,
          path: (req.originalUrl ?? req.url).split('?')[0] ?? req.url,
          params: (redact(req.params ?? {}) as Record<string, unknown>) ?? {},
          body: limitBody(redact(req.body)),
          ok,
          status,
          error,
          durationMs: Date.now() - started,
        });
      } catch {
        // audit hỏng không được làm hỏng request
      }
    };

    return next.handle().pipe(
      tap({
        next: () => record(true, res.statusCode ?? 200, null),
        error: (e: unknown) =>
          record(
            false,
            e instanceof HttpException ? e.getStatus() : 500,
            e instanceof Error ? e.message.slice(0, 1000) : String(e),
          ),
      }),
    );
  }
}
