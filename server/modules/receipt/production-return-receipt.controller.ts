import { Controller, Get, Post, Body, Query, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import type { Request } from 'express';
import { ProductionReturnReceiptService } from './production-return-receipt.service';

@Controller('api/receipt/production-return')
@NeedLogin()
export class ProductionReturnReceiptController {
  constructor(private readonly service: ProductionReturnReceiptService) {}

  @Get('list')
  async getList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('returnNo') returnNo?: string,
    @Query('materialCode') materialCode?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.service.getList({
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

  @Post(':id/generate-labels')
  @HttpCode(HttpStatus.OK)
  async generateLabels(@Param('id') id: string) {
    const result = await this.service.generateLabels(id);
    return { code: 0, message: 'success', data: result };
  }

  @Post('scan-inbound')
  @HttpCode(HttpStatus.OK)
  async scanInbound(
    @Req() req: Request,
    @Body() body: { labelNo: string; locationId: string; quantity?: number },
  ) {
    const userId = req.userContext?.userId || '';
    const result = await this.service.scanInbound(body, userId);
    return { code: 0, message: 'success', data: result };
  }

  @Get(':id/inbound-progress')
  async getInboundProgress(@Param('id') id: string) {
    const result = await this.service.getInboundProgress(id);
    return { code: 0, message: 'success', data: result };
  }
}
