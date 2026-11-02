import { Controller, Get, Post, Delete, Param, Query, Body, BadRequestException } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';

import { SubstitutionService } from './substitution.service';
import type {
  MaterialSubstitution,
  SubstituteMaterialInfo,
  SubstitutionCheckResult,
  SubstitutionImportResult,
  PaginatedResponse,
} from '@shared/api.interface';

@Controller('api/material/substitution')
@NeedLogin()
export class SubstitutionController {
  constructor(private readonly substitutionService: SubstitutionService) {}

  @Post('import')
  async importSubstitutions(@Body() body: { fileBase64: string; twoWay?: boolean }): Promise<SubstitutionImportResult> {
    if (!body?.fileBase64) {
      throw new BadRequestException('未接收到上传的文件数据');
    }
    const buffer = Buffer.from(body.fileBase64, 'base64');
    return this.substitutionService.importSubstitutions(buffer, body.twoWay === true);
  }

  @Get('list')
  async getSubstitutionList(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('materialCode') materialCode?: string,
  ): Promise<PaginatedResponse<MaterialSubstitution>> {
    return this.substitutionService.getSubstitutionList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      materialCode,
    });
  }

  @Delete(':id')
  async deleteSubstitution(@Param('id') id: string): Promise<void> {
    return this.substitutionService.deleteSubstitution(id);
  }

  @Get('by-material')
  async getSubstitutesByMaterial(
    @Query('materialCode') materialCode: string,
  ): Promise<SubstituteMaterialInfo[]> {
    if (!materialCode) {
      throw new BadRequestException('materialCode 参数不能为空');
    }
    return this.substitutionService.getSubstitutesByMaterial(materialCode);
  }

  @Get('check-availability')
  async checkAvailability(
    @Query('materialCode') materialCode: string,
    @Query('qty') qty: string = '1',
  ): Promise<SubstitutionCheckResult> {
    if (!materialCode) {
      throw new BadRequestException('materialCode 参数不能为空');
    }
    return this.substitutionService.checkAvailability(materialCode, parseInt(qty, 10));
  }
}
