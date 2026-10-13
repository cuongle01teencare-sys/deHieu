import {
  Controller,
  Get,
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
import { ApiZodQuery } from '../../../shared/presentation/openapi.js';
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
  ) {}

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
}
