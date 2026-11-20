import { Controller, Get, Post, Body, Param, Query, Req } from '@nestjs/common';
import { SupplierDebtService } from './supplier-debt.service';
import { NeedLogin } from '../../common/auth/need-login.decorator';

@Controller('api/supplier-debt')
@NeedLogin()
export class SupplierDebtController {
  constructor(private readonly supplierDebtService: SupplierDebtService) {}

  /** 欠料台账列表 */
  @Get('list')
  async getList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('supplierName') supplierName?: string,
    @Query('materialCode') materialCode?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.supplierDebtService.getDebtList({
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      supplierName,
      materialCode,
      status,
    });
    return { code: 0, message: 'success', data };
  }

  /** 欠料详情 */
  @Get(':id')
  async getDetail(@Param('id') id: string) {
    const data = await this.supplierDebtService.getDebtDetail(id);
    return { code: 0, message: 'success', data };
  }
}
