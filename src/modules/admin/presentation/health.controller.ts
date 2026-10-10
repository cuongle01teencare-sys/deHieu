import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthMonitor } from '../application/health.js';
import { Public } from '../../auth/presentation/auth.decorators.js';

/** Health check cho load balancer / uptime monitor. Không lộ thông tin nhạy cảm. */
@Controller('health')
@ApiTags('Admin')
export class HealthController {
  constructor(@Inject(HealthMonitor) private readonly _health: HealthMonitor) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Health check (công khai)',
    description:
      'Kiểm tra Dragonfly/Redis và Postgres ngay lúc gọi. 200 nếu mọi phụ thuộc OK, 503 nếu có cái lỗi.',
  })
  async health(
    @Res({ passthrough: true }) res: { status(code: number): void },
  ) {
    const checks = await this._health.check();
    const ok = checks.every((c) => c.ok);
    res.status(ok ? 200 : 503);
    return {
      status: ok ? 'ok' : 'degraded',
      checks: checks.map((c) => ({
        name: c.name,
        ok: c.ok,
        latencyMs: c.latencyMs,
        ...(c.ok ? {} : { error: c.error }),
      })),
    };
  }
}
