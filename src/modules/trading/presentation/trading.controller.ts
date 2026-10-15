import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiZodBody } from '../../../shared/presentation/openapi.js';
import { RequirePermissions } from '../../auth/presentation/auth.decorators.js';
import { TradingAdmin } from '../application/trading-admin.js';
import { ExposureAdmin } from '../application/exposure-admin.js';
import { TRADING_PERMISSIONS as P } from '../application/trading.permissions.js';
import { TRADE_STATUSES } from '../application/trade-attempt.js';
import { STAKE_TRENDS } from '../domain/stake-plan.js';
import { TRADER_MODES } from '../domain/trader-profile.js';
import { unwrap } from './http-errors.js';

const money = z.number().min(0).max(1_000_000);

const AccountBody = z.object({
  label: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  config: z.discriminatedUnion('venue', [
    z.object({
      venue: z.literal('csgoempire'),
      browserProfile: z.string().trim().min(1).max(64),
    }),
    z.object({
      venue: z.literal('polymarket'),
      walletAddress: z.string().trim(),
      funderAddress: z
        .string()
        .trim()
        .nullish()
        .transform((v) => v || null),
    }),
  ]),
  /** Chỉ polymarket. Bỏ trống khi sửa = giữ key cũ. Không bao giờ được trả lại. */
  privateKey: z.string().trim().max(200).optional(),
});

const StakePlanBody = z.object({
  trend: z.enum(STAKE_TRENDS).default('flat'),
  baseStake: money.default(50),
  stepPct: z.number().min(0).max(10).default(0.5),
  minStakeRatio: z.number().min(0).max(1).default(0.5),
  maxStakeRatio: z.number().min(1).max(100).default(1),
  scaleWithinTier: z.boolean().default(false),
  overrides: z
    .record(
      z.string(),
      z.object({
        stake: money.optional(),
        minStake: money.optional(),
        maxStake: money.optional(),
        /** Số lệnh tối đa mỗi cửa ở hạng này (ghi đè risk.maxEntriesPerTier). */
        maxEntries: z.number().int().min(1).max(100).optional(),
      }),
    )
    .default({}),
  /** Hạng profile được vào; [] (mặc định) = chưa chọn → profile đứng yên; null = mọi hạng. */
  tierIds: z.array(z.string().min(1).max(100)).max(200).nullable().default([]),
});

const ProfileBody = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  mode: z.enum(TRADER_MODES).default('paper'),
  csgoempireAccountId: z.string().min(1),
  polymarketAccountId: z.string().min(1),
  stakePlan: StakePlanBody,
  strategy: z
    .object({
      id: z.string().trim().min(1).max(60),
      params: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ id: 'arb-taker', params: {} }),
  risk: z
    .object({
      minNetMargin: z.number().min(0).max(0.99).default(0.01),
      matchCapUsd: money.default(0),
      maxSignalAgeMs: z.number().int().min(0).max(600_000).default(3_000),
      /** Số lệnh tối đa cho một cửa ở mỗi hạng kèo (mỗi hạng tính riêng). */
      maxEntriesPerTier: z.number().int().min(1).max(100).default(1),
      /** Lý do hủy kèo mà trader vẫn vào tiếp lệnh đang tính. */
      ignoreCancelReasons: z
        .array(z.string().trim().min(1).max(60))
        .max(30)
        .default(['better_opportunity']),
      /** Market được vào; null = mọi market; [] = chưa chọn (profile đứng yên). */
      markets: z
        .array(z.string().regex(/^[a-z0-9.-]{1,60}$/))
        .max(100)
        .nullable()
        .default(null),
    })
    .default({
      minNetMargin: 0.01,
      matchCapUsd: 0,
      maxSignalAgeMs: 3_000,
      maxEntriesPerTier: 1,
      ignoreCancelReasons: ['better_opportunity'],
      markets: null,
    }),
});

const SettingsBody = z.object({ matchExposureCapUsd: money });

const TradesQuery = z.object({
  profileId: z.string().optional(),
  status: z.enum(TRADE_STATUSES).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const PurgeBody = z.object({
  /** Một hoặc nhiều trạng thái (OR). */
  statuses: z
    .array(z.enum(TRADE_STATUSES))
    .max(TRADE_STATUSES.length)
    .optional(),
  /** true = mọi trạng thái. Không dùng chung với statuses. */
  all: z.boolean().default(false),
  profileId: z.string().min(1).optional(),
  /** Chỉ xóa lệnh có createdAt < before (ms). */
  before: z.number().int().positive().optional(),
  /** true = chỉ đếm số lệnh sẽ xóa. */
  dryRun: z.boolean().default(false),
});

const ExposureResetBody = z.union([
  z.object({ match: z.string().trim().min(1).max(300) }),
  z.object({
    entry: z.object({
      profileId: z.string().min(1).max(100),
      room: z.string().min(1).max(300),
      comboId: z.string().min(1).max(100),
      tierId: z.string().min(1).max(100),
    }),
  }),
]);

const StatsQuery = z.object({
  profileId: z.string().optional(),
  since: z.coerce.number().int().positive().optional(),
});

/**
 * Auto trade: tài khoản (nhiều tài khoản mỗi nền tảng), profile trader, cấu hình chung, lệnh giấy.
 * Task trader (kind `trader.arbitrage`, params {profileId}) tạo ở trang Publisher như task khác.
 */
@Controller('trading')
@ApiTags('Auto trade')
export class TradingController {
  constructor(
    @Inject(TradingAdmin) private readonly _admin: TradingAdmin,
    @Inject(ExposureAdmin) private readonly _exposure: ExposureAdmin,
  ) {}

  // ------------------------------------------------------------- tài khoản

  @Get('accounts')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Danh sách tài khoản giao dịch',
    description:
      'Quyền: trading:read. Không bao giờ trả private key; hasSecret cho biết đã lưu key hay chưa.',
  })
  accounts() {
    return this._admin.listAccounts();
  }

  @Post('accounts')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Thêm tài khoản',
    description:
      'Quyền: trading:manage. csgoempire: chỉ tên hồ sơ trình duyệt (không lưu mật khẩu). polymarket: địa chỉ ví + private key (mã hóa bằng TRADING_SECRET_KEY).',
  })
  @ApiZodBody(AccountBody, {
    csgoempire: {
      summary: 'Tài khoản csgoempire',
      value: {
        label: 'Empire #1',
        config: { venue: 'csgoempire', browserProfile: 'empire-1' },
      },
    },
    polymarket: {
      summary: 'Ví polymarket',
      value: {
        label: 'Poly #1',
        config: {
          venue: 'polymarket',
          walletAddress: '0x0000000000000000000000000000000000000001',
        },
        privateKey: '<64 ký tự hex>',
      },
    },
  })
  async createAccount(@Body() body: unknown) {
    return unwrap(await this._admin.saveAccount(null, AccountBody.parse(body)));
  }

  @Put('accounts/:id')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Sửa tài khoản',
    description:
      'Quyền: trading:manage. Bỏ trống privateKey = giữ key cũ. Không đổi được nền tảng.',
  })
  @ApiZodBody(AccountBody)
  async updateAccount(@Param('id') id: string, @Body() body: unknown) {
    return unwrap(await this._admin.saveAccount(id, AccountBody.parse(body)));
  }

  @Delete('accounts/:id')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Xóa tài khoản',
    description: 'Quyền: trading:manage. Đang dùng trong profile → 400.',
  })
  async deleteAccount(@Param('id') id: string) {
    return unwrap(await this._admin.deleteAccount(id));
  }

  // ------------------------------------------------------------- profile

  @Get('profiles')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Danh sách profile trader',
    description: 'Quyền: trading:read',
  })
  profiles() {
    return this._admin.listProfiles();
  }

  @Get('profiles/:id')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Chi tiết profile',
    description: 'Quyền: trading:read',
  })
  async profile(@Param('id') id: string) {
    return unwrap(await this._admin.getProfile(id));
  }

  @Get('profiles/:id/runtime-config')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Cấu hình worker nhận',
    description:
      'Quyền: trading:read. Bảng vốn đã tính theo hạng hiện tại + giới hạn; active=false kèm lý do nếu trader sẽ đứng yên.',
  })
  runtimeConfig(@Param('id') id: string) {
    return this._admin.runtimeConfig(id);
  }

  @Post('profiles')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Thêm profile trader',
    description:
      'Quyền: trading:manage. 1 tài khoản csgoempire + 1 ví polymarket + kế hoạch vốn theo hạng kèo + chiến lược + giới hạn rủi ro.',
  })
  @ApiZodBody(ProfileBody)
  async createProfile(@Body() body: unknown) {
    return unwrap(await this._admin.saveProfile(null, ProfileBody.parse(body)));
  }

  @Put('profiles/:id')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Sửa profile trader',
    description: 'Quyền: trading:manage',
  })
  @ApiZodBody(ProfileBody)
  async updateProfile(@Param('id') id: string, @Body() body: unknown) {
    return unwrap(await this._admin.saveProfile(id, ProfileBody.parse(body)));
  }

  @Post('profiles/:id/reevaluate')
  @HttpCode(200)
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Xét lại kèo đang sống',
    description:
      'Quyền: trading:manage. Task trader đang chạy của profile bỏ dấu "đã xử lý" và xét lại ngay mọi kèo còn sống (không xóa lệnh). Cửa đã vào vẫn bị chặn bởi số lệnh mỗi hạng. Trả { tasks } = số task đã nhận lệnh.',
  })
  async reevaluateProfile(@Param('id') id: string) {
    return unwrap(await this._admin.reevaluateProfile(id));
  }

  @Delete('profiles/:id')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Xóa profile trader',
    description:
      'Quyền: trading:manage. Task trader đang chạy với profile này sẽ đứng yên (PROFILE_NOT_FOUND).',
  })
  async deleteProfile(@Param('id') id: string) {
    return unwrap(await this._admin.deleteProfile(id));
  }

  @Post('stake-preview')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Xem trước bảng vốn',
    description:
      'Quyền: trading:read. Tính tiền / tối thiểu / tối đa cho từng hạng kèo hiện có từ kế hoạch vốn (không lưu).',
  })
  @ApiZodBody(StakePlanBody, {
    up: {
      summary: 'Tăng 50% mỗi hạng từ 50$',
      value: { trend: 'up', baseStake: 50, stepPct: 0.5 },
    },
  })
  async stakePreview(@Body() body: unknown) {
    return unwrap(
      await this._admin.previewStakeTable(StakePlanBody.parse(body)),
    );
  }

  // ------------------------------------------------------------- cấu hình chung

  @Get('settings')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Cấu hình auto trade',
    description:
      'Quyền: trading:read. matchExposureCapUsd: tổng tiền tối đa vào một trận cho mọi tài khoản (0 = tắt). secretKeyConfigured: đã đặt TRADING_SECRET_KEY chưa.',
  })
  async settings() {
    return {
      ...(await this._admin.getSettings()),
      secretKeyConfigured: this._admin.secretKeyConfigured(),
    };
  }

  @Put('settings')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Sửa cấu hình auto trade',
    description: 'Quyền: trading:manage',
  })
  @ApiZodBody(SettingsBody, {
    on: { summary: 'Tối đa 500$/trận', value: { matchExposureCapUsd: 500 } },
    off: { summary: 'Tắt giới hạn', value: { matchExposureCapUsd: 0 } },
  })
  async saveSettings(@Body() body: unknown) {
    return unwrap(await this._admin.saveSettings(SettingsBody.parse(body)));
  }

  // ------------------------------------------------------------- lệnh

  @Get('trades')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Lệnh (giấy) gần nhất',
    description:
      'Quyền: trading:read. Mới nhất trước; phân trang lùi bằng before = createdAt của dòng cuối.',
  })
  trades(@Query() q: unknown) {
    return this._admin.listTrades(TradesQuery.parse(q));
  }

  @Get('trades/stats')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Thống kê lệnh',
    description:
      'Quyền: trading:read. Số lần vào/bỏ qua/hủy, tổng tiền, lãi giả định, lý do bỏ qua.',
  })
  stats(@Query() q: unknown) {
    return this._admin.tradeStats(StatsQuery.parse(q));
  }

  // ------------------------------------------------------------- sổ phơi nhiễm (Redis)

  @Get('exposure')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Sổ phơi nhiễm thật (Redis)',
    description:
      'Quyền: trading:read. Số liệu trader dùng để quyết định, đọc thẳng từ Redis: tiền đã dùng theo trận (chung + riêng profile) và số lệnh đã vào mỗi cửa mỗi hạng, kèm TTL. Không phụ thuộc lịch sử lệnh trong DB (xóa lệnh không đổi sổ này). Chỉ có khi task trader bật sharedExposure (mặc định).',
  })
  exposure() {
    return this._exposure.view();
  }

  @Post('exposure/reset')
  @HttpCode(200)
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Đặt lại sổ phơi nhiễm',
    description:
      'Quyền: trading:manage. { match } = xóa tiền đã dùng của trận (chung + mọi profile); { entry: {profileId, room, comboId, tierId} } = xóa bộ đếm số lệnh của cửa + hạng đó. Trả { keys } = số khóa đã xóa.',
  })
  @ApiZodBody(ExposureResetBody, {
    match: {
      summary: 'Trả lại hạn mức trận',
      value: { match: 'cs2:aurora~ninjasinpyjamas' },
    },
  })
  async resetExposure(@Body() body: unknown) {
    const b = ExposureResetBody.parse(body);
    return unwrap(
      'match' in b
        ? await this._exposure.resetMatch(b.match)
        : await this._exposure.resetEntry(b.entry),
    );
  }

  @Post('trades/purge')
  @HttpCode(200)
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Xóa lệnh trong sổ',
    description:
      'Quyền: trading:manage. Xóa theo một/nhiều trạng thái (statuses, kết hợp OR) hoặc toàn bộ (all = true); có thể giới hạn thêm theo profileId và before. Xóa cả các chân lệnh. dryRun = true chỉ trả số lệnh sẽ xóa. Trả { matched, deleted }.',
  })
  @ApiZodBody(PurgeBody, {
    statuses: {
      summary: 'Xóa lệnh bỏ qua + lỗi',
      value: { statuses: ['skipped', 'error'] },
    },
    filled: {
      summary: 'Xóa lệnh đã vào của một profile',
      value: { statuses: ['paper_filled'], profileId: 'prof-1' },
    },
    all: { summary: 'Xóa toàn bộ', value: { all: true } },
    preview: {
      summary: 'Đếm trước khi xóa',
      value: { statuses: ['cancelled'], dryRun: true },
    },
  })
  async purgeTrades(@Body() body: unknown) {
    return unwrap(await this._admin.purgeTrades(PurgeBody.parse(body)));
  }

  @Delete('trades/:id')
  @RequirePermissions(P.MANAGE)
  @ApiOperation({
    summary: 'Xóa một lệnh',
    description: 'Quyền: trading:manage. Xóa lệnh kèm các chân.',
  })
  async deleteTrade(@Param('id') id: string) {
    return unwrap(await this._admin.deleteTrade(id));
  }

  @Get('trades/:id')
  @RequirePermissions(P.READ)
  @ApiOperation({
    summary: 'Chi tiết một lệnh',
    description:
      'Quyền: trading:read. Kèm từng chân (csgoempire / polymarket): giá lúc kèo phát, giá yêu cầu, giá khớp, mốc thời gian.',
  })
  async trade(@Param('id') id: string) {
    return unwrap(await this._admin.getTrade(id));
  }
}
