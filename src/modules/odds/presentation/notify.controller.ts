import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { ApiZodBody } from '../../../shared/presentation/openapi.js';
import { NotifyAdmin } from '../application/notify/notify-admin.js';
import { ODDS_PERMISSIONS as P } from '../application/odds.permissions.js';
import { RequirePermissions } from '../../auth/presentation/auth.decorators.js';
import { unwrap } from './http-errors.js';

const TierBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    /** 0.05 = 5% */
    minMargin: z.number().min(0).max(1),
    maxMargin: z.number().min(0).max(10).nullable().default(null),
  })
  .refine((t) => t.maxMargin === null || t.maxMargin > t.minMargin, {
    message: 'maxMargin phải lớn hơn minMargin',
    path: ['maxMargin'],
  });

const ChannelBody = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  /** Rỗng = nhận mọi kèo. */
  tierIds: z.array(z.string()).default([]),
  config: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('discord'),
      webhookUrl: z.string().trim().optional(),
    }),
    z.object({
      type: z.literal('slack'),
      webhookUrl: z.string().trim().optional(),
    }),
    z.object({
      type: z.literal('telegram'),
      botToken: z.string().trim().optional(),
      chatId: z.string().trim().min(1),
    }),
  ]),
});

const CHANNEL_EXAMPLES = {
  discord: {
    summary: 'Discord webhook, chỉ nhận hạng VIP',
    value: {
      name: 'Discord VIP',
      config: {
        type: 'discord',
        webhookUrl: 'https://discord.com/api/webhooks/123/abc',
      },
      tierIds: ['<id hạng VIP>'],
    },
  },
  telegram: {
    summary: 'Telegram bot, nhận mọi kèo',
    value: {
      name: 'Telegram nhóm chung',
      config: {
        type: 'telegram',
        botToken: '123456:ABC-DEF',
        chatId: '-1001234567890',
      },
      tierIds: [],
    },
  },
  slack: {
    summary: 'Slack incoming webhook',
    value: {
      name: 'Slack #keo',
      config: {
        type: 'slack',
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
      },
    },
  },
};

/**
 * Kênh nhận kèo (Discord webhook, Telegram bot, Slack webhook) và hạng kèo do admin tự đặt tên.
 * Lưu trong Postgres, tự nạp khi app khởi động.
 */
@Controller('notify')
@ApiTags('Kênh thông báo')
export class NotifyController {
  constructor(@Inject(NotifyAdmin) private readonly _admin: NotifyAdmin) {}

  @Get('tiers')
  @RequirePermissions(P.CONSUMERS_READ)
  @ApiOperation({
    summary: 'Danh sách hạng kèo',
    description: 'Quyền: consumers:read. Sắp theo minMargin tăng dần.',
  })
  tiers() {
    return this._admin.listTiers();
  }

  @Post('tiers')
  @RequirePermissions(P.CONSUMERS_MANAGE)
  @ApiOperation({
    summary: 'Thêm hạng kèo',
    description:
      'Quyền: consumers:manage. Kèo có lợi nhuận trong [minMargin, maxMargin) thuộc hạng này; maxMargin null = không giới hạn. Tên không trùng.',
  })
  @ApiZodBody(TierBody, {
    vip: { summary: 'VIP từ 5%', value: { name: 'VIP', minMargin: 0.05 } },
    band: {
      summary: 'Thường 2–5%',
      value: { name: 'Thường', minMargin: 0.02, maxMargin: 0.05 },
    },
  })
  async createTier(@Body() body: unknown) {
    return unwrap(await this._admin.saveTier(null, TierBody.parse(body)));
  }

  @Put('tiers/:id')
  @RequirePermissions(P.CONSUMERS_MANAGE)
  @ApiOperation({
    summary: 'Sửa hạng kèo',
    description: 'Quyền: consumers:manage',
  })
  @ApiZodBody(TierBody)
  async updateTier(@Param('id') id: string, @Body() body: unknown) {
    return unwrap(await this._admin.saveTier(id, TierBody.parse(body)));
  }

  @Delete('tiers/:id')
  @RequirePermissions(P.CONSUMERS_MANAGE)
  @ApiOperation({
    summary: 'Xóa hạng kèo',
    description:
      'Quyền: consumers:manage. Hạng bị gỡ khỏi mọi kênh đang chọn nó; kênh không còn hạng nào sẽ nhận mọi kèo.',
  })
  async deleteTier(@Param('id') id: string) {
    return unwrap(await this._admin.deleteTier(id));
  }

  @Get('channels')
  @RequirePermissions(P.CONSUMERS_READ)
  @ApiOperation({
    summary: 'Danh sách kênh thông báo',
    description:
      'Quyền: consumers:read. Không trả bí mật (webhook, bot token) nguyên văn; kèm số tin đã gửi / lỗi gần nhất.',
  })
  channels() {
    return this._admin.listChannels();
  }

  @Post('channels')
  @RequirePermissions(P.CONSUMERS_MANAGE)
  @ApiOperation({
    summary: 'Thêm kênh thông báo',
    description:
      'Quyền: consumers:manage. Kênh nhận kèo mới và tin hủy kèo của các hạng đã chọn (tierIds rỗng = mọi kèo).',
  })
  @ApiZodBody(ChannelBody, CHANNEL_EXAMPLES)
  async createChannel(@Body() body: unknown) {
    return unwrap(await this._admin.saveChannel(null, ChannelBody.parse(body)));
  }

  @Put('channels/:id')
  @RequirePermissions(P.CONSUMERS_MANAGE)
  @ApiOperation({
    summary: 'Sửa kênh thông báo',
    description:
      'Quyền: consumers:manage. Bỏ trống webhookUrl / botToken = giữ giá trị cũ.',
  })
  @ApiZodBody(ChannelBody)
  async updateChannel(@Param('id') id: string, @Body() body: unknown) {
    return unwrap(await this._admin.saveChannel(id, ChannelBody.parse(body)));
  }

  @Delete('channels/:id')
  @RequirePermissions(P.CONSUMERS_MANAGE)
  @ApiOperation({
    summary: 'Xóa kênh thông báo',
    description: 'Quyền: consumers:manage',
  })
  async deleteChannel(@Param('id') id: string) {
    return unwrap(await this._admin.deleteChannel(id));
  }

  @Post('channels/:id/test')
  @RequirePermissions(P.CONSUMERS_MANAGE)
  @ApiOperation({
    summary: 'Gửi tin kiểm tra tới kênh',
    description:
      'Quyền: consumers:manage. Lỗi gửi → 400 kèm thông báo của nền tảng.',
  })
  async test(@Param('id') id: string) {
    return unwrap(await this._admin.testChannel(id));
  }
}
