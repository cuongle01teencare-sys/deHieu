import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ListConsumersHandler } from '../application/queries/list-consumers.query.js';
import { GetConsumerHubStatsHandler } from '../application/queries/get-consumer-hub-stats.query.js';
import { ControlConsumerHandler } from '../application/commands/control-consumer.command.js';
import { ODDS_PERMISSIONS as P } from '../application/odds.permissions.js';
import { RequirePermissions } from '../../auth/presentation/auth.decorators.js';
import { unwrap } from './http-errors.js';

/** Consumer nội bộ (bot giao dịch, Discord) và trạng thái hub gửi kèo. */
@Controller('consumers')
@ApiTags('Consumers')
export class ConsumersController {
  constructor(
    @Inject(ListConsumersHandler) private readonly _list: ListConsumersHandler,
    @Inject(GetConsumerHubStatsHandler)
    private readonly _hub: GetConsumerHubStatsHandler,
    @Inject(ControlConsumerHandler)
    private readonly _control: ControlConsumerHandler,
  ) {}

  @Get()
  @RequirePermissions(P.CONSUMERS_READ)
  @ApiOperation({
    summary: 'Consumer đang/đã kết nối',
    description: 'Quyền: consumers:read',
  })
  list() {
    return this._list.execute();
  }

  /** Bao nhiêu kèo đang sống trong hub, frame chờ ack, trạng thái từng consumer. */
  @Get('hub')
  @RequirePermissions(P.CONSUMERS_READ)
  @ApiOperation({
    summary: 'Trạng thái hub gửi kèo',
    description:
      'Quyền: consumers:read. activeSignals, pendingDeliveries, kèo đang sống, consumer.',
  })
  hub() {
    return this._hub.execute();
  }

  @Post(':id/:action')
  @RequirePermissions(P.CONSUMERS_CONTROL)
  @ApiOperation({
    summary: 'Tạm dừng / tiếp tục gửi kèo cho một consumer',
    description: 'Quyền: consumers:control',
  })
  @ApiParam({ name: 'action', enum: ['pause', 'resume'] })
  async control(
    @Param('id') consumerId: string,
    @Param('action') action: string,
  ) {
    if (action !== 'pause' && action !== 'resume')
      throw new BadRequestException('action: pause | resume');
    return unwrap(await this._control.execute({ consumerId, action }));
  }
}
