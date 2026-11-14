import { Controller, Get, Post, Body, Query, Req, Res, BadRequestException } from '@nestjs/common';
import { NeedLogin } from '../../common/auth/need-login.decorator';
import type { Request, Response } from 'express';
import { InventoryService } from './inventory.service';
import type { Inventory, StockTransfer, PaginatedResponse, ExpiryInventory, ExpiryReinspectionResult } from '@shared/api.interface';

@Controller('api/inventory')
@NeedLogin()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('list')
  async getInventoryList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('materialCode') materialCode?: string,
    @Query('locationId') locationId?: string,
    @Query('locationCode') locationCode?: string,
    @Query('batchNo') batchNo?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('stockStatus') stockStatus?: string,
    /** 效期筛选：expired=已超期 / warning=超期预警（30 天内到期） */
    @Query('expiryStatus') expiryStatus?: string,
    @Query('specialAdmitOnly') specialAdmitOnly?: string,
    // 别名：任务书里写作 onlySpecialAdmit，两个都收，避免前后端参数名对不上
    @Query('onlySpecialAdmit') onlySpecialAdmit?: string,
  ): Promise<PaginatedResponse<Inventory>> {
    return this.inventoryService.getInventoryList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      materialCode,
      locationId,
      locationCode,
      batchNo,
      warehouseId,
      stockStatus,
      expiryStatus,
      specialAdmitOnly: specialAdmitOnly ?? onlySpecialAdmit,
    });
  }

  @Get('summary')
  async getInventorySummary(): Promise<Array<{ materialId: string; materialCode: string; materialName: string; totalQty: number; unit: string }>> {
    return this.inventoryService.getInventorySummary();
  }

  /**
   * 库存现有量统计：按仓库代码 + 物料编号汇总库存数量（含不良品仓）。
   */
  @Get('stock-summary')
  async getStockSummary(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '50',
    @Query('warehouseCode') warehouseCode?: string,
    @Query('materialCode') materialCode?: string,
    @Query('includeDefective') includeDefective?: string,
    @Query('stockStatus') stockStatus?: string,
  ) {
    return this.inventoryService.getStockSummary({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 50,
      warehouseCode,
      materialCode,
      // 默认包含不良品仓；只有显式传 0/false 才排除
      includeDefective: includeDefective !== '0' && includeDefective !== 'false',
      stockStatus,
    });
  }

  /**
   * 库存现有量统计 → 导出 Excel。
   *
   * 与 `/stock-summary` 共用同一段聚合 SQL，按当前筛选条件导出**全部行**（不分页），
   * 末尾追加合计行，并给库存数量列设数值格式，方便在 Excel 里直接求和/透视。
   *
   * 直接用服务端 xlsx 生成而不是前端拼 CSV：
   *  1. 真正的 .xlsx，Excel 打开不会出现「科学计数/文本型数字」；
   *  2. 不受浏览器内存与 pageSize 上限影响；
   *  3. 表头语言跟随界面语言（lang=zh|en|vi）。
   */
  @Get('stock-summary/export')
  async exportStockSummary(
    @Res() res: Response,
    @Query('warehouseCode') warehouseCode?: string,
    @Query('materialCode') materialCode?: string,
    @Query('includeDefective') includeDefective?: string,
    @Query('stockStatus') stockStatus?: string,
    @Query('lang') lang?: string,
  ) {
    const result = await this.inventoryService.getStockSummaryAll({
      warehouseCode,
      materialCode,
      // 默认包含不良品仓；只有显式传 0/false 才排除（与列表接口一致）
      includeDefective: includeDefective !== '0' && includeDefective !== 'false',
      stockStatus,
    });

    if (!result.items.length) {
      throw new BadRequestException('当前筛选条件下没有可导出的库存数据');
    }

    let xlsxModule: any;
    try {
      xlsxModule = await import('xlsx');
    } catch {
      throw new BadRequestException('导出功能不可用（xlsx 库未安装）');
    }
    const XLSX = xlsxModule.default ?? xlsxModule;

    const dict: Record<string, { headers: string[]; total: string; sheet: string; file: string }> = {
      zh: {
        headers: ['仓库代码', '仓库名称', '物料编码', '物料名称', '单位', '库位数', '批次数', '库存数量'],
        total: '合计',
        sheet: '库存现有量',
        file: '库存现有量统计',
      },
      en: {
        headers: ['Warehouse Code', 'Warehouse Name', 'Material Code', 'Material Name', 'Unit', 'Locations', 'Batches', 'Stock Qty'],
        total: 'Total',
        sheet: 'Stock Summary',
        file: 'stock_summary',
      },
      vi: {
        headers: ['Mã kho', 'Tên kho', 'Mã vật tư', 'Tên vật tư', 'Đơn vị', 'Số vị trí', 'Số lô', 'Số lượng tồn'],
        total: 'Tổng cộng',
        sheet: 'Tồn kho hiện có',
        file: 'ton_kho_hien_co',
      },
    };
    const t = dict[String(lang || 'zh').toLowerCase()] || dict.zh;

    const aoa: any[][] = [t.headers];
    for (const it of result.items) {
      aoa.push([
        it.warehouseCode,
        it.warehouseName || '',
        it.materialCode,
        it.materialName || '',
        it.unit || '',
        it.locations,
        it.batches,
        it.qty,
      ]);
    }
    // 合计行：只填首列标签与末列数量，中间留空避免被当成一条物料
    aoa.push([t.total, '', '', '', '', '', '', result.grandQty]);

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);

    // 列宽按最长的内容估：中文按 2 个字符宽算，避免出现一串 ####
    const widthOf = (v: any) => {
      const s = String(v ?? '');
      return s.replace(/[^\x00-\xff]/g, 'xx').length;
    };
    const colWidths = t.headers.map((_: string, c: number) => {
      let w = widthOf(t.headers[c]);
      for (let r = 1; r < aoa.length; r += 1) w = Math.max(w, widthOf(aoa[r][c]));
      return { wch: Math.min(Math.max(w + 2, 8), 60) };
    });
    worksheet['!cols'] = colWidths;

    // 表头行 + 数据行开启筛选（不含合计行，否则合计会被筛来筛去）
    worksheet['!autofilter'] = {
      ref: `A1:${XLSX.utils.encode_col(t.headers.length - 1)}${result.items.length + 1}`,
    };

    // 库存数量列设数值格式，Excel 里可直接求和
    const qtyCol = t.headers.length - 1;
    for (let r = 1; r < aoa.length; r += 1) {
      const addr = XLSX.utils.encode_cell({ r, c: qtyCol });
      if (worksheet[addr]) worksheet[addr].z = '#,##0.####';
    }

    const workbook = XLSX.utils.book_new();
    workbook.Props = {
      Title: t.sheet,
      Subject: `${t.total}: ${result.grandQty}`,
      Comments: `rows=${result.items.length}; warehouse=${warehouseCode || 'ALL'}; material=${materialCode || 'ALL'}; includeDefective=${includeDefective !== '0' && includeDefective !== 'false'}`,
    };
    XLSX.utils.book_append_sheet(workbook, worksheet, t.sheet);

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const fileName = encodeURIComponent(
      `${t.file}_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);
    res.send(buffer);
  }

  // ========== 库存调拨 ==========
  // 调拨接口说明（避免混淆）：
  //  - POST /api/inventory/transfer   跨仓调拨：源库位与目标库位可属于不同仓库，用于仓库间移动
  //  - POST /api/inventory/intra-transfer 库内调拨：源库位与目标库位必须属于同一仓库（需传 warehouseId），仅在本仓库内换库位
  // 两个接口均完成扣减源库存 + 增加目标库存 + 写调拨记录；按业务场景选择对应入口。

  @Post('transfer')
  async transferStock(
    @Req() req: Request,
    @Body() body: {
      fromLocationId: string;
      toLocationId: string;
      materialId: string;
      batchNo?: string;
      quantity: number;
      operatorId?: string;
      operatorName?: string;
      remark?: string;
    },
  ): Promise<StockTransfer> {
    const userId = req.userContext?.userId;
    return this.inventoryService.transferStock({
      ...body,
      // 审计字段一律以登录身份为准，忽略请求体传入（防止已登录用户冒名写审计）
      operatorId: userId || '',
      operatorName: req.userContext?.userName || '',
    });
  }

  @Post('intra-transfer')
  async intraTransfer(
    @Req() req: Request,
    @Body() body: {
      warehouseId: string;
      fromLocationId: string;
      toLocationId: string;
      materialId: string;
      batchNo?: string;
      quantity: number;
      remark?: string;
    },
  ): Promise<StockTransfer> {
    const userId = req.userContext?.userId;
    return this.inventoryService.intraTransfer({
      ...body,
      operatorId: userId || '',
      operatorName: req.userContext?.userName || '',
    });
  }

  @Post('intra-transfer/verify-source')
  async verifySourceLocation(
    @Body() body: {
      locationCode: string;
      items: Array<{ qrContent: string; supplierCode: string; materialCode: string; productionDate: string; batchNo: string; serialNo: string; quantity: number }>;
    },
  ): Promise<{
    valid: boolean;
    errorCode?: string;
    errorMessage?: string;
    locationId?: string;
    locationCode?: string;
    warehouseId?: string;
    whCode?: string;
    items?: Array<{
      qrContent: string;
      supplierCode: string;
      materialCode: string;
      materialName: string;
      unit: string;
      productionDate: string;
      batchNo: string;
      serialNo: string;
      quantity: number;
      materialId: string;
      supplierId: string;
    }>;
    failedItems?: Array<{ materialCode: string; batchNo: string; serialNo: string; reason: string }>;
  }> {
    return this.inventoryService.verifySourceLocation(body);
  }

  @Post('intra-transfer/verify-target')
  async verifyTargetLocation(
    @Body() body: {
      targetLocationCode: string;
      sourceWarehouseId: string;
    },
  ): Promise<{
    valid: boolean;
    errorCode?: string;
    errorMessage?: string;
    locationId?: string;
    locationCode?: string;
    warehouseId?: string;
    whCode?: string;
  }> {
    return this.inventoryService.verifyTargetLocation(body);
  }

  @Post('intra-transfer/batch')
  async batchIntraTransfer(
    @Req() req: Request,
    @Body() body: {
      fromLocationId: string;
      toLocationId: string;
      warehouseId: string;
      items: Array<{
        qrContent: string;
        supplierCode: string;
        materialCode: string;
        materialName: string;
        unit: string;
        productionDate: string;
        batchNo: string;
        serialNo: string;
        quantity: number;
        materialId: string;
        supplierId: string;
      }>;
      remark?: string;
    },
  ): Promise<StockTransfer[]> {
    const userId = req.userContext?.userId;
    return this.inventoryService.batchIntraTransfer({
      ...body,
      operatorId: userId || '',
      operatorName: req.userContext?.userName || '',
    });
  }

  @Get('transfer/list')
  async getTransferList(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('transferNo') transferNo?: string,
    @Query('materialCode') materialCode?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
  ): Promise<PaginatedResponse<StockTransfer>> {
    return this.inventoryService.getTransferList({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      transferNo,
      materialCode,
      startDate,
      endDate,
      status,
    });
  }

  @Post('adjust')
  async adjustInventory(
    @Req() req: Request,
    @Body() body: {
      inventoryId: string;
      actualQty: number;
      reason: string;
      operatorId?: string;
      operatorName?: string;
      /** BUG-017：系统管理员强制调整锁定库存的授权标记与原因 */
      force?: boolean;
      forceReason?: string;
    },
  ): Promise<Inventory> {
    const userId = req.userContext?.userId;
    return this.inventoryService.adjustInventory({
      ...body,
      // 审计字段一律以登录身份为准，忽略请求体传入（防止已登录用户冒名写审计）
      operatorId: userId || '',
      operatorName: req.userContext?.userName || '',
    });
  }

  @Post('lock')
  async lockInventory(
    @Req() req: Request,
    @Body() body: { inventoryId: string; lockReason: string; operatorId?: string; operatorName?: string },
  ): Promise<Inventory> {
    const userId = req.userContext?.userId;
    return this.inventoryService.lockInventory({
      ...body,
      // 审计字段一律以登录身份为准，忽略请求体传入（防止已登录用户冒名写审计）
      operatorId: userId || '',
      operatorName: req.userContext?.userName || '',
    });
  }

  @Post('unlock')
  async unlockInventory(
    @Req() req: Request,
    @Body() body: { inventoryId: string; operatorId?: string; operatorName?: string; reason?: string },
  ): Promise<Inventory> {
    const userId = req.userContext?.userId;
    return this.inventoryService.unlockInventory({
      ...body,
      // 审计字段一律以登录身份为准，忽略请求体传入（防止已登录用户冒名写审计）
      operatorId: userId || '',
      operatorName: req.userContext?.userName || '',
    });
  }

  @Get('expiry')
  async getExpiryInventory(
    @Query('type') type: 'warning' | 'expired' = 'warning',
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
    @Query('materialCode') materialCode?: string,
  ): Promise<PaginatedResponse<ExpiryInventory>> {
    return this.inventoryService.getExpiryInventory({
      type,
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      materialCode,
    });
  }

  /** 某物料（可限定批次）在良品仓的超期 / 预警库存明细（IQC 检验页处置超期物料用） */
  @Get('expiry/by-material')
  async getMaterialExpiryStock(
    @Query('materialId') materialId: string,
    @Query('batchNo') batchNo?: string,
  ): Promise<ExpiryInventory[]> {
    return this.inventoryService.getMaterialExpiryStock(materialId, batchNo);
  }

  @Post('expiry/reinspect')
  async submitExpiryReinspection(
    @Req() req: Request,
    @Body() body: { inventoryIds: string[] },
  ): Promise<ExpiryReinspectionResult> {
    const userId = req.userContext?.userId;
    return this.inventoryService.submitExpiryReinspection({
      inventoryIds: body.inventoryIds,
      operatorId: userId || '',
      operatorName: req.userContext?.userName || '',
    });
  }

  @Post('expiry/extend')
  async extendExpiry(
    @Req() req: Request,
    @Body() body: { inventoryId: string; extendDays?: number; newExpiryDate?: string; remark?: string },
  ): Promise<{ success: boolean; newExpiryDate: string; extendedDays: number; scrapDate: string | null; maxExtendDays: number | null }> {
    const userId = req.userContext?.userId;
    return this.inventoryService.extendExpiry({
      inventoryId: body.inventoryId,
      extendDays: body.extendDays,
      newExpiryDate: body.newExpiryDate,
      remark: body.remark,
      operatorId: userId || '',
      operatorName: req.userContext?.userName || '',
    });
  }

  /**
   * 按「物料 + 物理批次」批量延期：IQC 待检清单维护超期物料新有效期用。
   * 一个检验批次对应多个库位行时，由服务端在同一事务内一次写完，避免半成功。
   * 检验员只填 extendDays，截止日由服务端按「当前有效期 + 天数」计算，且不得超过强制报废期。
   */
  @Post('expiry/extend-by-batch')
  async extendExpiryByBatch(
    @Req() req: Request,
    @Body() body: { materialId: string; batchNo: string; extendDays?: number; newExpiryDate?: string; remark?: string },
  ): Promise<{
    success: boolean;
    affected: number;
    extendedDays: number;
    earliestExpiryDate: string | null;
    newExpiryDate: string;
    scrapDate: string | null;
    maxExtendDays: number | null;
  }> {
    const userId = req.userContext?.userId;
    return this.inventoryService.extendExpiryByBatch({
      materialId: body.materialId,
      batchNo: body.batchNo,
      extendDays: body.extendDays,
      newExpiryDate: body.newExpiryDate,
      remark: body.remark,
      operatorId: userId || '',
    });
  }

  // 不良品调拨已升级为「单据制单 + 扫码执行」，统一走 /api/defective-move：
  //   制单 → 仓库主管确认 → 扫描货物标签 + 扫描不良品库位码 → 执行。
  // 原来的「自由扫码、无单据直接确认」入口已下线（无单据 = 无复核对象，搬错也无人知晓）。
}
