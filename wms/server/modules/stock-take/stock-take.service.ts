import { Inject, Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, or, ilike, gte, lte, desc, asc, sql, inArray, count } from 'drizzle-orm';
import {
  stockTakeOrder,
  stockTakeItem,
  stockTakeLog,
  inventory,
  material,
  supplier,
  warehouseLocation,
  warehouse,
  sysParam,
  receiptOrder,
} from '@server/database/schema';

/** 允许创建/盘点/提交的角色
 *  仓库主管（wh_manager）同样要能扫码盘点：原来只有仓管员，主管进盘点单看不到扫码区，
 *  大批量盘点时主管无法支援。审批权限仍在 APPROVE_ROLES 单独控制。 */
const OPERATE_ROLES = ['admin', 'wh_keeper', 'wh_manager'];
/** 允许审批的角色 */
const APPROVE_ROLES = ['admin', 'wh_manager'];
/** 允许授权修改的角色（审批后解锁） */
const UNLOCK_ROLES = ['admin'];

/** 盘点范围 → 库存状态集合（F-11：待检库存 pending_qc 也纳入账面快照，保证账面完整；盘点不改账） */
const SCOPE_STATUS: Record<string, string[]> = {
  all: ['good', 'pending_qc', 'defective'],
  good: ['good', 'pending_qc'],
  defective: ['defective'],
  rework: ['rework'],
};

/** 新建盘点单时选择「全部仓库」→ 按仓库代码各建一单 */
export const ALL_WAREHOUSES = '__all__';

interface ScannedLabelEntry {
  labelNo: string;
  materialCode?: string;
  batchNo?: string;
  qty: number;
  scanTime: string;
  operatorName?: string;
  manual?: boolean;
}

@Injectable()
export class StockTakeService {
  private readonly logger = new Logger(StockTakeService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  // ==================== 工具方法 ====================

  private async generateTakeNo(periodMonth: string): Promise<string> {
    const ym = (periodMonth || new Date().toISOString().slice(0, 7)).replace('-', '');
    const result = await this.db.execute<{ seq: string }>(
      sql`SELECT nextval('seq_stock_take_no') AS seq`,
    );
    const seq = Number(result[0]?.seq ?? 1);
    return `PD${ym}${seq.toString().padStart(4, '0')}`;
  }

  /** 解析六段码标签：供应商*料号*生产日期*数量*批次*流水号 */
  private parseLabel(label: string) {
    const raw = (label || '').trim();
    if (!raw) throw new BadRequestException('请扫描物料标签');
    const parts = raw.split('*');
    if (parts.length < 6) {
      throw new BadRequestException('标签格式错误：应为六段码「供应商*料号*生产日期*数量*批次*流水号」');
    }
    const [supplierCode, materialCode, productionDate, qtyStr, batchNo, serialNo] = parts;
    if (!materialCode || !batchNo) {
      throw new BadRequestException('标签格式错误：料号或批次为空');
    }
    const quantity = Number(qtyStr);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('标签中数量无效');
    }
    return { supplierCode, materialCode, productionDate, quantity, batchNo, serialNo, raw };
  }

  private async log(takeId: string, action: string, detail: string, operatorId?: string, operatorName?: string, itemId?: string) {
    await this.db.insert(stockTakeLog).values({
      takeId,
      itemId: itemId ?? null,
      action,
      detail,
      operatorId: operatorId || null,
      operatorName: operatorName || null,
    });
  }

  private async getOrderOrThrow(id: string) {
    const rows = await this.db.select().from(stockTakeOrder).where(eq(stockTakeOrder.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException('盘点单不存在');
    return rows[0];
  }

  private assertCanOperate(order: any, role?: string) {
    if (role && !OPERATE_ROLES.includes(role)) {
      throw new ForbiddenException('仅仓管员可执行盘点操作');
    }
    if (order.status === 'cancelled') throw new BadRequestException('盘点单已取消，不可操作');
    if (order.status === 'pending_approval') throw new BadRequestException('盘点单已提交审批，不可修改');
    if (order.status === 'approved') {
      throw new BadRequestException('盘点单已批准归档，如需修改请由系统管理员授权后再操作');
    }
  }

  private async refreshSummary(takeId: string) {
    const rows = await this.db
      .select({
        totalLines: sql<string>`COUNT(*)`,
        checkedLines: sql<string>`COUNT(*) FILTER (WHERE ${stockTakeItem.checked} = true)`,
        matchLines: sql<string>`COUNT(*) FILTER (WHERE ${stockTakeItem.diffType} = 'match')`,
        profitLines: sql<string>`COUNT(*) FILTER (WHERE ${stockTakeItem.diffType} = 'profit')`,
        lossLines: sql<string>`COUNT(*) FILTER (WHERE ${stockTakeItem.diffType} = 'loss')`,
        // 数量合计仅统计已盘点的行（未盘点行账面/实盘均不计入，避免误导）
        bookQtyTotal: sql<string>`COALESCE(SUM(${stockTakeItem.bookQty}) FILTER (WHERE ${stockTakeItem.checked} = true), 0)`,
        actualQtyTotal: sql<string>`COALESCE(SUM(${stockTakeItem.actualQty}) FILTER (WHERE ${stockTakeItem.checked} = true), 0)`,
        diffQtyTotal: sql<string>`COALESCE(SUM(${stockTakeItem.actualQty} - ${stockTakeItem.bookQty}) FILTER (WHERE ${stockTakeItem.checked} = true), 0)`,
      })
      .from(stockTakeItem)
      .where(eq(stockTakeItem.takeId, takeId));

    const r = rows[0] ?? ({} as any);
    await this.db.update(stockTakeOrder).set({
      totalLines: Number(r.totalLines ?? 0),
      checkedLines: Number(r.checkedLines ?? 0),
      matchLines: Number(r.matchLines ?? 0),
      profitLines: Number(r.profitLines ?? 0),
      lossLines: Number(r.lossLines ?? 0),
      bookQtyTotal: String(r.bookQtyTotal ?? 0),
      actualQtyTotal: String(r.actualQtyTotal ?? 0),
      diffQtyTotal: String(r.diffQtyTotal ?? 0),
      updatedAt: new Date(),
    }).where(eq(stockTakeOrder.id, takeId));
  }

  private mapOrder(row: any) {
    const num = (v: any) => Number(v ?? 0);
    return {
      id: row.id,
      takeNo: row.takeNo,
      periodMonth: row.periodMonth,
      takeType: row.takeType,
      scope: row.scope,
      parentId: row.parentId ?? undefined,
      orderType: row.orderType ?? 'standalone',
      scopeArea: row.scopeArea ?? undefined,
      scopeShelf: row.scopeShelf ?? undefined,
      scopeLayer: row.scopeLayer ?? undefined,
      scopeLocFrom: row.scopeLocFrom ?? undefined,
      scopeLocTo: row.scopeLocTo ?? undefined,
      childCount: Number(row.childCount ?? 0),
      warehouseId: row.warehouseId ?? undefined,
      warehouseCode: row.warehouseCode ?? undefined,
      warehouseName: row.warehouseName ?? undefined,
      status: row.status,
      title: row.title ?? undefined,
      operatorId: row.operatorId ?? undefined,
      operatorName: row.operatorName ?? undefined,
      approverId: row.approverId ?? undefined,
      approverName: row.approverName ?? undefined,
      approvalTime: row.approvalTime ? new Date(row.approvalTime).toISOString() : undefined,
      approvalRemark: row.approvalRemark ?? undefined,
      submitTime: row.submitTime ? new Date(row.submitTime).toISOString() : undefined,
      unlockAuthorizedName: row.unlockAuthorizedName ?? undefined,
      unlockAuthorizedAt: row.unlockAuthorizedAt ? new Date(row.unlockAuthorizedAt).toISOString() : undefined,
      unlockReason: row.unlockReason ?? undefined,
      revisionCount: Number(row.revisionCount ?? 0),
      totalLines: Number(row.totalLines ?? 0),
      checkedLines: Number(row.checkedLines ?? 0),
      matchLines: Number(row.matchLines ?? 0),
      profitLines: Number(row.profitLines ?? 0),
      lossLines: Number(row.lossLines ?? 0),
      bookQtyTotal: num(row.bookQtyTotal),
      actualQtyTotal: num(row.actualQtyTotal),
      diffQtyTotal: num(row.diffQtyTotal),
      remark: row.remark ?? undefined,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
    };
  }

  private mapItem(row: any) {
    return {
      id: row.id,
      takeId: row.takeId,
      inventoryId: row.inventoryId ?? undefined,
      materialId: row.materialId ?? undefined,
      materialCode: row.materialCode,
      materialName: row.materialName ?? undefined,
      specification: row.specification ?? undefined,
      unit: row.unit,
      supplierId: row.supplierId ?? undefined,
      supplierCode: row.supplierCode ?? undefined,
      supplierName: row.supplierName ?? undefined,
      locationId: row.locationId ?? undefined,
      locationCode: row.locationCode ?? undefined,
      warehouseId: row.warehouseId ?? undefined,
      warehouseCode: row.warehouseCode ?? undefined,
      warehouseName: row.warehouseName ?? undefined,
      stockStatus: row.stockStatus,
      batchNo: row.batchNo ?? undefined,
      labelNo: row.labelNo ?? undefined,
      productionDate: row.productionDate
        ? (typeof row.productionDate === 'string' ? row.productionDate : new Date(row.productionDate).toISOString().slice(0, 10))
        : undefined,
      bookQty: Number(row.bookQty ?? 0),
      actualQty: Number(row.actualQty ?? 0),
      diffQty: Number(row.diffQty ?? 0),
      diffType: row.diffType,
      scannedLabels: Array.isArray(row.scannedLabels) ? row.scannedLabels : [],
      scanCount: Number(row.scanCount ?? 0),
      checked: !!row.checked,
      remark: row.remark ?? undefined,
    };
  }

  // ==================== 盘点单 ====================

  /** 新建盘点单（仓管员）
   *  warehouseCode 传具体仓库代码 → 仅为该仓库建单；传 __all__ 或不传 → 按仓库代码各建一单 */
  async createTake(params: {
    scope?: string;
    warehouseCode?: string;
    periodMonth?: string;
    takeType?: string;
    title?: string;
    remark?: string;
    /** standalone=单张盘点单（原有行为）；main=主盘点单（不生成明细，只汇总子单） */
    orderType?: 'standalone' | 'main';
    operatorId?: string;
    operatorName?: string;
    operatorRole?: string;
  }) {
    const { scope = 'all', takeType = 'monthly', title, remark } = params;
    const orderType = params.orderType === 'main' ? 'main' : 'standalone';
    if (params.operatorRole && !OPERATE_ROLES.includes(params.operatorRole)) {
      throw new ForbiddenException('仅仓管员可创建盘点单');
    }
    const scopeKeys = SCOPE_STATUS[scope];
    if (!scopeKeys) throw new BadRequestException('盘点范围参数无效');
    const periodMonth = (params.periodMonth || new Date().toISOString().slice(0, 7));
    const wantCode = (params.warehouseCode || '').trim();

    // 1) 确定建单仓库（按仓库代码）
    let targets: Array<{ id: string; whCode: string; whNameZh: string }>;
    if (!wantCode || wantCode === ALL_WAREHOUSES) {
      targets = await this.db
        .select({ id: warehouse.id, whCode: warehouse.whCode, whNameZh: warehouse.whNameZh })
        .from(warehouse)
        .where(eq(warehouse.status, 'active'))
        .orderBy(asc(warehouse.whCode));
      if (targets.length === 0) throw new BadRequestException('暂无启用状态的仓库，无法创建盘点单');
    } else {
      targets = await this.db
        .select({ id: warehouse.id, whCode: warehouse.whCode, whNameZh: warehouse.whNameZh })
        .from(warehouse)
        .where(eq(warehouse.whCode, wantCode))
        .limit(1);
      if (targets.length === 0) {
        throw new BadRequestException(`仓库代码 ${wantCode} 不存在，请检查仓库主数据`);
      }
    }

    // 2) 逐个仓库生成盘点单
    const orders: any[] = [];
    const skipped: Array<{ warehouseCode: string; warehouseName: string; reason: string }> = [];
    for (const wh of targets) {
      const created = orderType === 'main'
        ? await this.createMainForWarehouse({
            wh,
            scope,
            periodMonth,
            takeType,
            title: title || undefined,
            remark,
            operatorId: params.operatorId,
            operatorName: params.operatorName,
          })
        : await this.createTakeForWarehouse({
            wh,
            scope,
            scopeKeys,
            periodMonth,
            takeType,
            title: title || undefined,
            remark,
            operatorId: params.operatorId,
            operatorName: params.operatorName,
          });
      if (created) orders.push(created);
      else skipped.push({ warehouseCode: wh.whCode, warehouseName: wh.whNameZh, reason: '该仓库在所选范围内暂无库存' });
    }

    if (orders.length === 0) {
      throw new BadRequestException('所选仓库在盘点范围内暂无库存，无法创建盘点单');
    }
    return { orders, skipped };
  }

  /** 为单个仓库生成盘点单与账面快照（无库存返回 null） */
  private async createTakeForWarehouse(params: {
    wh: { id: string; whCode: string; whNameZh: string };
    scope: string;
    scopeKeys: string[];
    periodMonth: string;
    takeType: string;
    title?: string;
    remark?: string;
    operatorId?: string;
    operatorName?: string;
  }) {
    const { wh, scope, scopeKeys, periodMonth, takeType, title, remark } = params;

    // 同一仓库同一期间允许多次盘点（月度盘点 + 临时抽盘、复盘等），
    // 不再做「同月同仓只能一张」的预检；单号由序列保证唯一，靠 takeType / title 区分批次。

    // 1) 生成单号
    const takeNo = await this.generateTakeNo(periodMonth);

    // 2) 账面快照：按本仓库的库存行（物料+库位+批次+库存状态）逐箱拉取
    const rows = await this.db
      .select({
        inventoryId: inventory.id,
        materialId: inventory.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        specification: material.specification,
        unit: inventory.unit,
        supplierId: inventory.supplierId,
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        locationId: inventory.locationId,
        locationCode: warehouseLocation.locationCode,
        warehouseId: warehouseLocation.warehouseId,
        warehouseCode: warehouse.whCode,
        warehouseName: warehouse.whNameZh,
        stockStatus: inventory.stockStatus,
        batchNo: inventory.batchNo,
        labelNo: inventory.labelNo,
        productionDate: inventory.productionDate,
        quantity: inventory.quantity,
      })
      .from(inventory)
      .innerJoin(material, eq(inventory.materialId, material.id))
      .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
      .leftJoin(warehouse, eq(warehouseLocation.warehouseId, warehouse.id))
      .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
      .where(and(
        inArray(inventory.stockStatus, scopeKeys),
        eq(warehouseLocation.warehouseId, wh.id),
      ));

    if (rows.length === 0) return null;

    const orderId = await this.db.transaction(async (tx) => {
      const [order] = await tx.insert(stockTakeOrder).values({
        takeNo,
        periodMonth,
        takeType,
        scope,
        warehouseId: wh.id,
        warehouseCode: wh.whCode,
        warehouseName: wh.whNameZh,
        status: 'draft',
        title: title || `${periodMonth} ${wh.whNameZh}（${wh.whCode}）库存盘点`,
        operatorId: params.operatorId || null,
        operatorName: params.operatorName || null,
        totalLines: rows.length,
        remark: remark || null,
      }).returning({ id: stockTakeOrder.id });
      const values = rows.map((r) => ({
        takeId: order.id,
        inventoryId: r.inventoryId,
        materialId: r.materialId,
        materialCode: r.materialCode,
        materialName: r.materialName,
        specification: r.specification,
        unit: r.unit || 'PCS',
        supplierId: r.supplierId,
        supplierCode: r.supplierCode,
        supplierName: r.supplierName,
        locationId: r.locationId,
        locationCode: r.locationCode,
        warehouseId: r.warehouseId,
        warehouseCode: r.warehouseCode,
        warehouseName: r.warehouseName,
        stockStatus: r.stockStatus,
        batchNo: r.batchNo,
        labelNo: r.labelNo,
        productionDate: r.productionDate
          ? (typeof r.productionDate === 'string' ? r.productionDate : new Date(r.productionDate).toISOString().slice(0, 10))
          : null,
        bookQty: String(r.quantity ?? 0),
        actualQty: '0',
        diffQty: '0',
        diffType: 'pending' as const,
        scannedLabels: [],
        scanCount: 0,
        checked: false,
      }));

      // 分批插入，避免单条 SQL 参数过多
      const BATCH = 200;
      for (let i = 0; i < values.length; i += BATCH) {
        await tx.insert(stockTakeItem).values(values.slice(i, i + BATCH));
      }
      return order.id;
    });

    await this.refreshSummary(orderId);
    await this.log(orderId, 'create',
      `创建盘点单 ${takeNo}（仓库 ${wh.whCode} ${wh.whNameZh}，范围 ${scope}，账面 ${rows.length} 行）`,
      params.operatorId, params.operatorName);

    const order = await this.getOrderOrThrow(orderId);
    return this.mapOrder(order);
  }

  // ==================== 主盘点单 / 子盘点单 ====================

  /**
   * 创建主盘点单：只建单头，不生成明细。
   * 明细由后续按「区域 / 货架 / 层 / 地址码范围」拆分的子盘点单承担，
   * 主单只做汇总对比与盈亏确认，避免同一批库存被主单和子单重复盘两遍。
   */
  private async createMainForWarehouse(params: {
    wh: { id: string; whCode: string; whNameZh: string };
    scope: string;
    periodMonth: string;
    takeType: string;
    title?: string;
    remark?: string;
    operatorId?: string;
    operatorName?: string;
  }) {
    const { wh, scope, periodMonth, takeType, title, remark } = params;

    // 同一期间同仓库允许多张主盘点单（分批盘点），不做重复预检

    const takeNo = await this.generateTakeNo(periodMonth);
    const [order] = await this.db.insert(stockTakeOrder).values({
      takeNo,
      periodMonth,
      takeType,
      scope,
      orderType: 'main',
      childCount: 0,
      warehouseId: wh.id,
      warehouseCode: wh.whCode,
      warehouseName: wh.whNameZh,
      status: 'draft',
      title: title || `${periodMonth} ${wh.whNameZh}（${wh.whCode}）主盘点单`,
      operatorId: params.operatorId || null,
      operatorName: params.operatorName || null,
      totalLines: 0,
      remark: remark || null,
    }).returning({ id: stockTakeOrder.id });

    await this.log(order.id, 'create',
      `创建主盘点单 ${takeNo}（仓库 ${wh.whCode} ${wh.whNameZh}），请按区域 / 地址码范围拆分子盘点单`,
      params.operatorId, params.operatorName);

    const created = await this.getOrderOrThrow(order.id);
    return this.mapOrder(created);
  }

  /** 子单范围条件（仓库 + 区域 / 货架 / 层 / 地址码起止，均取启用库位） */
  private buildScopeLocationConditions(params: {
    warehouseId: string;
    areaCode?: string;
    shelfCode?: string;
    layerCode?: string;
    locationFrom?: string;
    locationTo?: string;
  }) {
    const conds: any[] = [
      eq(warehouseLocation.warehouseId, params.warehouseId),
      eq(warehouseLocation.status, 'active'),
    ];
    if (params.areaCode) conds.push(eq(warehouseLocation.areaCode, params.areaCode));
    if (params.shelfCode) conds.push(eq(warehouseLocation.shelfCode, params.shelfCode));
    if (params.layerCode) conds.push(eq(warehouseLocation.layerCode, params.layerCode));
    if (params.locationFrom) conds.push(gte(warehouseLocation.locationCode, params.locationFrom));
    if (params.locationTo) conds.push(lte(warehouseLocation.locationCode, params.locationTo));
    return conds;
  }

  /**
   * 预览子盘点单范围：建单前先告诉用户「该范围会生成多少行、覆盖多少个库位」，
   * 避免用户建完才发现范围选错、或者范围为空。
   */
  async previewSubScope(params: {
    warehouseCode?: string;
    warehouseId?: string;
    scope?: string;
    areaCode?: string;
    shelfCode?: string;
    layerCode?: string;
    locationFrom?: string;
    locationTo?: string;
  }) {
    let warehouseId = params.warehouseId;
    if (!warehouseId) {
      if (!params.warehouseCode) throw new BadRequestException('缺少仓库参数');
      const wh = await this.db
        .select({ id: warehouse.id })
        .from(warehouse)
        .where(eq(warehouse.whCode, params.warehouseCode))
        .limit(1);
      if (wh.length === 0) throw new BadRequestException(`仓库代码 ${params.warehouseCode} 不存在`);
      warehouseId = wh[0].id;
    }

    const scopeKeys = SCOPE_STATUS[params.scope || 'all'] ?? SCOPE_STATUS.all;
    const locConds = this.buildScopeLocationConditions({
      warehouseId,
      areaCode: params.areaCode?.trim() || undefined,
      shelfCode: params.shelfCode?.trim() || undefined,
      layerCode: params.layerCode?.trim() || undefined,
      locationFrom: params.locationFrom?.trim() || undefined,
      locationTo: params.locationTo?.trim() || undefined,
    });

    const rows = await this.db
      .select({
        lines: sql<string>`COUNT(${inventory.id})`,
        locations: sql<string>`COUNT(DISTINCT ${warehouseLocation.id})`,
        qty: sql<string>`COALESCE(SUM(${inventory.quantity}::numeric), 0)`,
      })
      .from(inventory)
      .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
      .where(and(inArray(inventory.stockStatus, scopeKeys), ...locConds));

    const samples = await this.db
      .selectDistinct({ locationCode: warehouseLocation.locationCode })
      .from(warehouseLocation)
      .where(and(...locConds))
      .orderBy(asc(warehouseLocation.locationCode))
      .limit(8);

    const r = rows[0] ?? ({} as any);
    return {
      lines: Number(r.lines ?? 0),
      locations: Number(r.locations ?? 0),
      bookQty: Number(r.qty ?? 0),
      locationSamples: samples.map((s) => s.locationCode),
    };
  }

  /** 在某个主盘点单下创建子盘点单（按库位范围生成账面快照） */
  async createSubTake(params: {
    parentId: string;
    areaCode?: string;
    shelfCode?: string;
    layerCode?: string;
    locationFrom?: string;
    locationTo?: string;
    title?: string;
    remark?: string;
    operatorId?: string;
    operatorName?: string;
    operatorRole?: string;
  }) {
    if (params.operatorRole && !OPERATE_ROLES.includes(params.operatorRole)) {
      throw new ForbiddenException('仅仓管员 / 仓库主管可创建子盘点单');
    }
    const parent = await this.getOrderOrThrow(params.parentId);
    if (parent.orderType !== 'main') {
      throw new BadRequestException('只有主盘点单才能拆分子盘点单');
    }
    if (!['draft', 'rejected'].includes(parent.status)) {
      throw new BadRequestException(`主盘点单当前状态（${parent.status}）不可新增子单`);
    }
    if (!parent.warehouseId) throw new BadRequestException('主盘点单缺少仓库信息，请重建');

    const areaCode = params.areaCode?.trim() || undefined;
    const shelfCode = params.shelfCode?.trim() || undefined;
    const layerCode = params.layerCode?.trim() || undefined;
    const locationFrom = params.locationFrom?.trim() || undefined;
    const locationTo = params.locationTo?.trim() || undefined;
    if (!areaCode && !shelfCode && !layerCode && !locationFrom && !locationTo) {
      throw new BadRequestException('请至少指定区域、货架、层或地址码范围，避免子单覆盖整仓');
    }
    if (locationFrom && locationTo && locationFrom > locationTo) {
      throw new BadRequestException('起始地址码不能大于结束地址码');
    }

    const scopeKeys = SCOPE_STATUS[parent.scope] ?? SCOPE_STATUS.all;
    const locConds = this.buildScopeLocationConditions({
      warehouseId: parent.warehouseId,
      areaCode, shelfCode, layerCode, locationFrom, locationTo,
    });

    const rows = await this.db
      .select({
        inventoryId: inventory.id,
        materialId: inventory.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        specification: material.specification,
        unit: inventory.unit,
        supplierId: inventory.supplierId,
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        locationId: inventory.locationId,
        locationCode: warehouseLocation.locationCode,
        warehouseId: warehouseLocation.warehouseId,
        warehouseCode: warehouse.whCode,
        warehouseName: warehouse.whNameZh,
        stockStatus: inventory.stockStatus,
        batchNo: inventory.batchNo,
        labelNo: inventory.labelNo,
        productionDate: inventory.productionDate,
        quantity: inventory.quantity,
      })
      .from(inventory)
      .innerJoin(material, eq(inventory.materialId, material.id))
      .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
      .leftJoin(warehouse, eq(warehouseLocation.warehouseId, warehouse.id))
      .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
      .where(and(inArray(inventory.stockStatus, scopeKeys), ...locConds));

    if (rows.length === 0) {
      throw new BadRequestException('所选库位范围内没有库存明细，请调整区域或地址码范围');
    }

    // 与同主单下其他子单重叠校验：同一库存行不能被两张子单同时盘
    const siblingRows = await this.db
      .select({ inventoryId: stockTakeItem.inventoryId, takeNo: stockTakeOrder.takeNo })
      .from(stockTakeItem)
      .innerJoin(stockTakeOrder, eq(stockTakeItem.takeId, stockTakeOrder.id))
      .where(and(
        eq(stockTakeOrder.parentId, params.parentId),
        sql`${stockTakeOrder.status} <> 'cancelled'`,
        inArray(stockTakeItem.inventoryId, rows.map((r) => r.inventoryId)),
      ))
      .limit(1);
    if (siblingRows.length > 0) {
      throw new ConflictException(
        `所选范围与子盘点单 ${siblingRows[0].takeNo} 的明细重叠（同一库存行不能重复盘点），请调整范围`,
      );
    }

    const takeNo = await this.generateTakeNo(parent.periodMonth);
    const scopeText = [
      areaCode ? `区域 ${areaCode}` : '',
      shelfCode ? `货架 ${shelfCode}` : '',
      layerCode ? `层 ${layerCode}` : '',
      locationFrom || locationTo ? `地址码 ${locationFrom || '*'} ~ ${locationTo || '*'}` : '',
    ].filter(Boolean).join(' / ');

    const orderId = await this.db.transaction(async (tx) => {
      const [order] = await tx.insert(stockTakeOrder).values({
        takeNo,
        periodMonth: parent.periodMonth,
        takeType: parent.takeType,
        scope: parent.scope,
        orderType: 'sub',
        parentId: parent.id,
        scopeArea: areaCode ?? null,
        scopeShelf: shelfCode ?? null,
        scopeLayer: layerCode ?? null,
        scopeLocFrom: locationFrom ?? null,
        scopeLocTo: locationTo ?? null,
        warehouseId: parent.warehouseId,
        warehouseCode: parent.warehouseCode,
        warehouseName: parent.warehouseName,
        status: 'draft',
        title: params.title || `${parent.takeNo} ${scopeText || '子盘点'}`,
        operatorId: params.operatorId || null,
        operatorName: params.operatorName || null,
        totalLines: rows.length,
        remark: params.remark || null,
      }).returning({ id: stockTakeOrder.id });

      const values = rows.map((r) => ({
        takeId: order.id,
        inventoryId: r.inventoryId,
        materialId: r.materialId,
        materialCode: r.materialCode,
        materialName: r.materialName,
        specification: r.specification,
        unit: r.unit || 'PCS',
        supplierId: r.supplierId,
        supplierCode: r.supplierCode,
        supplierName: r.supplierName,
        locationId: r.locationId,
        locationCode: r.locationCode,
        warehouseId: r.warehouseId,
        warehouseCode: r.warehouseCode,
        warehouseName: r.warehouseName,
        stockStatus: r.stockStatus,
        batchNo: r.batchNo,
        labelNo: r.labelNo,
        productionDate: r.productionDate
          ? (typeof r.productionDate === 'string' ? r.productionDate : new Date(r.productionDate).toISOString().slice(0, 10))
          : null,
        bookQty: String(r.quantity ?? 0),
        actualQty: '0',
        diffQty: '0',
        diffType: 'pending' as const,
        scannedLabels: [],
        scanCount: 0,
        checked: false,
      }));

      const BATCH = 200;
      for (let i = 0; i < values.length; i += BATCH) {
        await tx.insert(stockTakeItem).values(values.slice(i, i + BATCH));
      }

      await tx.update(stockTakeOrder)
        .set({ childCount: sql`${stockTakeOrder.childCount} + 1`, updatedAt: new Date() })
        .where(eq(stockTakeOrder.id, parent.id));

      return order.id;
    });

    await this.refreshSummary(orderId);
    await this.log(orderId, 'create',
      `创建子盘点单 ${takeNo}（${scopeText}，账面 ${rows.length} 行）`,
      params.operatorId, params.operatorName);
    await this.log(parent.id, 'sub_create',
      `新增子盘点单 ${takeNo}（${scopeText}，账面 ${rows.length} 行）`,
      params.operatorId, params.operatorName);
    await this.refreshMainSummary(parent.id);

    const created = await this.getOrderOrThrow(orderId);
    return this.mapOrder(created);
  }

  /** 主盘点单汇总：把子单的应盘 / 已盘 / 盈亏 / 数量合计累加到主单 */
  private async refreshMainSummary(mainId: string) {
    const rows = await this.db
      .select({
        childCount: sql<string>`COUNT(*)`,
        totalLines: sql<string>`COALESCE(SUM(${stockTakeOrder.totalLines}), 0)`,
        checkedLines: sql<string>`COALESCE(SUM(${stockTakeOrder.checkedLines}), 0)`,
        matchLines: sql<string>`COALESCE(SUM(${stockTakeOrder.matchLines}), 0)`,
        profitLines: sql<string>`COALESCE(SUM(${stockTakeOrder.profitLines}), 0)`,
        lossLines: sql<string>`COALESCE(SUM(${stockTakeOrder.lossLines}), 0)`,
        bookQtyTotal: sql<string>`COALESCE(SUM(${stockTakeOrder.bookQtyTotal}), 0)`,
        actualQtyTotal: sql<string>`COALESCE(SUM(${stockTakeOrder.actualQtyTotal}), 0)`,
        diffQtyTotal: sql<string>`COALESCE(SUM(${stockTakeOrder.diffQtyTotal}), 0)`,
      })
      .from(stockTakeOrder)
      .where(and(
        eq(stockTakeOrder.parentId, mainId),
        sql`${stockTakeOrder.status} <> 'cancelled'`,
      ));

    const r = rows[0] ?? ({} as any);
    await this.db.update(stockTakeOrder).set({
      childCount: Number(r.childCount ?? 0),
      totalLines: Number(r.totalLines ?? 0),
      checkedLines: Number(r.checkedLines ?? 0),
      matchLines: Number(r.matchLines ?? 0),
      profitLines: Number(r.profitLines ?? 0),
      lossLines: Number(r.lossLines ?? 0),
      bookQtyTotal: String(r.bookQtyTotal ?? 0),
      actualQtyTotal: String(r.actualQtyTotal ?? 0),
      diffQtyTotal: String(r.diffQtyTotal ?? 0),
      updatedAt: new Date(),
    }).where(eq(stockTakeOrder.id, mainId));
  }

  /** 主单下的子单列表（含状态与进度） */
  async getChildren(parentId: string) {
    const rows = await this.db
      .select()
      .from(stockTakeOrder)
      .where(eq(stockTakeOrder.parentId, parentId))
      .orderBy(asc(stockTakeOrder.takeNo));
    return rows.map((r) => this.mapOrder(r));
  }

  /**
   * 主盘点单确认盈亏：所有子单必须已提交（待审批或已批准），
   * 汇总子单数据后把主单置为已批准，作为本期盘点结论。
   */
  async confirmMain(params: {
    id: string;
    remark?: string;
    operatorId?: string;
    operatorName?: string;
    operatorRole?: string;
  }) {
    const order = await this.getOrderOrThrow(params.id);
    if (params.operatorRole && !APPROVE_ROLES.includes(params.operatorRole)) {
      throw new ForbiddenException('仅仓库主管可确认主盘点单盈亏');
    }
    if (order.orderType !== 'main') {
      throw new BadRequestException('只有主盘点单可以确认盈亏');
    }
    if (order.status !== 'draft') {
      throw new BadRequestException(`主盘点单当前状态（${order.status}）不可确认盈亏`);
    }

    const children = await this.db
      .select({ takeNo: stockTakeOrder.takeNo, status: stockTakeOrder.status })
      .from(stockTakeOrder)
      .where(eq(stockTakeOrder.parentId, params.id));
    if (children.length === 0) {
      throw new BadRequestException('主盘点单下还没有子盘点单，请先拆分并完成盘点');
    }
    const notSubmitted = children.filter((c) => !['pending_approval', 'approved'].includes(c.status));
    if (notSubmitted.length > 0) {
      throw new BadRequestException(
        `以下子盘点单尚未提交：${notSubmitted.map((c) => c.takeNo).join('、')}`,
      );
    }

    await this.refreshMainSummary(params.id);

    const casRows = (await this.db
      .update(stockTakeOrder)
      .set({
        status: 'approved',
        approverId: params.operatorId || null,
        approverName: params.operatorName || null,
        approvalTime: new Date(),
        approvalRemark: params.remark ?? '主子盘点单汇总确认',
        updatedAt: new Date(),
      })
      .where(and(eq(stockTakeOrder.id, params.id), eq(stockTakeOrder.status, 'draft')))
      .returning({ id: stockTakeOrder.id })) as Array<{ id: string }>;

    if (casRows.length === 0) {
      throw new ConflictException('主盘点单状态已变更，请刷新后重试');
    }

    const latest = await this.getOrderOrThrow(params.id);
    await this.log(params.id, 'approve',
      `确认盈亏：${children.length} 张子单汇总，应盘 ${latest.totalLines} 行 / 已盘 ${latest.checkedLines} 行，`
      + `盘盈 ${latest.profitLines} 行、盘亏 ${latest.lossLines} 行，差异合计 ${latest.diffQtyTotal}`,
      params.operatorId, params.operatorName);

    return this.mapOrder(latest);
  }

  /** 主单的明细集合 = 所有子单明细 */
  private async resolveItemTakeIds(order: any): Promise<string[]> {
    if (order.orderType !== 'main') return [order.id];
    const children = await this.db
      .select({ id: stockTakeOrder.id })
      .from(stockTakeOrder)
      .where(and(
        eq(stockTakeOrder.parentId, order.id),
        sql`${stockTakeOrder.status} <> 'cancelled'`,
      ));
    return children.map((c) => c.id);
  }

  /**
   * 可选仓库列表：按仓库代码列出（含库存行数）。
   * 返回系统全部仓库（含停用）并附带 status —— 供「查询筛选」下拉放开停用仓库，
   * 「新建盘点单」由前端只取启用仓库，避免对停用仓库建单。
   */
  async getWarehouseOptions() {
    const rows = await this.db
      .select({
        id: warehouse.id,
        code: warehouse.whCode,
        name: warehouse.whNameZh,
        whType: warehouse.whType,
        status: warehouse.status,
        stockLines: sql<string>`COUNT(${inventory.id})`,
        goodLines: sql<string>`COUNT(${inventory.id}) FILTER (WHERE ${inventory.stockStatus} = 'good')`,
        defectiveLines: sql<string>`COUNT(${inventory.id}) FILTER (WHERE ${inventory.stockStatus} = 'defective')`,
        reworkLines: sql<string>`COUNT(${inventory.id}) FILTER (WHERE ${inventory.stockStatus} = 'rework')`,
      })
      .from(warehouse)
      .leftJoin(warehouseLocation, eq(warehouseLocation.warehouseId, warehouse.id))
      .leftJoin(inventory, eq(inventory.locationId, warehouseLocation.id))
      .groupBy(warehouse.id, warehouse.whCode, warehouse.whNameZh, warehouse.whType, warehouse.status)
      .orderBy(asc(warehouse.whCode));

    const paramRows = await this.db
      .select({ key: sysParam.paramKey, value: sysParam.paramValue })
      .from(sysParam)
      .where(inArray(sysParam.paramKey, ['good_warehouse_code', 'defective_warehouse_code']));
    const goodCode = paramRows.find((p) => p.key === 'good_warehouse_code')?.value;
    const defectiveCode = paramRows.find((p) => p.key === 'defective_warehouse_code')?.value;

    const num = (v: any) => Number(v ?? 0);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      whType: r.whType,
      status: r.status,
      stockLines: num(r.stockLines),
      goodLines: num(r.goodLines),
      defectiveLines: num(r.defectiveLines),
      reworkLines: num(r.reworkLines),
      isGoodWarehouse: !!goodCode && r.code === goodCode,
      isDefectiveWarehouse: !!defectiveCode && r.code === defectiveCode,
    }));
  }

  async getList(params: {
    page: number;
    pageSize: number;
    takeNo?: string;
    status?: string;
    periodMonth?: string;
    warehouseCode?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { page = 1, pageSize = 20 } = params;
    const offset = (page - 1) * pageSize;
    const conditions: any[] = [];
    if (params.takeNo) conditions.push(ilike(stockTakeOrder.takeNo, `%${params.takeNo}%`));
    if (params.status) conditions.push(eq(stockTakeOrder.status, params.status));
    if (params.periodMonth) conditions.push(eq(stockTakeOrder.periodMonth, params.periodMonth));
    if (params.warehouseCode) conditions.push(eq(stockTakeOrder.warehouseCode, params.warehouseCode));
    if (params.startDate) conditions.push(gte(stockTakeOrder.periodMonth, params.startDate));
    if (params.endDate) conditions.push(lte(stockTakeOrder.periodMonth, params.endDate));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const base = this.db.select().from(stockTakeOrder);
    const rows = await (where ? base.where(where) : base)
      .orderBy(desc(stockTakeOrder.createdAt))
      .limit(pageSize)
      .offset(offset);

    const countBase = this.db.select({ c: count() }).from(stockTakeOrder);
    const totalRows = await (where ? countBase.where(where) : countBase);
    const total = Number(totalRows[0]?.c ?? 0);

    return { items: rows.map((r) => this.mapOrder(r)), total, page, pageSize };
  }

  async getDetail(id: string) {
    const order = await this.getOrderOrThrow(id);
    if (order.orderType === 'main') {
      // 主单本身没有明细，汇总口径实时取自子单，避免子单变化后主单数字滞后
      await this.refreshMainSummary(id);
      const fresh = await this.getOrderOrThrow(id);
      return { ...this.mapOrder(fresh), children: await this.getChildren(id) };
    }
    return this.mapOrder(order);
  }

  /** 盘点明细（可按物料编码 / 供应商名称或代码 / 差异类型 / 库位筛选） */
  async getItems(id: string, params: {
    page?: number;
    pageSize?: number;
    materialCode?: string;
    materialName?: string;
    supplier?: string;
    diffType?: string;
    stockStatus?: string;
    locationCode?: string;
    batchNo?: string;
    onlyDiff?: string;
  }) {
    const order = await this.getOrderOrThrow(id);
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 20;
    const offset = (page - 1) * pageSize;

    // 主盘点单的明细来自各子单；单张/子单只看自己
    const takeIds = await this.resolveItemTakeIds(order);
    if (takeIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const conditions: any[] = [inArray(stockTakeItem.takeId, takeIds)];
    if (params.materialCode) conditions.push(ilike(stockTakeItem.materialCode, `%${params.materialCode}%`));
    if (params.materialName) conditions.push(ilike(stockTakeItem.materialName, `%${params.materialName}%`));
    if (params.supplier) {
      conditions.push(
        or(
          ilike(stockTakeItem.supplierName, `%${params.supplier}%`),
          ilike(stockTakeItem.supplierCode, `%${params.supplier}%`),
        ),
      );
    }
    if (params.diffType) conditions.push(eq(stockTakeItem.diffType, params.diffType));
    if (params.stockStatus) conditions.push(eq(stockTakeItem.stockStatus, params.stockStatus));
    if (params.locationCode) conditions.push(ilike(stockTakeItem.locationCode, `%${params.locationCode}%`));
    if (params.batchNo) conditions.push(ilike(stockTakeItem.batchNo, `%${params.batchNo}%`));
    if (params.onlyDiff === 'true') conditions.push(sql`${stockTakeItem.diffType} IN ('profit','loss')`);

    const where = and(...conditions);
    const rows = await this.db
      .select()
      .from(stockTakeItem)
      .where(where)
      .orderBy(
        // 差异优先展示：盘盈/盘亏在前
        sql`CASE ${stockTakeItem.diffType} WHEN 'profit' THEN 0 WHEN 'loss' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END`,
        asc(stockTakeItem.materialCode),
      )
      .limit(pageSize)
      .offset(offset);

    const totalRows = await this.db.select({ c: count() }).from(stockTakeItem).where(where);
    const total = Number(totalRows[0]?.c ?? 0);

    const items = rows.map((r) => this.mapItem(r));
    if (order.orderType === 'main' && items.length > 0) {
      // 汇总视图要能看出这一行属于哪张子单
      const childNos = await this.db
        .select({ id: stockTakeOrder.id, takeNo: stockTakeOrder.takeNo })
        .from(stockTakeOrder)
        .where(inArray(stockTakeOrder.id, takeIds));
      const noMap = new Map(childNos.map((c) => [c.id, c.takeNo]));
      items.forEach((it, idx) => {
        (it as any).childTakeNo = noMap.get(rows[idx].takeId) ?? null;
      });
    }

    return { items, total, page, pageSize };
  }

  // ==================== 扫码盘点 ====================

  /** 扫描物料标签，自动核算账实差异 */
  async scanLabel(params: {
    id: string;
    qrContent: string;
    /** 当前作业库位：PDA 先扫库位再扫物料时传入，确保累加到本库位的账面行 */
    locationCode?: string;
    operatorId?: string;
    operatorName?: string;
    operatorRole?: string;
  }) {
    const { id, qrContent } = params;
    const order = await this.getOrderOrThrow(id);
    if (order.orderType === 'main') {
      throw new BadRequestException('主盘点单不直接扫码，请进入对应子盘点单扫码');
    }
    this.assertCanOperate(order, params.operatorRole);

    const parsed = this.parseLabel(qrContent);

    // 1) 校验物料
    const matRows = await this.db
      .select({ id: material.id, materialName: material.materialName, specification: material.specification, unit: material.unit, supplierCode: material.supplierCode })
      .from(material)
      .where(eq(material.materialCode, parsed.materialCode))
      .limit(1);
    const mat = matRows[0];
    if (!mat) {
      return {
        success: false,
        errorCode: 'unregistered_material',
        errorMessage: `非认可物料：料号 ${parsed.materialCode} 不在物料主数据中`,
        parsed,
      };
    }

    // 2) 校验供应商
    let sup: any = null;
    if (parsed.supplierCode) {
      const supRows = await this.db
        .select({ id: supplier.id, supplierCode: supplier.supplierCode, supplierName: supplier.supplierName })
        .from(supplier)
        .where(eq(supplier.supplierCode, parsed.supplierCode))
        .limit(1);
      sup = supRows[0] ?? null;
      if (!sup) {
        return {
          success: false,
          errorCode: 'unknown_supplier',
          errorMessage: `标签供应商代码 ${parsed.supplierCode} 不存在`,
          parsed,
        };
      }
    }

    // 3) 重码校验（同一盘点单内标签不可重复扫描）
    const dup = await this.db
      .select({ id: stockTakeItem.id, materialCode: stockTakeItem.materialCode })
      .from(stockTakeItem)
      .where(
        and(
          eq(stockTakeItem.takeId, id),
          sql`${stockTakeItem.scannedLabels} @> ${JSON.stringify([{ labelNo: parsed.raw }])}::jsonb`,
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      return {
        success: false,
        errorCode: 'duplicate_label',
        errorMessage: '该标签已在本盘点单中扫描过，请勿重复扫描',
        parsed,
      };
    }

    // 4) 定位目标盘点行
    let target: any = null;
    // 4.1 通过收料单二维码精确定位库位（同一箱的库位一致）
    const receiptRows = await this.db
      .select({
        locationId: receiptOrder.locationId,
        whId: warehouseLocation.warehouseId,
        whCode: warehouse.whCode,
        whName: warehouse.whNameZh,
      })
      .from(receiptOrder)
      .leftJoin(warehouseLocation, eq(receiptOrder.locationId, warehouseLocation.id))
      .leftJoin(warehouse, eq(warehouseLocation.warehouseId, warehouse.id))
      .where(eq(receiptOrder.qrContent, parsed.raw))
      .limit(1);
    const receiptLocationId = receiptRows[0]?.locationId ?? null;

    // 4.1.1 该箱库位若不在本盘点单仓库 → 拒绝（按仓库代码建单，防止串仓）
    if (receiptLocationId && order.warehouseId && receiptRows[0]?.whId && receiptRows[0].whId !== order.warehouseId) {
      return {
        success: false,
        errorCode: 'out_of_scope',
        errorMessage: `该箱库位属于 ${receiptRows[0].whCode ?? ''} ${receiptRows[0].whName ?? ''}，不属于本盘点单仓库 ${order.warehouseCode ?? ''} ${order.warehouseName ?? ''}`,
        parsed,
      };
    }

    const candidates = await this.db
      .select()
      .from(stockTakeItem)
      .where(
        and(
          eq(stockTakeItem.takeId, id),
          eq(stockTakeItem.materialCode, parsed.materialCode),
          parsed.batchNo ? eq(stockTakeItem.batchNo, parsed.batchNo) : sql`true`,
          order.warehouseId ? eq(stockTakeItem.warehouseId, order.warehouseId) : sql`true`,
        ),
      );

    // 指定作业库位时（PDA 先扫库位再扫物料），只认该库位的账面行：
    // 同一物料 + 批次可能分布在多个库位，不限定就会累加到别的库位、盘出假差异。
    let scopedLocationId: string | null = null;
    if (params.locationCode?.trim()) {
      const locRows = await this.db
        .select({ id: warehouseLocation.id, locationCode: warehouseLocation.locationCode })
        .from(warehouseLocation)
        .where(eq(warehouseLocation.locationCode, params.locationCode.trim()))
        .limit(1);
      if (locRows.length === 0) {
        return {
          success: false,
          errorCode: 'unknown_location',
          errorMessage: `库位码 ${params.locationCode} 不存在`,
          parsed,
        };
      }
      scopedLocationId = locRows[0].id;
      const atLoc = candidates.filter((c) => c.locationId === scopedLocationId);
      if (atLoc.length === 0) {
        return {
          success: false,
          errorCode: 'location_mismatch',
          errorMessage: `料号 ${parsed.materialCode} 批次 ${parsed.batchNo} 不在库位 ${locRows[0].locationCode} 的账面行中，请核对货物是否放错库位`,
          parsed,
        };
      }
      target = atLoc.find((c) => Number(c.actualQty) < Number(c.bookQty)) ?? atLoc[0];
    }

    if (!target && candidates.length > 0) {
      if (receiptLocationId) {
        target = candidates.find((c) => c.locationId === receiptLocationId) ?? null;
      }
      if (!target && sup) {
        const bySup = candidates.filter((c) => c.supplierId === sup.id || c.supplierCode === sup.supplierCode);
        if (bySup.length === 1) target = bySup[0];
        else if (bySup.length > 1) target = bySup.find((c) => Number(c.actualQty) < Number(c.bookQty)) ?? bySup[0];
      }
      if (!target) {
        target = candidates.find((c) => Number(c.actualQty) < Number(c.bookQty)) ?? candidates[0];
      }
    }

    // 4.2 本次盘点范围内无此物料行：若库存存在于范围外（其他仓库或库存状态不符），提示；否则记为盘盈
    if (!target) {
      const outRows = await this.db
        .select({
          id: inventory.id,
          stockStatus: inventory.stockStatus,
          whCode: warehouse.whCode,
          whName: warehouse.whNameZh,
        })
        .from(inventory)
        .leftJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
        .leftJoin(warehouse, eq(warehouseLocation.warehouseId, warehouse.id))
        .where(and(
          eq(inventory.materialId, mat.id),
          parsed.batchNo ? eq(inventory.batchNo, parsed.batchNo) : sql`true`,
        ));

      if (outRows.length > 0) {
        // 先看仓库是否相符（按仓库代码建单时，其他仓库的库存不可计入本单）
        const whMatched = order.warehouseId
          ? outRows.filter((r) => r.whCode === order.warehouseCode)
          : outRows;
        if (order.warehouseId && whMatched.length === 0) {
          const whDesc = Array.from(new Set(outRows.map((r) => `${r.whCode ?? ''} ${r.whName ?? ''}`.trim())))
            .filter(Boolean)
            .join('、');
          return {
            success: false,
            errorCode: 'out_of_scope',
            errorMessage: `该物料（料号 ${parsed.materialCode} 批次 ${parsed.batchNo}）库存位于 ${whDesc || '其他仓库'}，不属于本盘点单仓库 ${order.warehouseCode ?? ''} ${order.warehouseName ?? ''}`,
            parsed,
          };
        }
        // 仓库相符但库存状态不在盘点范围内
        const statusMatched = whMatched.filter((r) => SCOPE_STATUS[order.scope]?.includes(r.stockStatus));
        if (statusMatched.length === 0) {
          return {
            success: false,
            errorCode: 'out_of_scope',
            errorMessage: `该物料（料号 ${parsed.materialCode} 批次 ${parsed.batchNo}）库存状态为 ${whMatched[0].stockStatus}，不在本次盘点范围内`,
            parsed,
          };
        }
      }
    }

    const scanTime = new Date().toISOString();
    const entry: ScannedLabelEntry = {
      labelNo: parsed.raw,
      materialCode: parsed.materialCode,
      batchNo: parsed.batchNo,
      qty: parsed.quantity,
      scanTime,
      operatorName: params.operatorName,
    };

    let itemId: string;
    let isProfit = false;

    if (target) {
      // 5.1 账面有 → 累加实盘数量
      const actualQty = Number(target.actualQty) + parsed.quantity;
      const bookQty = Number(target.bookQty);
      const diffQty = actualQty - bookQty;
      await this.db.update(stockTakeItem).set({
        actualQty: String(actualQty),
        diffQty: String(diffQty),
        diffType: diffQty === 0 ? 'match' : diffQty > 0 ? 'profit' : 'loss',
        checked: true,
        scanCount: Number(target.scanCount ?? 0) + 1,
        scannedLabels: sql`COALESCE(${stockTakeItem.scannedLabels}, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb`,
        updatedAt: new Date(),
      }).where(eq(stockTakeItem.id, target.id));
      itemId = target.id;
    } else {
      // 5.2 账面没有 → 新建盘盈行（实物多于账面）
      isProfit = true;
      const locRow = receiptLocationId
        ? (await this.db
            .select({ id: warehouseLocation.id, locationCode: warehouseLocation.locationCode, warehouseId: warehouseLocation.warehouseId, whCode: warehouse.whCode, whName: warehouse.whNameZh })
            .from(warehouseLocation)
            .leftJoin(warehouse, eq(warehouseLocation.warehouseId, warehouse.id))
            .where(eq(warehouseLocation.id, receiptLocationId))
            .limit(1))[0]
        : null;
      const [created] = await this.db.insert(stockTakeItem).values({
        takeId: id,
        inventoryId: null,
        materialId: mat.id,
        materialCode: parsed.materialCode,
        materialName: mat.materialName,
        specification: mat.specification,
        unit: mat.unit || 'PCS',
        supplierId: sup?.id ?? null,
        supplierCode: sup?.supplierCode ?? parsed.supplierCode ?? null,
        supplierName: sup?.supplierName ?? null,
        locationId: locRow?.id ?? null,
        locationCode: locRow?.locationCode ?? null,
        warehouseId: order.warehouseId ?? locRow?.warehouseId ?? null,
        warehouseCode: order.warehouseCode ?? locRow?.whCode ?? null,
        warehouseName: order.warehouseName ?? locRow?.whName ?? null,
        stockStatus: SCOPE_STATUS[order.scope]?.[0] ?? 'good',
        batchNo: parsed.batchNo,
        labelNo: parsed.raw,
        productionDate: parsed.productionDate || null,
        bookQty: '0',
        actualQty: String(parsed.quantity),
        diffQty: String(parsed.quantity),
        diffType: 'profit',
        scannedLabels: [entry],
        scanCount: 1,
        checked: true,
      }).returning({ id: stockTakeItem.id });
      itemId = created.id;
    }

    const updated = await this.db.select().from(stockTakeItem).where(eq(stockTakeItem.id, itemId)).limit(1);
    await this.refreshSummary(id);
    await this.log(id, 'scan',
      isProfit
        ? `扫描标签「${parsed.raw}」，账面无此箱 → 盘盈 ${parsed.quantity} ${mat.unit || ''}`
        : `扫描标签「${parsed.raw}」，料号 ${parsed.materialCode} 批次 ${parsed.batchNo} 实盘 +${parsed.quantity}`,
      params.operatorId, params.operatorName, itemId);

    const item = this.mapItem(updated[0]);
    return {
      success: true,
      isProfit,
      message: isProfit
        ? `账面无此箱，已记为盘盈 +${parsed.quantity}`
        : (item.diffQty === 0 ? '账实一致' : item.diffQty > 0 ? `账实不符：盘盈 ${item.diffQty}` : `账实不符：盘亏 ${item.diffQty}`),
      item,
      parsed,
    };
  }

  /** 手工录入实盘数量（无法扫码时的补充手段） */
  async adjustItem(params: {
    id: string;
    itemId: string;
    actualQty: number;
    remark?: string;
    operatorId?: string;
    operatorName?: string;
    operatorRole?: string;
  }) {
    const order = await this.getOrderOrThrow(params.id);
    if (order.orderType === 'main') {
      throw new BadRequestException('主盘点单不含明细，请进入子盘点单录入实盘数');
    }
    this.assertCanOperate(order, params.operatorRole);
    if (!Number.isFinite(params.actualQty) || params.actualQty < 0) {
      throw new BadRequestException('实盘数量必须为不小于 0 的数字');
    }
    const rows = await this.db
      .select()
      .from(stockTakeItem)
      .where(and(eq(stockTakeItem.id, params.itemId), eq(stockTakeItem.takeId, params.id)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('盘点明细不存在');
    const item = rows[0];
    const bookQty = Number(item.bookQty);
    const diffQty = params.actualQty - bookQty;

    await this.db.update(stockTakeItem).set({
      actualQty: String(params.actualQty),
      diffQty: String(diffQty),
      diffType: diffQty === 0 ? 'match' : diffQty > 0 ? 'profit' : 'loss',
      checked: true,
      remark: params.remark ?? item.remark,
      updatedAt: new Date(),
    }).where(eq(stockTakeItem.id, params.itemId));

    await this.refreshSummary(params.id);
    await this.log(params.id, 'adjust',
      `手工录入实盘数：${item.materialCode} 批次 ${item.batchNo ?? '-'} 账面 ${bookQty} → 实盘 ${params.actualQty}（差异 ${diffQty >= 0 ? '+' : ''}${diffQty}）`,
      params.operatorId, params.operatorName, params.itemId);

    const updated = await this.db.select().from(stockTakeItem).where(eq(stockTakeItem.id, params.itemId)).limit(1);
    return this.mapItem(updated[0]);
  }

  /** 确认账面有、实物无（判为盘亏） */
  async confirmMissing(params: {
    id: string;
    itemId: string;
    remark?: string;
    operatorId?: string;
    operatorName?: string;
    operatorRole?: string;
  }) {
    const order = await this.getOrderOrThrow(params.id);
    this.assertCanOperate(order, params.operatorRole);
    const rows = await this.db
      .select()
      .from(stockTakeItem)
      .where(and(eq(stockTakeItem.id, params.itemId), eq(stockTakeItem.takeId, params.id)))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('盘点明细不存在');
    const item = rows[0];
    const bookQty = Number(item.bookQty);
    const actualQty = Number(item.actualQty);
    const diffQty = actualQty - bookQty;

    await this.db.update(stockTakeItem).set({
      checked: true,
      diffQty: String(diffQty),
      diffType: diffQty === 0 ? 'match' : diffQty > 0 ? 'profit' : 'loss',
      remark: params.remark ?? item.remark,
      updatedAt: new Date(),
    }).where(eq(stockTakeItem.id, params.itemId));

    await this.refreshSummary(params.id);
    await this.log(params.id, 'confirm_missing',
      `确认实物数量：${item.materialCode} 批次 ${item.batchNo ?? '-'} 账面 ${bookQty} / 实盘 ${actualQty}（差异 ${diffQty >= 0 ? '+' : ''}${diffQty}）`,
      params.operatorId, params.operatorName, params.itemId);

    const updated = await this.db.select().from(stockTakeItem).where(eq(stockTakeItem.id, params.itemId)).limit(1);
    return this.mapItem(updated[0]);
  }

  // ==================== 提交 / 审批 / 授权 ====================

  /** 提交仓库主管审批：未盘点的账面行自动判定为盘亏 */
  async submitTake(params: { id: string; operatorId?: string; operatorName?: string; operatorRole?: string; remark?: string }) {
    const order = await this.getOrderOrThrow(params.id);
    if (order.orderType === 'main') {
      throw new BadRequestException('主盘点单不含明细，请在子盘点单中盘点并提交，再由仓库主管确认盈亏');
    }
    if (params.operatorRole && !OPERATE_ROLES.includes(params.operatorRole)) {
      throw new ForbiddenException('仅仓管员 / 仓库主管可提交盘点单');
    }
    if (order.status === 'pending_approval') throw new BadRequestException('盘点单已提交，等待审批');
    if (order.status === 'approved') throw new BadRequestException('盘点单已批准，如需修改请先由系统管理员授权');
    if (order.status === 'cancelled') throw new BadRequestException('盘点单已取消');

    const statRows = await this.db
      .select({
        total: sql<string>`COUNT(*)`,
        checked: sql<string>`COUNT(*) FILTER (WHERE ${stockTakeItem.checked} = true)`,
      })
      .from(stockTakeItem)
      .where(eq(stockTakeItem.takeId, params.id));
    const total = Number(statRows[0]?.total ?? 0);
    const checked = Number(statRows[0]?.checked ?? 0);
    if (total === 0) throw new BadRequestException('盘点单没有明细，无法提交');
    if (checked === 0) throw new BadRequestException('尚未扫码盘点任何物料，无法提交');

    // 未盘点的账面行 → 账有实无，判为盘亏
    await this.db.execute(sql`
      UPDATE stock_take_item
      SET checked = true,
          diff_qty = actual_qty - book_qty,
          diff_type = CASE
            WHEN actual_qty - book_qty = 0 THEN 'match'
            WHEN actual_qty - book_qty > 0 THEN 'profit'
            ELSE 'loss' END,
          _updated_at = CURRENT_TIMESTAMP
      WHERE take_id = ${params.id} AND checked = false
    `);

    await this.refreshSummary(params.id);
    // CAS：并发提交时只有第一个请求能把 draft → pending_approval，
    // 其余请求的 UPDATE 影响 0 行 → 抛 409，避免重复写 submit 日志（BUG-016 同类）。
    const casRows = (await this.db
      .update(stockTakeOrder)
      .set({
        status: 'pending_approval',
        submitTime: new Date(),
        remark: params.remark ?? order.remark,
        approvalRemark: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(stockTakeOrder.id, params.id),
        eq(stockTakeOrder.status, 'draft'),
      ))
      .returning({ id: stockTakeOrder.id })) as Array<{ id: string }>;

    if (casRows.length === 0) {
      throw new ConflictException('该盘点单已提交或状态已变更，请刷新后重试');
    }

    await this.log(params.id, 'submit',
      `提交审批（应盘 ${total} 行，已盘 ${checked} 行，未盘行按盘亏处理）`,
      params.operatorId, params.operatorName);

    const updated = await this.getOrderOrThrow(params.id);
    return this.mapOrder(updated);
  }

  /** 仓库主管审批：pass=true 批准归档，false 驳回 */
  async approveTake(params: {
    id: string;
    pass: boolean;
    approvalRemark?: string;
    approverId?: string;
    approverName?: string;
    approverRole?: string;
  }) {
    const order = await this.getOrderOrThrow(params.id);
    if (params.approverRole && !APPROVE_ROLES.includes(params.approverRole)) {
      throw new ForbiddenException('仅仓库主管可审批盘点单');
    }
    if (order.status !== 'pending_approval') {
      throw new BadRequestException(`当前状态（${order.status}）不可审批`);
    }

    await this.refreshSummary(params.id);
    // CAS：并发审批时只有第一个请求能把 pending_approval → approved/rejected，
    // 其余请求的 UPDATE 影响 0 行 → 抛 409，避免重复写 approve 日志（BUG-016 同类）。
    const casRows = (await this.db
      .update(stockTakeOrder)
      .set({
        status: params.pass ? 'approved' : 'rejected',
        approverId: params.approverId || null,
        approverName: params.approverName || null,
        approvalTime: new Date(),
        approvalRemark: params.approvalRemark ?? null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(stockTakeOrder.id, params.id),
        eq(stockTakeOrder.status, 'pending_approval'),
      ))
      .returning({ id: stockTakeOrder.id })) as Array<{ id: string }>;

    if (casRows.length === 0) {
      throw new ConflictException('该盘点单已被审批或状态已变更，请刷新后重试');
    }

    await this.log(params.id, params.pass ? 'approve' : 'reject',
      `${params.pass ? '批准' : '驳回'}盘点单${params.approvalRemark ? '：' + params.approvalRemark : ''}`,
      params.approverId, params.approverName);

    const updated = await this.getOrderOrThrow(params.id);
    // 子单审批后回刷主单汇总，主单页面无需手动刷新也能看到最新盈亏
    if (order.parentId) await this.refreshMainSummary(order.parentId);
    return this.mapOrder(updated);
  }

  /** 系统管理员授权修改已批准的盘点单 */
  async unlockTake(params: {
    id: string;
    reason: string;
    operatorId?: string;
    operatorName?: string;
    operatorRole?: string;
  }) {
    const order = await this.getOrderOrThrow(params.id);
    if (params.operatorRole && !UNLOCK_ROLES.includes(params.operatorRole)) {
      throw new ForbiddenException('仅系统管理员可授权修改已批准的盘点单');
    }
    if (order.status !== 'approved') {
      throw new BadRequestException('仅已批准的盘点单需要授权修改');
    }
    if (!params.reason || !params.reason.trim()) {
      throw new BadRequestException('请填写授权修改原因（留痕可追溯）');
    }

    await this.db.update(stockTakeOrder).set({
      status: 'draft',
      unlockAuthorizedBy: params.operatorId || null,
      unlockAuthorizedName: params.operatorName || null,
      unlockAuthorizedAt: new Date(),
      unlockReason: params.reason.trim(),
      revisionCount: Number(order.revisionCount ?? 0) + 1,
      updatedAt: new Date(),
    }).where(eq(stockTakeOrder.id, params.id));

    await this.log(params.id, 'unlock',
      `系统管理员授权修改（第 ${Number(order.revisionCount ?? 0) + 1} 次）：${params.reason.trim()}`,
      params.operatorId, params.operatorName);

    const updated = await this.getOrderOrThrow(params.id);
    return this.mapOrder(updated);
  }

  async cancelTake(params: { id: string; operatorId?: string; operatorName?: string; operatorRole?: string }) {
    const order = await this.getOrderOrThrow(params.id);
    if (params.operatorRole && !OPERATE_ROLES.includes(params.operatorRole)) {
      throw new ForbiddenException('仅仓管员可取消盘点单');
    }
    if (order.status === 'approved') throw new BadRequestException('已批准的盘点单不可取消，如需调整请由系统管理员授权修改');
    if (order.status === 'cancelled') throw new BadRequestException('盘点单已取消');

    // 主单取消：子单必须都还没提交，否则先处理子单
    if (order.orderType === 'main') {
      const children = await this.db
        .select({ takeNo: stockTakeOrder.takeNo, status: stockTakeOrder.status })
        .from(stockTakeOrder)
        .where(eq(stockTakeOrder.parentId, order.id));
      const locked = children.filter((c) => ['pending_approval', 'approved'].includes(c.status));
      if (locked.length > 0) {
        throw new BadRequestException(
          `子盘点单 ${locked.map((c) => c.takeNo).join('、')} 已提交或已批准，不能直接取消主单`,
        );
      }
      await this.db.update(stockTakeOrder)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(
          eq(stockTakeOrder.parentId, order.id),
          sql`${stockTakeOrder.status} <> 'cancelled'`,
        ));
    }

    // BUG-020 修复：状态流转改为 CAS，避免并发取消全部成功、产生多条重复审计日志。
    // 原实现「事务外读状态 → 无条件 UPDATE」，5 次并发取消会写 5 条 cancel 日志。
    const casRows = (await this.db
      .update(stockTakeOrder)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(stockTakeOrder.id, params.id),
        sql`${stockTakeOrder.status} <> 'cancelled'`,
        sql`${stockTakeOrder.status} <> 'approved'`,
      ))
      .returning({ id: stockTakeOrder.id })) as Array<{ id: string }>;

    if (casRows.length === 0) {
      throw new ConflictException('该盘点单状态已变更，请刷新后重试');
    }

    await this.log(params.id, 'cancel', '取消盘点单', params.operatorId, params.operatorName);
    const updated = await this.getOrderOrThrow(params.id);
    return this.mapOrder(updated);
  }

  /** 删除盘点单（仅已取消状态可删；明细与操作日志一并清除） */
  async deleteTake(params: { id: string; operatorId?: string; operatorName?: string; operatorRole?: string }) {
    const order = await this.getOrderOrThrow(params.id);
    if (params.operatorRole && !OPERATE_ROLES.includes(params.operatorRole)) {
      throw new ForbiddenException('仅仓管员可删除盘点单');
    }
    if (order.status !== 'cancelled') {
      throw new BadRequestException('仅已取消的盘点单可删除，如需作废请先取消');
    }
    if (order.orderType === 'main') {
      const childCount = await this.db
        .select({ c: count() })
        .from(stockTakeOrder)
        .where(eq(stockTakeOrder.parentId, order.id));
      if (Number(childCount[0]?.c ?? 0) > 0) {
        throw new BadRequestException('主盘点单下还有子盘点单，请先删除子单（子单需先取消）');
      }
    }
    // 依次删除：操作日志 → 盘点明细 → 盘点单（即使外键未配置级联也安全）
    await this.db.delete(stockTakeLog).where(eq(stockTakeLog.takeId, params.id));
    await this.db.delete(stockTakeItem).where(eq(stockTakeItem.takeId, params.id));
    await this.db.delete(stockTakeOrder).where(eq(stockTakeOrder.id, params.id));
    return { deleted: true, takeNo: order.takeNo };
  }

  // ==================== 报表 / 日志 ====================

  /** 盘点报表：汇总 + 按仓库/供应商/物料分组 + 盘盈盘亏明细 */
  async getReport(id: string) {
    const order = await this.getOrderOrThrow(id);
    // 主盘点单的报表由子单明细汇总而来
    const takeIds = await this.resolveItemTakeIds(order);
    if (takeIds.length === 0) {
      return { order: this.mapOrder(order), byWarehouse: [], bySupplier: [], diffItems: [] };
    }

    const byWarehouse = await this.db
      .select({
        stockStatus: stockTakeItem.stockStatus,
        warehouseCode: stockTakeItem.warehouseCode,
        warehouseName: stockTakeItem.warehouseName,
        lines: sql<string>`COUNT(*)`,
        profitLines: sql<string>`COUNT(*) FILTER (WHERE ${stockTakeItem.diffType} = 'profit')`,
        lossLines: sql<string>`COUNT(*) FILTER (WHERE ${stockTakeItem.diffType} = 'loss')`,
        bookQty: sql<string>`COALESCE(SUM(${stockTakeItem.bookQty}),0)`,
        actualQty: sql<string>`COALESCE(SUM(${stockTakeItem.actualQty}),0)`,
        diffQty: sql<string>`COALESCE(SUM(${stockTakeItem.actualQty} - ${stockTakeItem.bookQty}),0)`,
      })
      .from(stockTakeItem)
      .where(inArray(stockTakeItem.takeId, takeIds))
      .groupBy(stockTakeItem.stockStatus, stockTakeItem.warehouseCode, stockTakeItem.warehouseName);

    const bySupplier = await this.db
      .select({
        supplierCode: stockTakeItem.supplierCode,
        supplierName: stockTakeItem.supplierName,
        lines: sql<string>`COUNT(*)`,
        profitLines: sql<string>`COUNT(*) FILTER (WHERE ${stockTakeItem.diffType} = 'profit')`,
        lossLines: sql<string>`COUNT(*) FILTER (WHERE ${stockTakeItem.diffType} = 'loss')`,
        bookQty: sql<string>`COALESCE(SUM(${stockTakeItem.bookQty}),0)`,
        actualQty: sql<string>`COALESCE(SUM(${stockTakeItem.actualQty}),0)`,
        diffQty: sql<string>`COALESCE(SUM(${stockTakeItem.actualQty} - ${stockTakeItem.bookQty}),0)`,
      })
      .from(stockTakeItem)
      .where(inArray(stockTakeItem.takeId, takeIds))
      .groupBy(stockTakeItem.supplierCode, stockTakeItem.supplierName)
      .orderBy(sql`ABS(SUM(${stockTakeItem.actualQty} - ${stockTakeItem.bookQty})) DESC`)
      .limit(50);

    const diffItems = await this.db
      .select()
      .from(stockTakeItem)
      .where(and(inArray(stockTakeItem.takeId, takeIds), sql`${stockTakeItem.diffType} IN ('profit','loss')`))
      .orderBy(
        sql`CASE ${stockTakeItem.diffType} WHEN 'profit' THEN 0 ELSE 1 END`,
        sql`ABS(${stockTakeItem.actualQty} - ${stockTakeItem.bookQty}) DESC`,
      )
      .limit(500);

    const num = (v: any) => Number(v ?? 0);
    return {
      order: this.mapOrder(order),
      byWarehouse: byWarehouse.map((r) => ({
        stockStatus: r.stockStatus,
        warehouseCode: r.warehouseCode,
        warehouseName: r.warehouseName,
        lines: num(r.lines), profitLines: num(r.profitLines), lossLines: num(r.lossLines),
        bookQty: num(r.bookQty), actualQty: num(r.actualQty), diffQty: num(r.diffQty),
      })),
      bySupplier: bySupplier.map((r) => ({
        supplierCode: r.supplierCode, supplierName: r.supplierName,
        lines: num(r.lines), profitLines: num(r.profitLines), lossLines: num(r.lossLines),
        bookQty: num(r.bookQty), actualQty: num(r.actualQty), diffQty: num(r.diffQty),
      })),
      diffItems: diffItems.map((r) => this.mapItem(r)),
    };
  }

  async getLogs(id: string) {
    await this.getOrderOrThrow(id);
    const rows = await this.db
      .select()
      .from(stockTakeLog)
      .where(eq(stockTakeLog.takeId, id))
      .orderBy(desc(stockTakeLog.createdAt));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      detail: r.detail ?? undefined,
      operatorName: r.operatorName ?? undefined,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : undefined,
    }));
  }
}
