import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../shared/presentation/openapi.js';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import { StartTaskHandler } from '../application/commands/start-task.command.js';
import { RestartTaskHandler } from '../application/commands/restart-task.command.js';
import { StopTaskHandler } from '../application/commands/stop-task.command.js';
import { DeleteTaskHandler } from '../application/commands/delete-task.command.js';
import { SendTaskCommandHandler } from '../application/commands/send-task-command.command.js';
import { ListTasksHandler } from '../application/queries/list-tasks.query.js';
import { GetTaskHandler } from '../application/queries/get-task.query.js';
import { ListTaskKindsHandler } from '../application/queries/list-task-kinds.query.js';
import { TASK_PERMISSIONS as P } from '../application/task.permissions.js';
import {
  CurrentPrincipal,
  RequirePermissions,
} from '../../auth/presentation/auth.decorators.js';

const StartTaskBody = z.object({
  taskId: z.string().min(1),
  kind: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  /** true = lưu vào Postgres, lần khởi động app sau tự chạy lại. */
  persist: z.boolean().optional(),
  runtime: z.discriminatedUnion('type', [
    z.object({ type: z.literal('worker') }),
    z.object({ type: z.literal('remote'), nodeId: z.string().min(1) }),
  ]),
});

const START_TASK_EXAMPLES = {
  sptpubLive: {
    summary: 'sptpub live (worker thread)',
    value: {
      taskId: 'sptpub-live',
      kind: 'sptpub.live',
      runtime: { type: 'worker' },
      params: {
        baseUrl: 'https://api-h-xxxx.sptpub.com',
        brandId: '...',
        lang: 'en',
        intervalMs: 1000,
      },
    },
  },
  sptpubPrematchRemote: {
    summary: 'sptpub prematch (microservice node-1)',
    value: {
      taskId: 'sptpub-prematch',
      kind: 'sptpub.prematch',
      runtime: { type: 'remote', nodeId: 'node-1' },
      params: {
        baseUrl: 'https://api-h-xxxx.sptpub.com',
        brandId: '...',
        lang: 'en',
        intervalMs: 2000,
      },
    },
  },
  polymarketDescriptor: {
    summary: 'polymarket danh sách trận LoL (mỗi môn một task, lưu bền)',
    value: {
      taskId: 'poly-descriptor-lol',
      kind: 'polymarket.descriptor',
      runtime: { type: 'worker' },
      params: { tagIds: [65], intervalMs: 30000 },
      persist: true,
    },
  },
  polymarketStream: {
    summary: 'polymarket giá (stream)',
    value: {
      taskId: 'poly-stream',
      kind: 'polymarket.stream',
      runtime: { type: 'worker' },
      params: {},
    },
  },
};

const CommandBody = z.object({ name: z.string().min(1), data: z.unknown() });

const unwrap = <T>(r: OperationStatus<T>): T => {
  if (r.status === 'SUCEED') return r.data;
  if (r.status === 'NOT_FOUND') throw new NotFoundException();
  throw new BadRequestException(r.reason);
};

/** API quản lý publisher. Ai gọi được do quyền quyết định, không gắn vai trò. */
@Controller('tasks')
@ApiTags('Publisher (tasks)')
export class TasksController {
  constructor(
    @Inject(StartTaskHandler) private readonly _start: StartTaskHandler,
    @Inject(RestartTaskHandler) private readonly _restart: RestartTaskHandler,
    @Inject(StopTaskHandler) private readonly _stop: StopTaskHandler,
    @Inject(DeleteTaskHandler) private readonly _delete: DeleteTaskHandler,
    @Inject(SendTaskCommandHandler)
    private readonly _command: SendTaskCommandHandler,
    @Inject(ListTasksHandler) private readonly _list: ListTasksHandler,
    @Inject(GetTaskHandler) private readonly _get: GetTaskHandler,
    @Inject(ListTaskKindsHandler) private readonly _kinds: ListTaskKindsHandler,
  ) {}

  @Get()
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Danh sách publisher',
    description: 'Quyền: tasks:read',
  })
  @ApiQuery({ name: 'tenant', required: false, example: 'sptpub' })
  list(@Query('tenant') tenant?: string) {
    return this._list.execute({ tenant });
  }

  /** Các loại task app chạy được và tenant tương ứng. Khai báo trước ':taskId'. */
  @Get('kinds')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Các kind app chạy được và tenant tương ứng',
    description: 'Quyền: tasks:read',
  })
  kinds() {
    return this._kinds.execute();
  }

  @Get(':taskId')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Chi tiết một publisher',
    description: 'Quyền: tasks:read',
  })
  async get(@Param('taskId') taskId: string) {
    const r = await this._get.execute({ taskId });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Post()
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Tạo và chạy publisher',
    description:
      'Quyền: tasks:manage. Tenant tự suy từ kind. Kind không khai báo multiInstance chỉ chạy một instance (trùng → 400 KIND_ALREADY_RUNNING); polymarket.descriptor và sptpub.descriptor chạy được nhiều instance (vd mỗi môn một task).',
  })
  @ApiZodBody(StartTaskBody, START_TASK_EXAMPLES)
  async start(@Body() body: unknown) {
    return unwrap(await this._start.execute(StartTaskBody.parse(body)));
  }

  @Post(':taskId/start')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Chạy lại publisher đã dừng / lỗi',
    description:
      'Quyền: tasks:manage. Dùng lại đúng kind, params, runtime, persist của hồ sơ cũ. Task lưu bền sẽ tự chạy lại ở lần khởi động sau. Không có → 404, đang chạy → 400.',
  })
  async restart(@Param('taskId') taskId: string) {
    return unwrap(await this._restart.execute({ taskId }));
  }

  @Post(':taskId/stop')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Dừng publisher',
    description:
      'Quyền: tasks:manage. Odds của publisher bị gỡ, kèo liên quan bị hủy (publisher_stopped). Task lưu bền vẫn được giữ nhưng sẽ KHÔNG tự chạy lại ở lần khởi động sau.',
  })
  async stop(
    @Param('taskId') taskId: string,
    @CurrentPrincipal() principal?: { id: string },
  ) {
    return unwrap(
      await this._stop.execute({ taskId, requestedBy: principal?.id }),
    );
  }

  @Delete(':taskId')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Xóa hồ sơ task đã dừng',
    description:
      'Quyền: tasks:manage. Chỉ xóa được task ở trạng thái STOPPED hoặc FAILED (đang chạy → 400, hãy stop trước). Xóa luôn bản lưu bền trong Postgres. Không có → 404.',
  })
  async remove(@Param('taskId') taskId: string) {
    return unwrap(await this._delete.execute({ taskId }));
  }

  @Post(':taskId/commands')
  @RequirePermissions(P.COMMAND)
  @ApiOperation({
    summary: 'Gửi lệnh vào task đang chạy',
    description: 'Quyền: tasks:command',
  })
  @ApiZodBody(CommandBody)
  async command(@Param('taskId') taskId: string, @Body() body: unknown) {
    const { name, data } = CommandBody.parse(body);
    return unwrap(await this._command.execute({ taskId, name, data }));
  }
}
