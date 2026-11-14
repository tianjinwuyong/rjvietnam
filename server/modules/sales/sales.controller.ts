import { Controller, Get, Post, Put, Delete, Body, Query, Param, Req } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { NeedRoles } from '../../common/auth/auth.decorator';
import { SalesService } from './sales.service';
import type { Request } from 'express';

@Controller('api/sales')
@NeedLogin()
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('customers')
  async listCustomers(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Query('keyword') keyword?: string,
  ) {
    const result = await this.salesService.listCustomers(page, pageSize, keyword);
    return { code: 0, message: 'success', data: result };
  }

  @Get('customers/:id')
  async getCustomer(@Param('id') id: string) {
    const result = await this.salesService.getCustomer(id);
    return { code: 0, message: 'success', data: result };
  }

  @NeedRoles('sales_manager', 'sales_rep', 'admin')
  @Post('customers')
  async createCustomer(@Body() body: any, @Req() req: Request) {
    const { userId } = (req as any).userContext || { userId: '' };
    const result = await this.salesService.createCustomer(body, userId);
    return { code: 0, message: 'success', data: result };
  }

  @NeedRoles('sales_manager', 'sales_rep', 'admin')
  @Put('customers/:id')
  async updateCustomer(@Param('id') id: string, @Body() body: any) {
    const result = await this.salesService.updateCustomer(id, body);
    return { code: 0, message: 'success', data: result };
  }

  @NeedRoles('sales_manager', 'admin')
  @Delete('customers/:id')
  async deleteCustomer(@Param('id') id: string) {
    const result = await this.salesService.deleteCustomer(id);
    return { code: 0, message: 'success', data: result };
  }
}
