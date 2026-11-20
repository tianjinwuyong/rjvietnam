import { Controller, Post, Get, Body, Query, Param, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { SupplierReturnService } from './supplier-return.service';
import type { Request } from 'express';

@Controller('api/supplier-return')
@NeedLogin()
export class SupplierReturnController {
  constructor(private readonly service: SupplierReturnService) {}

  @Get('list')
  async getList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('returnNo') returnNo?: string,
    @Query('status') status?: string,
    @Query('supplierCode') supplierCode?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.service.listOrders({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      returnNo,
      status,
      supplierCode,
      startDate,
      endDate,
    });
    return { code: 0, message: 'success', data };
  }

  @Get('pending-count')
  async getPendingCount() {
    const data = await this.service.getPendingCount();
    return { code: 0, message: 'success', data };
  }

  @Get('detail/:id')
  async getDetail(@Param('id') id: string) {
    const data = await this.service.getOrderDetail(id);
    return { code: 0, message: 'success', data };
  }

  @Post('outbound')
  async outbound(
    @Body() body: { orderId: string; operatorId?: string; remark?: string },
    @Req() req: Request,
  ) {
    const data = await this.service.confirmOutbound({
      orderId: body.orderId,
      // 审计人一律以登录身份为准，忽略请求体传入（防冒名）
      operatorId: req.userContext?.userId || '',
      remark: body.remark,
    });
    return { code: 0, message: 'success', data };
  }

  @Post('cancel')
  async cancel(
    @Body() body: { orderId: string; operatorId?: string; remark?: string },
    @Req() req: Request,
  ) {
    const data = await this.service.cancelOrder({
      orderId: body.orderId,
      // 审计人一律以登录身份为准，忽略请求体传入（防冒名）
      operatorId: req.userContext?.userId || '',
      remark: body.remark,
    });
    return { code: 0, message: 'success', data };
  }
}
