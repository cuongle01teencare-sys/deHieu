import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiZodBody,
  ApiZodQuery,
} from '../../../shared/presentation/openapi.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DeleteSignalHistoryHandler } from '../application/commands/delete-signal-history.command.js';
import { unwrap } from './http-errors.js';
import { z } from 'zod';
import { queryDate } from '../../../shared/presentation/query-date.js';
import { GetRoomHandler } from '../application/queries/get-room.query.js';
import { ListRoomsHandler } from '../application/queries/list-rooms.query.js';
import { ListMatchesHandler } from '../application/queries/list-matches.query.js';
import { GetMatchHandler } from '../application/queries/get-match.query.js';
import { GetArbitrageStatsHandler } from '../application/queries/get-arbitrage-stats.query.js';
import { ListLanesHandler } from '../application/queries/list-lanes.query.js';
import { GetIngestStatsHandler } from '../application/queries/get-ingest-stats.query.js';
import { ListSignalHistoryHandler } from '../application/queries/list-signal-history.query.js';
import { GetSignalHistoryHandler } from '../application/queries/get-signal-history.query.js';
import { SIGNAL_STATUSES } from '../domain/signal-history.js';
import { ListActiveSignalsHandler } from '../application/queries/list-active-signals.query.js';
import { GetArbitrageSettingsHandler } from '../application/queries/get-arbitrage-settings.query.js';
import { UpdateArbitrageSettingsHandler } from '../application/commands/update-arbitrage-settings.command.js';
import { ODDS_PERMISSIONS as P } from '../application/odds.permissions.js';
import { RequirePermissions } from '../../auth/presentation/auth.decorators.js';
import { PHASES } from '../domain/phase.js';

const SettingsBody = z
  .object({
    minMargin: z.number().min(0).max(1),
    marginStep: z.number().positive().max(1),
    marginDropStep: z.number().positive().max(1),
    signalTtlMs: z.number().int().positive(),
    maxStartDriftMs: z.number().int().nonnegative(),
    enabledPhases: z.array(z.enum(PHASES)).max(PHASES.length),
  })
  .partial();

const RoomsQuery = z.object({
  q: z.string().optional(),
  tenant: z.string().optional(),
  sport: z.string().optional(),
  phase: z.enum(PHASES).optional(),
  matched: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const MatchesQuery = z.object({
  q: z.string().optional(),
  sport: z.string().optional(),
  tenant: z.string().optional(),
  phase: z.enum(PHASES).optional(),
  matched: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const CandidatesQuery = z.object({
  sport: z.string().optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

const HistoryQuery = z.object({
  status: z.enum(SIGNAL_STATUSES).optional(),
  phase: z.enum(PHASES).optional(),
  room: z.string().optional(),
  /** Mã kèo (đầy đủ / phần đầu) hoặc tên đội, room. */
  q: z.string().trim().max(200).optional(),
  sport: z.string().optional(),
  market: z.string().optional(),
  from: queryDate(),
  to: queryDate(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const HistoryPurgeBody = z.object({
  statuses: z
    .array(z.enum(['superseded', 'cancelled', 'abandoned']))
    .max(3)
    .optional(),
  olderThanDays: z.number().int().min(1).max(3650).optional(),
  all: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

/** Kèo, room, lịch sử và cấu hình arbitrage. */
@Controller('arbitrage')
@ApiTags('Arbitrage')
export class ArbitrageController {
  constructor(
    @Inject(GetRoomHandler) private readonly _room: GetRoomHandler,
    @Inject(ListRoomsHandler) private readonly _rooms: ListRoomsHandler,
    @Inject(ListMatchesHandler) private readonly _matches: ListMatchesHandler,
    @Inject(GetMatchHandler) private readonly _match: GetMatchHandler,
    @Inject(GetArbitrageStatsHandler)
    private readonly _stats: GetArbitrageStatsHandler,
    @Inject(ListLanesHandler) private readonly _lanes: ListLanesHandler,
    @Inject(GetIngestStatsHandler)
    private readonly _ingest: GetIngestStatsHandler,
    @Inject(ListSignalHistoryHandler)
    private readonly _history: ListSignalHistoryHandler,
    @Inject(GetSignalHistoryHandler)
    private readonly _historyOne: GetSignalHistoryHandler,
    @Inject(ListActiveSignalsHandler)
    private readonly _signals: ListActiveSignalsHandler,
    @Inject(GetArbitrageSettingsHandler)
    private readonly _getSettings: GetArbitrageSettingsHandler,
    @Inject(UpdateArbitrageSettingsHandler)
    private readonly _updateSettings: UpdateArbitrageSettingsHandler,
    @Inject(DeleteSignalHistoryHandler)
    private readonly _deleteHistory: DeleteSignalHistoryHandler,
  ) {}

  @Get('signals')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Kèo đang hiệu lực',
    description: 'Quyền: arbitrage:read',
  })
  signals() {
    return this._signals.execute();
  }

  @Get('stats')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Tổng quan: số room, evaluator, kèo đang hiệu lực',
    description:
      'Quyền: arbitrage:read. rooms: total / matched (≥2 tenant) / withCombos / aboveMinMargin, byTenant (số dòng, open/suspended, newestAgeMs). evaluator: số lượt đánh giá, số room đã đánh giá, issued / refreshed / cancelled (theo lý do) từ lúc app khởi động.',
  })
  stats() {
    return this._stats.execute();
  }

  @Get('rooms')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Danh sách room đang có',
    description:
      'Quyền: arbitrage:read. Mỗi dòng có `room` (id) để mở chi tiết ở GET /arbitrage/rooms/{room}, kèm đội, tenant, bestMargin. Sắp theo bestMargin giảm dần. Lọc: q (tên đội), tenant, sport, phase, matched=true (chỉ room ≥2 tenant).',
  })
  @ApiZodQuery(RoomsQuery)
  rooms(@Query() query: unknown) {
    return this._rooms.execute(RoomsQuery.parse(query));
  }

  @Get('rooms/:room')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Chi tiết một room',
    description:
      'Quyền: arbitrage:read. Odds từng tenant (đã parse + chuỗi gốc, ageMs), mọi tổ hợp kèm margin, và kèo đang hiệu lực của room. 404 nếu room không tồn tại.',
  })
  @ApiParam({ name: 'room', example: 'room:cs2:alliance~sinners:game-winner' })
  async room(@Param('room') room: string) {
    const r = await this._room.execute({ room });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Get('matches')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Danh sách trận (gom mọi market của cùng cặp đội)',
    description:
      'Quyền: arbitrage:read. Mỗi trận: tenants, số market, matchedMarkets (≥2 tenant), coverage (tenant → số market), bestMargin trên mọi market. Sắp theo bestMargin giảm dần rồi giờ bắt đầu. Lọc: q, sport, tenant, phase, matched=true (có ít nhất một market ≥2 tenant).',
  })
  @ApiZodQuery(MatchesQuery)
  matches(@Query() query: unknown) {
    return this._matches.execute(MatchesQuery.parse(query));
  }

  @Get('matches/:match')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Chi tiết một trận: ma trận market × tenant',
    description:
      'Quyền: arbitrage:read. Mỗi market: room id, nhãn hai phía (picks), dòng kèo của từng tenant (odds, trạng thái, ageMs...), số tổ hợp, bestMargin. 404 nếu trận không còn room nào.',
  })
  @ApiParam({ name: 'match', example: 'cs2:alliance~sinners' })
  async match(@Param('match') match: string) {
    const r = await this._match.execute({ match });
    if (!r) throw new NotFoundException();
    return r;
  }

  @Get('match-candidates')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Trận có thể bị ghép trượt (tên đội lệch) + gợi ý bí danh',
    description:
      'Quyền: arbitrage:read. Cặp trận cùng môn, giờ bắt đầu lệch ≤ maxStartDriftMs, do hai nhóm tenant khác nhau báo, có ít nhất một đội gần như trùng tên. `aliases` dùng thẳng cho POST /team-aliases. minScore mặc định 0.6.',
  })
  @ApiZodQuery(CandidatesQuery)
  matchCandidates(@Query() query: unknown) {
    return this._matches.candidates(CandidatesQuery.parse(query));
  }

  /** Lịch sử kèo đã phát (mới nhất trước), lọc theo trạng thái / kênh / room / khoảng thời gian. */
  @Get('history')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Lịch sử kèo đã phát (mới nhất trước)',
    description:
      'Quyền: arbitrage:read. status: active | superseded | cancelled | abandoned. q = mã kèo (đầy đủ hoặc phần đầu) hoặc tên đội / room (chứa); sport, market lọc đúng.',
  })
  @ApiZodQuery(HistoryQuery)
  history(@Query() query: unknown) {
    return this._history.execute(HistoryQuery.parse(query));
  }

  @Post('history/purge')
  @HttpCode(200)
  @RequirePermissions(P.HISTORY_PURGE)
  @ApiOperation({
    summary: 'Xóa tay lịch sử kèo',
    description:
      'Quyền: admin:purge. statuses (superseded | cancelled | abandoned; bỏ trống = mọi trạng thái đã kết thúc) + olderThanDays (cũ hơn N ngày, theo lúc phát) hoặc all = true. Kèo đang sống không bao giờ bị xóa. dryRun = true chỉ đếm. Trả { before, matched, deleted }.',
  })
  @ApiZodBody(HistoryPurgeBody)
  async purgeHistory(@Body() body: unknown) {
    return unwrap(
      await this._deleteHistory.purge(HistoryPurgeBody.parse(body)),
    );
  }

  @Delete('history/:signalId')
  @RequirePermissions(P.HISTORY_PURGE)
  @ApiOperation({
    summary: 'Xóa một kèo khỏi lịch sử',
    description:
      'Quyền: admin:purge. 404 = không có; 400 SIGNAL_ACTIVE = kèo đang sống.',
  })
  async deleteHistory(@Param('signalId') signalId: string) {
    return unwrap(await this._deleteHistory.deleteOne(signalId));
  }

  @Get('history/:signalId')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Một kèo trong lịch sử',
    description: 'Quyền: arbitrage:read',
  })
  async historyOne(@Param('signalId') signalId: string) {
    const r = await this._historyOne.execute({ signalId });
    if (!r) throw new NotFoundException();
    return r;
  }

  /** Làn xử lý theo tenant × phase: hàng đợi, số đã xử lý, số cập nhật bị gộp. */
  @Get('lanes')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Làn xử lý theo tenant × phase',
    description:
      'Quyền: arbitrage:read. queued / processed / coalesced (số cập nhật bị gộp) / busy.',
  })
  lanes() {
    return this._lanes.execute();
  }

  /** Bộ đếm theo chặng của luồng ingest. */
  @Get('ingest')
  @RequirePermissions(P.ARBITRAGE_READ)
  @ApiOperation({
    summary: 'Dữ liệu vào theo chặng (tenant × kind)',
    description:
      'Quyền: arbitrage:read. Cộng dồn từ lúc app khởi động (`since`): received (message nhận), failed (translator ném lỗi), skipped theo lý do (parse_failed, unsupported_event, unsupported_sport, unsupported_market, unsupported_line, missing_fields, same_team_names, no_moneyline_teams, invalid_event, unknown_asset), set/remove (thay đổi dòng kèo sinh ra). Tốc độ = chênh lệch giữa hai lần gọi.',
  })
  ingest() {
    return this._ingest.execute();
  }

  @Get('settings')
  @RequirePermissions(P.SETTINGS_READ)
  @ApiOperation({
    summary: 'Cấu hình arbitrage',
    description: 'Quyền: arbitrage-settings:read',
  })
  getSettings() {
    return this._getSettings.execute();
  }

  @Patch('settings')
  @RequirePermissions(P.SETTINGS_WRITE)
  @ApiOperation({
    summary: 'Sửa cấu hình arbitrage (gửi trường cần đổi)',
    description:
      'Quyền: arbitrage-settings:write. Có hiệu lực ngay: tắt một kênh → kèo của kênh đó bị hủy (phase_disabled).',
  })
  @ApiZodBody(SettingsBody, {
    prematchOnly: {
      summary: 'Chỉ tạo kèo prematch',
      value: { enabledPhases: ['prematch'] },
    },
    threshold: { summary: 'Ngưỡng 3%', value: { minMargin: 0.03 } },
  })
  updateSettings(@Body() body: unknown) {
    return this._updateSettings.execute(SettingsBody.parse(body));
  }
}
