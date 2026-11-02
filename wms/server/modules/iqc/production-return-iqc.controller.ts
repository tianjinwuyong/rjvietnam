import { Controller, Get, Post, Body, Query, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import type { Request } from 'express';
import { ProductionReturnIqcService } from './production-return-iqc.service';

@Controller('api/iqc/production-return')
@NeedLogin()
export class ProductionReturnIqcController {
  constructor(private readonly service: ProductionReturnIqcService) {}

  @Get('pending')
  async getPending(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('returnNo') returnNo?: string,
    @Query('materialCode') materialCode?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.service.getPendingList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      returnNo,
      materialCode,
      startDate,
      endDate,
    });
    return { code: 0, message: 'success', data: result };
  }

  @Get(':id')
  async getDetail(@Param('id') id: string) {
    const result = await this.service.getDetail(id);
    return { code: 0, message: 'success', data: result };
  }

  @Post(':id/inspect')
  @HttpCode(HttpStatus.OK)
  async inspect(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: {
      goodQty: number;
      incomingDefectQty: number;
      operationDefectQty: number;
      inspectorId?: string;
      inspectorName?: string;
      remark?: string;
    },
  ) {
    const userContext = {
      userId: req.userContext?.userId,
      userName: req.userContext?.userName,
    };
    const result = await this.service.inspect(id, body, userContext);
    return { code: 0, message: 'success', data: result };
  }
}
