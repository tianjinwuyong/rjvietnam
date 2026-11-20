import { Controller, Get, Post, Put, Delete, Body, Query, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import type { Request } from 'express';
import { ProductionReturnService } from './production-return.service';
import type { ProductionReturn, PaginatedResponse } from '@shared/api.interface';

@Controller('api/workorder/production-return')
@NeedLogin()
export class ProductionReturnController {
  constructor(private readonly productionReturnService: ProductionReturnService) {}

  @Get('list')
  async getList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('returnNo') returnNo?: string,
    @Query('materialCode') materialCode?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.productionReturnService.getList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      returnNo,
      materialCode,
      status,
      startDate,
      endDate,
    });
    return { code: 0, message: 'success', data: result };
  }

  @Get(':id')
  async getDetail(@Param('id') id: string) {
    const result = await this.productionReturnService.getDetail(id);
    return { code: 0, message: 'success', data: result };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() req: Request,
    @Body() body: {
      materialId: string;
      quantity: number;
      productionDate?: string;
      batchNo?: string;
      returnReason?: string;
      workOrderNo?: string;
      supplierCode?: string;
    },
  ) {
    const userId = req.userContext?.userId;
    const result = await this.productionReturnService.create(body, userId);
    return { code: 0, message: 'success', data: result };
  }

  /**
   * 批量制单：一次提交多个料号，每个料号生成一张退料单（同一事务，全成或全败）。
   * 注意路由顺序——必须放在 `@Get(':id')` 之外的 POST 上，且用独立子路径，避免和单张创建混淆。
   */
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async createBatch(
    @Req() req: Request,
    @Body() body: {
      workOrderNo?: string;
      returnReason?: string;
      items: Array<{
        materialId: string;
        quantity: number;
        productionDate?: string;
        batchNo?: string;
        supplierCode?: string;
        /** 逐行退料原因；不传时回落到单头 returnReason */
        returnReason?: string;
      }>;
    },
  ) {
    const userId = req.userContext?.userId;
    const result = await this.productionReturnService.createBatch(body, userId);
    return { code: 0, message: 'success', data: result };
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: {
      materialId?: string;
      quantity?: number;
      productionDate?: string;
      batchNo?: string;
      returnReason?: string;
      workOrderNo?: string;
      supplierCode?: string;
    },
  ) {
    const userId = req.userContext?.userId;
    const result = await this.productionReturnService.update(id, body, userId);
    return { code: 0, message: 'success', data: result };
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const userId = req.userContext?.userId;
    const result = await this.productionReturnService.submit(id, userId);
    return { code: 0, message: 'success', data: result };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const result = await this.productionReturnService.remove(id);
    return { code: 0, message: 'success', data: result };
  }
}
