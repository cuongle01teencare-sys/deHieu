import {
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  taskRunnerEnvSchema,
  type TaskRunnerEnv,
} from '../../shared/infrastructure/config/env.schema.js';
import { WsNodeClient } from '../../modules/tasks/infrastructure/remote/ws-node.client.js';
import { TASK_FACTORIES } from '../../modules/tasks/infrastructure/runtime/task-catalog.js';

/** Microservice publisher: không DB, không store — chỉ chạy task và gửi về app. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => taskRunnerEnvSchema.parse(raw),
    }),
  ],
  providers: [
    {
      provide: WsNodeClient,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<TaskRunnerEnv, true>) =>
        new WsNodeClient({
          nodeId: cfg.get('TASK_RUNNER_NODE_ID'),
          appUrl: cfg.get('TASK_RUNNER_APP_URL'),
          token: cfg.get('TASK_WS_TOKEN'),
          catalog: TASK_FACTORIES,
        }),
    },
  ],
})
export class TaskRunnerModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(@Inject(WsNodeClient) private readonly _client: WsNodeClient) {}

  onApplicationBootstrap() {
    this._client.connect();
  }

  async onApplicationShutdown() {
    await this._client.close();
  }
}
