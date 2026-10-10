import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../../../shared/presentation/openapi.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { CreateTeamAliasHandler } from '../application/commands/create-team-alias.command.js';
import { DeleteTeamAliasHandler } from '../application/commands/delete-team-alias.command.js';
import { ListTeamAliasesHandler } from '../application/queries/list-team-aliases.query.js';
import { ODDS_PERMISSIONS as P } from '../application/odds.permissions.js';
import { RequirePermissions } from '../../auth/presentation/auth.decorators.js';
import { unwrap } from './http-errors.js';

const AliasBody = z.object({
  alias: z.string().min(1),
  canonical: z.string().min(1),
});

/** Bí danh tên đội (CRUD). */
@Controller('team-aliases')
@ApiTags('Team aliases')
export class TeamAliasesController {
  constructor(
    @Inject(CreateTeamAliasHandler)
    private readonly _create: CreateTeamAliasHandler,
    @Inject(DeleteTeamAliasHandler)
    private readonly _delete: DeleteTeamAliasHandler,
    @Inject(ListTeamAliasesHandler)
    private readonly _list: ListTeamAliasesHandler,
  ) {}

  @Get()
  @RequirePermissions(P.TEAM_ALIASES_READ)
  @ApiOperation({
    summary: 'Danh sách bí danh tên đội',
    description: 'Quyền: team-aliases:read',
  })
  async list() {
    return unwrap(await this._list.execute()).map((a) => a.toSnapShot());
  }

  @Post()
  @RequirePermissions(P.TEAM_ALIASES_WRITE)
  @ApiOperation({
    summary: 'Thêm bí danh (tự chuẩn hóa)',
    description: 'Quyền: team-aliases:write',
  })
  @ApiZodBody(AliasBody, {
    nip: { value: { alias: 'NIP', canonical: 'Ninjas in Pyjamas' } },
  })
  async create(@Body() body: unknown) {
    return unwrap(
      await this._create.execute(AliasBody.parse(body)),
    ).toSnapShot();
  }

  @Delete(':id')
  @RequirePermissions(P.TEAM_ALIASES_WRITE)
  @ApiOperation({
    summary: 'Xóa bí danh',
    description: 'Quyền: team-aliases:write',
  })
  async remove(@Param('id') id: string) {
    return unwrap(await this._delete.execute({ id }));
  }
}
