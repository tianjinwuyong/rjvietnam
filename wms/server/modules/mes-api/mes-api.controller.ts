import { Controller, Get, Param, Query, UseFilters, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { MesApiKeyGuard } from '../../common/auth/mes-api-key.guard';
import { Public } from '../../common/auth/public.decorator';
import { MesApiExceptionFilter } from './mes-api.filter';
import {
  MesApiService,
  type PickingQuery,
  type ReturnQuery,
  type StockQuery,
  type StockSummaryQuery,
} from './mes-api.service';

/**
 * MES / 第三方查询接口（v1）
 * ------------------------------------------------------------------
 * 统一响应：{ code: 0, message: 'ok', data: {...}, requestId: '...' }
 * 鉴权：请求头 X-Api-Key（在 .env 的 MES_API_KEYS 里配置）
 *
 * 全部是只读查询，不提供业务写入，避免外部系统误改库存与单据状态。
 */
@Controller('api/mes/v1')
// 全局默认是「未登录拒绝」。这里先放行 JWT 守卫，再由 MesApiKeyGuard 做机器鉴权。
@Public()
@UseGuards(MesApiKeyGuard)
@UseFilters(MesApiExceptionFilter)
export class MesApiController {
  constructor(private readonly mes: MesApiService) {}

  private ok(data: unknown) {
    return { code: 0, message: 'ok', data, requestId: randomUUID() };
  }

  /** 连通性自检：MES 联调第一步，确认网络、Key、数据库都通 */
  @Get('ping')
  async ping() {
    return this.ok(await this.mes.ping());
  }

  /**
   * 库存现有量明细
   * 例：/api/mes/v1/stock?materialCode=M001&warehouseCode=WH01&page=1&pageSize=100
   */
  @Get('stock')
  async stock(@Query() q: StockQuery) {
    return this.ok(await this.mes.listStock(q));
  }

  /**
   * 库存统计
   * 例：/api/mes/v1/stock/summary?groupBy=material
   *     /api/mes/v1/stock/summary?groupBy=warehouse
   */
  @Get('stock/summary')
  async stockSummary(@Query() q: StockSummaryQuery) {
    return this.ok(await this.mes.stockSummary(q));
  }

  /** 领料单列表（可按单号、工单号、工段、状态、创建时间过滤） */
  @Get('picking-orders')
  async pickingOrders(@Query() q: PickingQuery) {
    return this.ok(await this.mes.listPicking(q));
  }

  /** 领料单详情（含明细与实发/实收数量） */
  @Get('picking-orders/:pickingNo')
  async pickingOrder(@Param('pickingNo') pickingNo: string) {
    return this.ok(await this.mes.getPicking(pickingNo));
  }

  /** 产线退料单列表（含已入库数量与待入库数量） */
  @Get('returns')
  async returns(@Query() q: ReturnQuery) {
    return this.ok(await this.mes.listReturns(q));
  }

  /** 产线退料单详情 */
  @Get('returns/:returnNo')
  async returnDetail(@Param('returnNo') returnNo: string) {
    return this.ok(await this.mes.getReturn(returnNo));
  }
}
