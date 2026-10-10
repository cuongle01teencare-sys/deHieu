import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.types.js';
import type { Env } from '../config/env.schema.js';

/**
 * Client RESP dùng chung. Chạy được với Redis lẫn Dragonfly (cùng giao thức),
 * đổi server chỉ cần đổi REDIS_URL.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) =>
        new Redis(cfg.get('REDIS_URL'), { lazyConnect: false }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly _redis: Redis) {}

  async onApplicationShutdown() {
    await this._redis.quit();
  }
}
