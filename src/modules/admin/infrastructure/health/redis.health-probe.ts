import type { Redis } from 'ioredis';
import type { HealthProbe } from '../../application/health.js';

export class RedisHealthProbe implements HealthProbe {
  readonly name = 'dragonfly';

  constructor(private readonly _redis: Redis) {}

  async check(): Promise<void> {
    await this._redis.ping();
  }
}
