import { Controller, Post, Get, Body, Query, Param, Req, Inject } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import { StockTakeService } from './stock-take.service';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { sysAccount } from '@server/database/schema';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';

@Controller('api/stock-take')
@NeedLogin()
export class StockTakeController {
  constructor(
    private readonly stockTakeService: StockTakeService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private async getUserRole(userId: string): Promise<string> {
    if (!userId) return '';
    try {
      const rows = await this.db
        .select({ roleCode: sysAccount.roleCode })
        .from(sysAccount)
        .where(eq(sysAccount.platformUserId, userId))
        .limit(1);
      return rows[0]?.roleCode || '';
    } catch {
      return '';
    }
  }

  /** 创建盘点单（仓管员）：按仓库代码生成账面快照；warehouseCode 传 __all__ 表示按仓库各建一单 */
  @Post()
  async createTake(
    @Req() req: Request,
    @Body() body: {
      scope?: string;
      warehouseCode?: string;
      periodMonth?: string;
      takeType?: string;
      title?: string;
      remark?: string;
      /** standalone=单张盘点单；main=主盘点单（按区域/地址码拆子单） */
      orderType?: 'standalone' | 'main';
      operatorId?: string;
      operatorName?: string;
    },
  ) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.createTake({
      scope: body.scope,
      warehouseCode: body.warehouseCode,
      periodMonth: body.periodMonth,
      takeType: body.takeType,
      title: body.title,
      remark: body.remark,
      orderType: body.orderType,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 预览子盘点单范围：返回该范围会生成多少行 / 覆盖多少库位 */
  @Get('sub-scope/preview')
  async previewSubScope(
    @Query('warehouseCode') warehouseCode?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('scope') scope?: string,
    @Query('areaCode') areaCode?: string,
    @Query('shelfCode') shelfCode?: string,
    @Query('layerCode') layerCode?: string,
    @Query('locationFrom') locationFrom?: string,
    @Query('locationTo') locationTo?: string,
  ) {
    const result = await this.stockTakeService.previewSubScope({
      warehouseCode, warehouseId, scope, areaCode, shelfCode, layerCode, locationFrom, locationTo,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 在主盘点单下创建子盘点单（按区域 / 地址码范围生成账面快照） */
  @Post(':id/sub-order')
  async createSubOrder(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: {
      areaCode?: string;
      shelfCode?: string;
      layerCode?: string;
      locationFrom?: string;
      locationTo?: string;
      title?: string;
      remark?: string;
    },
  ) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.createSubTake({
      parentId: id,
      areaCode: body.areaCode,
      shelfCode: body.shelfCode,
      layerCode: body.layerCode,
      locationFrom: body.locationFrom,
      locationTo: body.locationTo,
      title: body.title,
      remark: body.remark,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 主盘点单确认盈亏（子单全部提交后由仓库主管确认） */
  @Post(':id/confirm-result')
  async confirmResult(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { remark?: string },
  ) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.confirmMain({
      id,
      remark: body.remark,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 可选仓库列表（按仓库代码，含库存行数） */
  @Get('warehouses')
  async getWarehouses() {
    const result = await this.stockTakeService.getWarehouseOptions();
    return { code: 0, message: 'success', data: result };
  }

  /** 盘点单列表 */
  @Get('list')
  async getList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('takeNo') takeNo?: string,
    @Query('status') status?: string,
    @Query('periodMonth') periodMonth?: string,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const result = await this.stockTakeService.getList({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      takeNo,
      status,
      periodMonth,
      warehouseCode,
      startDate,
      endDate,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 盘点单详情 */
  @Get('detail/:id')
  async getDetail(@Param('id') id: string) {
    const result = await this.stockTakeService.getDetail(id);
    return { code: 0, message: 'success', data: result };
  }

  /** 盘点明细（按物料编码 / 供应商名称或代码 / 差异类型筛选） */
  @Get(':id/items')
  async getItems(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('materialCode') materialCode?: string,
    @Query('materialName') materialName?: string,
    @Query('supplier') supplier?: string,
    @Query('diffType') diffType?: string,
    @Query('stockStatus') stockStatus?: string,
    @Query('locationCode') locationCode?: string,
    @Query('batchNo') batchNo?: string,
    @Query('onlyDiff') onlyDiff?: string,
  ) {
    const result = await this.stockTakeService.getItems(id, {
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      materialCode, materialName, supplier, diffType, stockStatus, locationCode, batchNo, onlyDiff,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 扫码盘点（逐箱扫描物料标签，自动核算账实差异） */
  @Post(':id/scan')
  async scan(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { qrContent: string; locationCode?: string; operatorId?: string; operatorName?: string },
  ) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.scanLabel({
      id,
      qrContent: body.qrContent,
      locationCode: body.locationCode,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 手工录入实盘数量 */
  @Post(':id/item/:itemId/adjust')
  async adjust(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { actualQty: number; remark?: string; operatorId?: string; operatorName?: string },
  ) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.adjustItem({
      id, itemId,
      actualQty: Number(body.actualQty),
      remark: body.remark,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 确认实物数量（账面有实物无 → 盘亏） */
  @Post(':id/item/:itemId/confirm')
  async confirm(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { remark?: string; operatorId?: string; operatorName?: string },
  ) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.confirmMissing({
      id, itemId,
      remark: body.remark,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 提交仓库主管审批 */
  @Post(':id/submit')
  async submit(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { remark?: string; operatorId?: string; operatorName?: string },
  ) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.submitTake({
      id,
      remark: body.remark,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 仓库主管审批 */
  @Post(':id/approve')
  async approve(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { pass: boolean; approvalRemark?: string; approverId?: string; approverName?: string },
  ) {
    // 审批人一律以登录身份为准，忽略请求体传入（防冒名）
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.approveTake({
      id,
      pass: !!body.pass,
      approvalRemark: body.approvalRemark,
      approverId: userId,
      approverName: req.userContext?.userName || req.userContext?.account || '',
      approverRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 系统管理员授权修改已批准的盘点单 */
  @Post(':id/unlock')
  async unlock(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { reason: string; operatorId?: string; operatorName?: string },
  ) {
    // 操作人一律以登录身份为准，忽略请求体传入（防冒名）
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.unlockTake({
      id,
      reason: body.reason,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 取消盘点单 */
  @Post(':id/cancel')
  async cancel(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { operatorId?: string; operatorName?: string },
  ) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.cancelTake({
      id,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 删除已取消的盘点单（明细与日志一并清除） */
  @Post(':id/delete')
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { operatorId?: string; operatorName?: string },
  ) {
    const userId = req.userContext?.userId || '';
    const role = await this.getUserRole(userId);
    const result = await this.stockTakeService.deleteTake({
      id,
      operatorId: userId,
      operatorName: req.userContext?.userName || req.userContext?.account || '',
      operatorRole: role,
    });
    return { code: 0, message: 'success', data: result };
  }

  /** 盘点报表汇总 */
  @Get(':id/report')
  async getReport(@Param('id') id: string) {
    const result = await this.stockTakeService.getReport(id);
    return { code: 0, message: 'success', data: result };
  }

  /** 操作日志（追溯） */
  @Get(':id/logs')
  async getLogs(@Param('id') id: string) {
    const result = await this.stockTakeService.getLogs(id);
    return { code: 0, message: 'success', data: result };
  }
}
