import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { queryDate } from '../../../shared/presentation/query-date.js';
import {
  ApiZodBody,
  ApiZodQuery,
} from '../../../shared/presentation/openapi.js';
import {
  CurrentPrincipal,
  RequirePermissions,
} from '../../auth/presentation/auth.decorators.js';
import { ADMIN_PERMISSIONS as P } from '../application/admin.permissions.js';
import { GetAdminSnapshotHandler } from '../application/queries/get-admin-snapshot.query.js';
import { ListIncidentsHandler } from '../application/queries/list-incidents.query.js';
import { ListAuditHandler } from '../application/queries/list-audit.query.js';
import { ListOddsTransitionsHandler } from '../application/queries/list-odds-transitions.query.js';
import { AcknowledgeIncidentHandler } from '../application/commands/acknowledge-incident.command.js';
import {
  PurgeHistoryHandler,
  type PurgeTarget,
} from '../application/commands/purge-history.command.js';
import { WsTicketService } from '../../auth/application/ws-ticket.service.js';
import type { Principal } from '../../auth/domain/principal.js';

const page = {
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};
const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const IncidentsQuery = z.object({
  open: bool,
  kind: z.string().optional(),
  ...page,
});
const AuditQuery = z.object({
  principalId: z.string().optional(),
  method: z.string().optional(),
  route: z.string().optional(),
  from: queryDate(),
  to: queryDate(),
  ...page,
});
const TransitionsQuery = z.object({
  room: z.string().optional(),
  tenant: z.string().optional(),
  to: z.enum(['open', 'suspended', 'removed']).optional(),
  from: queryDate(),
  until: queryDate(),
  ...page,
});

const PurgeBody = z.object({
  /** Xóa bản ghi cũ hơn N ngày. */
  olderThanDays: z.number().int().min(1).max(3650).optional(),
  /** Xóa toàn bộ (không dùng chung với olderThanDays). */
  all: z.boolean().default(false),
  /** Chỉ đếm số bản ghi sẽ xóa. */
  dryRun: z.boolean().default(false),
});
const PURGE_EXAMPLES = {
  days30: { summary: 'Cũ hơn 30 ngày', value: { olderThanDays: 30 } },
  days7: { summary: 'Cũ hơn 7 ngày', value: { olderThanDays: 7 } },
  all: { summary: 'Xóa hết', value: { all: true } },
  preview: {
    summary: 'Đếm trước',
    value: { olderThanDays: 30, dryRun: true },
  },
};

/** Màn hình vận hành: toàn cảnh, sự cố, audit, lịch sử trạng thái odds. */
@Controller('admin')
@ApiTags('Admin')
export class AdminController {
  constructor(
    @Inject(GetAdminSnapshotHandler)
    private readonly _snapshot: GetAdminSnapshotHandler,
    @Inject(ListIncidentsHandler)
    private readonly _incidents: ListIncidentsHandler,
    @Inject(AcknowledgeIncidentHandler)
    private readonly _ack: AcknowledgeIncidentHandler,
    @Inject(ListAuditHandler) private readonly _audit: ListAuditHandler,
    @Inject(ListOddsTransitionsHandler)
    private readonly _transitions: ListOddsTransitionsHandler,
    @Inject(WsTicketService) private readonly _tickets: WsTicketService,
    @Inject(PurgeHistoryHandler) private readonly _purge: PurgeHistoryHandler,
  ) {}

  private async _purgeOf(target: PurgeTarget, body: unknown) {
    const r = await this._purge.execute({ target, ...PurgeBody.parse(body) });
    if (r.status !== 'SUCEED')
      throw new BadRequestException(
        r.status === 'FAILED' ? r.reason : r.status,
      );
    return r.data;
  }

  @Post('ws-ticket')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Cấp vé một lần để mở admin stream từ trình duyệt',
    description:
      'Quyền: admin:read. Vé sống 60s, dùng một lần: gửi { "type": "hello", "ticket": "..." } ngay khi mở WebSocket admin. Server web (giữ token API) gọi endpoint này rồi đưa vé cho trình duyệt — token dài hạn không rời server.',
  })
  wsTicket(@CurrentPrincipal() principal: Principal | undefined) {
    if (!principal) throw new UnauthorizedException();
    return this._tickets.issue(principal);
  }

  @Get('snapshot')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Toàn cảnh hệ thống',
    description:
      'Quyền: admin:read. Sự cố đang mở, health, tasks, nodes, consumers, số liệu arbitrage, lanes, settings. Giống frame `snapshot` của stream admin.',
  })
  snapshot() {
    return this._snapshot.execute();
  }

  @Get('incidents')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Sự cố (đang mở hoặc lịch sử)',
    description:
      'Quyền: admin:read. open=true → sự cố đang mở (từ bộ nhớ); không truyền → lịch sử trong DB, mới nhất trước. kind: task.failed | task.flapping | source.stale | node.down | infra.down | consumer.down | consumer.backlog | lane.backlog.',
  })
  @ApiZodQuery(IncidentsQuery)
  incidents(@Query() q: unknown) {
    return this._incidents.execute(IncidentsQuery.parse(q));
  }

  @Post('incidents/:key/ack')
  @RequirePermissions(P.INCIDENTS_ACK)
  @ApiOperation({
    summary: 'Xác nhận đã biết một sự cố đang mở',
    description:
      'Quyền: admin:incidents. Ghi người xác nhận; sự cố vẫn mở tới khi hết thật. 404 nếu không có sự cố mở với key đó.',
  })
  @ApiParam({ name: 'key', example: 'source.stale:sptpub-live' })
  async ack(
    @Param('key') key: string,
    @CurrentPrincipal() principal?: { id: string },
  ) {
    const r = await this._ack.execute({ key, by: principal?.id ?? 'unknown' });
    if (r.status !== 'SUCEED') throw new NotFoundException();
    return r.data;
  }

  @Get('audit')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Audit log',
    description:
      'Quyền: admin:read. Mọi request POST/PUT/PATCH/DELETE: ai, route, params/body (đã che bí mật), kết quả. Mới nhất trước.',
  })
  @ApiZodQuery(AuditQuery)
  audit(@Query() q: unknown) {
    return this._audit.execute(AuditQuery.parse(q));
  }

  @Get('odds-transitions')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Lịch sử chuyển trạng thái dòng kèo',
    description:
      'Quyền: admin:read. Xuất hiện (from=null), open↔suspended, bị gỡ (to=removed, kèm reason). Giữ 7 ngày (ODDS_TRANSITION_RETENTION_DAYS).',
  })
  @ApiZodQuery(TransitionsQuery)
  transitions(@Query() q: unknown) {
    return this._transitions.execute(TransitionsQuery.parse(q));
  }

  @Post('audit/purge')
  @HttpCode(200)
  @RequirePermissions(P.PURGE)
  @ApiOperation({
    summary: 'Xóa audit log',
    description:
      'Quyền: admin:purge. olderThanDays = xóa bản ghi cũ hơn N ngày; all = true = xóa hết. dryRun = true chỉ đếm. Trả { target, before, matched, deleted }. Chính yêu cầu xóa vẫn được ghi vào audit sau khi xóa.',
  })
  @ApiZodBody(PurgeBody, PURGE_EXAMPLES)
  purgeAudit(@Body() body: unknown) {
    return this._purgeOf('audit', body);
  }

  @Post('odds-transitions/purge')
  @HttpCode(200)
  @RequirePermissions(P.PURGE)
  @ApiOperation({
    summary: 'Xóa lịch sử odds',
    description:
      'Quyền: admin:purge. olderThanDays = xóa bản ghi cũ hơn N ngày; all = true = xóa hết. dryRun = true chỉ đếm. Trả { target, before, matched, deleted }.',
  })
  @ApiZodBody(PurgeBody, PURGE_EXAMPLES)
  purgeOddsTransitions(@Body() body: unknown) {
    return this._purgeOf('odds-transitions', body);
  }
}
