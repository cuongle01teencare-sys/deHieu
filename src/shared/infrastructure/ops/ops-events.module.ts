import { Global, Logger, Module } from '@nestjs/common';
import { OPS_EVENT_BUS } from '../../application/ops-event-bus.js';
import { InMemoryOpsEventBus } from './in-memory-ops-event-bus.js';

/** Bus sự kiện vận hành dùng chung cho mọi module (global). */
@Global()
@Module({
  providers: [
    {
      provide: OPS_EVENT_BUS,
      useFactory: () => {
        const logger = new Logger('OpsEventBus');
        return new InMemoryOpsEventBus((e) =>
          logger.error(`listener lỗi: ${String(e)}`),
        );
      },
    },
  ],
  exports: [OPS_EVENT_BUS],
})
export class OpsEventsModule {}
