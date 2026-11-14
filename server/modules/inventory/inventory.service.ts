import { Inject, Injectable, BadRequestException, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, ilike, gte, lt, desc, asc, count, sql, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  inventory,
  inventoryTransaction,
  material,
  warehouseLocation,
  supplier,
  stockTransfer,
  warehouse,
  iqcLot,
  materialExpiryExtension,
} from '@server/database/schema';
import type { Inventory, StockTransfer, PaginatedResponse, ExpiryInventory, ExpiryReinspectionResult } from '@shared/api.interface';
import { casUpdate, lockRow, requireUuid } from '../../common/utils/cas.util';
import { INVENTORY_STOCK_CONFLICT_TARGET } from '../../common/db/inventory-conflict';
import { MRB_OTHER_LIKE_PATTERN, MRB_LOCK_LIKE_PATTERN, MRB_LOCK_PREFIX } from '../mrb/mrb.status';

/** 既可用于 db 也可用于事务 tx 的通用执行器类型（避免 Drizzle 事务泛型在调用点摩擦） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbExecutor = any;

interface ScannedMoveItem {
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
}

interface SourceVerifyResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
  locationId?: string;
  locationCode?: string;
  warehouseId?: string;
  whCode?: string;
  items?: ScannedMoveItem[];
  failedItems?: Array<{ materialCode: string; batchNo: string; serialNo: string; reason: string }>;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getInventoryList(params: {
    page: number;
    pageSize: number;
    materialCode?: string;
    locationId?: string;
    locationCode?: string;
    batchNo?: string;
    warehouseId?: string;
    stockStatus?: string;
    /** 效期筛选：expired=已超期；warning=超期预警（30 天内到期）。与 stockStatus 互斥使用 */
    expiryStatus?: string;
    /** 仅看特采（'1' 生效） */
    specialAdmitOnly?: string | boolean;
  }): Promise<PaginatedResponse<Inventory>> {
    const {
      page,
      pageSize,
      materialCode,
      locationId,
      locationCode,
      batchNo,
      warehouseId,
      stockStatus,
      expiryStatus,
      specialAdmitOnly,
    } = params;
    const offset = (page - 1) * pageSize;

    /**
     * 有效期口径（与列表展示列、超期扫描完全一致）：延期记录优先，其次「生产日期 + 物料有效期天数」。
     * 这里同时定义 SQL 表达式，供 SELECT 列与 WHERE 条件共用，避免两边算出口径不一致。
     */
    const expiryDateExpr = sql<string>`
      CASE
        WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date::text
        WHEN ${material.expiryDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
          THEN (${inventory.productionDate} + (${material.expiryDays} || ' days')::interval)::date::text
        ELSE NULL
      END
    `;
    const remainingDaysExpr = sql<number>`
      (
        CASE
          WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date
          WHEN ${material.expiryDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
            THEN (${inventory.productionDate} + (${material.expiryDays} || ' days')::interval)::date
          ELSE NULL
        END
      ) - CURRENT_DATE
    `;
    /** 每个 (物料,批次,库位) 的最新延期记录；列表查询与计数查询都要挂，否则效期条件在 count 里会缺列 */
    const extSubquery = sql`(
      SELECT DISTINCT ON (material_id, batch_no, location_id)
        material_id, batch_no, location_id, new_expiry_date
      FROM material_expiry_extension
      ORDER BY material_id, batch_no, location_id, _created_at DESC
    ) ext`;
    const extJoinOn = and(
      sql`ext.material_id = ${inventory.materialId}`,
      sql`ext.batch_no = ${inventory.batchNo}`,
      sql`ext.location_id = ${inventory.locationId}`,
    );

    const conditions = [];
    if (materialCode) conditions.push(ilike(material.materialCode, `%${materialCode}%`));
    if (locationId) conditions.push(eq(inventory.locationId, locationId));
    if (locationCode) conditions.push(ilike(warehouseLocation.locationCode, `%${locationCode}%`));
    if (batchNo) conditions.push(ilike(inventory.batchNo, `%${batchNo}%`));
    if (warehouseId) conditions.push(eq(warehouseLocation.warehouseId, warehouseId));

    /**
     * 库存状态筛选。
     * 'locked' / 'pending' 并不是 stock_status 列里的取值（库里只有 good / pending_qc / defective），
     * 之前直接 `stock_status = 'locked'` 永远匹配不到行 —— 界面上选「已锁定」就是一张空表，
     * 而库存里确实有 locked=true 的行。改为按 locked 布尔 + 锁定原因筛选：
     *  - locked  → 所有被锁定的行（超期复检中 / IQC待检 / MRB 待评审…）
     *  - pending → 仅「IQC 待检」这类锁定（与列表里「待检」徽章的判定口径一致）
     */
    const statusToken = String(stockStatus || '').trim();
    if (statusToken === 'locked') {
      conditions.push(eq(inventory.locked, true));
    } else if (statusToken === 'pending') {
      conditions.push(eq(inventory.locked, true));
      conditions.push(ilike(inventory.lockReason, '%待检%'));
    } else if (statusToken) {
      conditions.push(eq(inventory.stockStatus, statusToken));
    }

    /**
     * 效期筛选：查「已超期 / 30 天内到期且尚未处理」的物料。
     * 「已处理」= 延期后新有效期已不在超期/预警区间内（延期会改写 ext.new_expiry_date，
     * 所以延过期的批次自然从这两个选项里消失），无需额外标记位。
     */
    const expiryToken = String(expiryStatus || '').trim();
    if (expiryToken === 'expired' || expiryToken === 'warning') {
      conditions.push(sql`${expiryDateExpr} IS NOT NULL`);
      if (expiryToken === 'expired') {
        conditions.push(sql`${remainingDaysExpr} <= 0`);
      } else {
        conditions.push(sql`${remainingDaysExpr} > 0`);
        conditions.push(sql`${remainingDaysExpr} <= 30`);
      }
    }

    // 仅看特采：只做查询筛选，不参与任何发料/库存语义
    if (specialAdmitOnly === '1' || specialAdmitOnly === true) {
      conditions.push(eq(inventory.isSpecialAdmit, true));
    }

    const baseQuery = this.db
      .select({
        id: inventory.id,
        materialId: inventory.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        locationId: inventory.locationId,
        locationCode: warehouseLocation.locationCode,
        batchNo: inventory.batchNo,
        supplierId: inventory.supplierId,
        supplierName: supplier.supplierName,
        quantity: inventory.quantity,
        unit: inventory.unit,
        stockStatus: inventory.stockStatus,
        productionDate: inventory.productionDate,
        locked: inventory.locked,
        lockReason: inventory.lockReason,
        // 特采标记 + 关联 MRB 单号（帮助文档「特采放行后续影响」承诺的可查字段）
        isSpecialAdmit: inventory.isSpecialAdmit,
        specialAdmitRef: inventory.specialAdmitRef,
        expiryDate: sql<string>`${expiryDateExpr}`.as('expiry_date'),
      })
      .from(inventory)
      .innerJoin(material, eq(inventory.materialId, material.id))
      .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
      .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
      .leftJoin(extSubquery, extJoinOn);

    const whereQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const [totalResult, items] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(inventory)
        .innerJoin(material, eq(inventory.materialId, material.id))
        .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
        .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
        .leftJoin(extSubquery, extJoinOn)
        .where(conditions.length > 0 ? and(...conditions) : undefined),
      whereQuery
        .orderBy(desc(inventory.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        productionDate: item.productionDate ?? undefined,
        expiryDate: item.expiryDate ?? undefined,
        isSpecialAdmit: !!item.isSpecialAdmit,
        specialAdmitRef: item.specialAdmitRef ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getExpiryInventory(params: {
    type: 'warning' | 'expired';
    page: number;
    pageSize: number;
    materialCode?: string;
  }): Promise<PaginatedResponse<ExpiryInventory>> {
    const { type, page, pageSize, materialCode } = params;
    const offset = (page - 1) * pageSize;

    const expiryDateExpr = sql<string>`
      CASE
        WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date
        WHEN ${material.expiryDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
          THEN (${inventory.productionDate} + (${material.expiryDays} || ' days')::interval)::date
        ELSE NULL
      END
    `;

    const remainingDaysSql = sql<number>`
      (${expiryDateExpr} - CURRENT_DATE)::integer
    `;

    const conditions = [
      // F-11：待检库存(pending_qc)也是物理在库、也有有效期，必须纳入超期/预警统计，否则账面少货
      inArray(inventory.stockStatus, ['good', 'pending_qc']),
      sql`${expiryDateExpr} IS NOT NULL`,
      type === 'warning'
        ? sql`${remainingDaysSql} > 0 AND ${remainingDaysSql} <= 30`
        : sql`${remainingDaysSql} <= 0`,
    ];
    if (materialCode) conditions.push(ilike(material.materialCode, `%${materialCode}%`));

    const selectFields = {
      id: inventory.id,
      materialId: inventory.materialId,
      materialCode: material.materialCode,
      materialName: material.materialName,
      locationId: inventory.locationId,
      locationCode: warehouseLocation.locationCode,
      batchNo: inventory.batchNo,
      productionDate: inventory.productionDate,
      expiryDate: sql<string>`${expiryDateExpr}::text`.as('expiry_date'),
      remainingDays: sql<number>`${remainingDaysSql}`.as('remaining_days'),
      quantity: inventory.quantity,
      unit: inventory.unit,
      stockStatus: inventory.stockStatus,
      locked: inventory.locked,
      lockReason: inventory.lockReason,
      supplierName: supplier.supplierName,
    };

    const baseQuery = this.db
      .select(selectFields)
      .from(inventory)
      .innerJoin(material, eq(inventory.materialId, material.id))
      .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
      .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
      .leftJoin(
        sql`(
          SELECT DISTINCT ON (material_id, batch_no, location_id)
            material_id, batch_no, location_id, new_expiry_date
          FROM material_expiry_extension
          ORDER BY material_id, batch_no, location_id, _created_at DESC
        ) ext`,
        and(
          sql`ext.material_id = ${inventory.materialId}`,
          sql`ext.batch_no = ${inventory.batchNo}`,
          sql`ext.location_id = ${inventory.locationId}`,
        ),
      )
      .where(and(...conditions));

    const [totalResult, items] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(inventory)
        .innerJoin(material, eq(inventory.materialId, material.id))
        .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
        .leftJoin(
          sql`(
            SELECT DISTINCT ON (material_id, batch_no, location_id)
              material_id, batch_no, location_id, new_expiry_date
            FROM material_expiry_extension
            ORDER BY material_id, batch_no, location_id, _created_at DESC
          ) ext`,
          and(
            sql`ext.material_id = ${inventory.materialId}`,
            sql`ext.batch_no = ${inventory.batchNo}`,
            sql`ext.location_id = ${inventory.locationId}`,
          ),
        )
        .where(and(...conditions)),
      baseQuery
        .orderBy(asc(remainingDaysSql))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        remainingDays: Number(item.remainingDays),
        productionDate: item.productionDate ?? undefined,
        batchNo: item.batchNo ?? undefined,
        supplierName: item.supplierName ?? undefined,
        lockReason: item.lockReason ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 查询某物料（**限定物理批次**）在良品仓中「超期 / 预警（30 天内到期）」的库存明细。
   * 用途：IQC 检验时，若该批次同时存在超期库存，直接在检验页面处置（维护新有效期）。
   *
   * 为什么必须按批次过滤：同一物料常有多批同时在库（例如贴片电阻一次来三批），
   * 若只按 materialId 查，检验单只有 5000 却会把另外两批 20000 一起带到处置表里，
   * 检验员既容易延错批次，也和「判定合格前校验」的批次口径（assertExpiryExtendedBeforePass）
   * 不一致。批次入参带 `-Rxx` 复检后缀时先归一成物理批次再匹配。
   */
  async getMaterialExpiryStock(materialId: string, batchNo?: string): Promise<ExpiryInventory[]> {
    if (!materialId) return [];
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(materialId)) return [];

    /** 检验批次的批次号可能带 -R01 复检后缀，库存里存的是物理批次 */
    const physicalBatch = String(batchNo || '').trim().replace(/-R\d+$/i, '');

    const expiryDateExpr = sql<string>`
      CASE
        WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date
        WHEN ${material.expiryDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
          THEN (${inventory.productionDate} + (${material.expiryDays} || ' days')::interval)::date
        ELSE NULL
      END
    `;
    const remainingDaysSql = sql<number>`(${expiryDateExpr} - CURRENT_DATE)::integer`;
    const scrapDateExpr = sql<string>`
      CASE
        WHEN ${material.forceScrapDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
          THEN (${inventory.productionDate} + (${material.forceScrapDays} || ' days')::interval)::date
        ELSE NULL
      END
    `;

    const items = await this.db
      .select({
        id: inventory.id,
        materialId: inventory.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        locationId: inventory.locationId,
        locationCode: warehouseLocation.locationCode,
        batchNo: inventory.batchNo,
        productionDate: inventory.productionDate,
        expiryDate: sql<string>`${expiryDateExpr}::text`.as('expiry_date'),
        remainingDays: sql<number>`${remainingDaysSql}`.as('remaining_days'),
        forceScrapDays: material.forceScrapDays,
        scrapDate: sql<string>`${scrapDateExpr}::text`.as('scrap_date'),
        quantity: inventory.quantity,
        unit: inventory.unit,
        stockStatus: inventory.stockStatus,
        locked: inventory.locked,
        lockReason: inventory.lockReason,
        supplierName: supplier.supplierName,
      })
      .from(inventory)
      .innerJoin(material, eq(inventory.materialId, material.id))
      .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
      .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
      .leftJoin(
        sql`(
          SELECT DISTINCT ON (material_id, batch_no, location_id)
            material_id, batch_no, location_id, new_expiry_date
          FROM material_expiry_extension
          ORDER BY material_id, batch_no, location_id, _created_at DESC
        ) ext`,
        and(
          sql`ext.material_id = ${inventory.materialId}`,
          sql`ext.batch_no = ${inventory.batchNo}`,
          sql`ext.location_id = ${inventory.locationId}`,
        ),
      )
      .where(
        and(
          eq(inventory.materialId, materialId),
          // 未传批次号时保持旧口径（整个物料），传了就严格限定该物理批次
          physicalBatch ? eq(inventory.batchNo, physicalBatch) : undefined,
          eq(inventory.stockStatus, 'good'),
          sql`${expiryDateExpr} IS NOT NULL`,
          sql`${remainingDaysSql} <= 30`,
        ),
      )
      .orderBy(asc(remainingDaysSql));

    return items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
      remainingDays: Number(item.remainingDays),
      forceScrapDays: item.forceScrapDays ?? null,
      scrapDate: item.scrapDate ? String(item.scrapDate).slice(0, 10) : null,
      productionDate: item.productionDate ?? undefined,
      batchNo: item.batchNo ?? undefined,
      supplierName: item.supplierName ?? undefined,
      lockReason: item.lockReason ?? undefined,
    })) as ExpiryInventory[];
  }

  async submitExpiryReinspection(params: {
    inventoryIds: string[];
    operatorId: string;
    operatorName: string;
  }): Promise<ExpiryReinspectionResult> {
    const { inventoryIds, operatorId } = params;

    if (!inventoryIds || inventoryIds.length === 0) {
      throw new BadRequestException('库存ID列表不能为空');
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidIds = inventoryIds.filter((id: string) => !UUID_REGEX.test(id));
    if (invalidIds.length > 0) {
      throw new BadRequestException(`无效的库存ID格式: ${invalidIds.join(', ')}`);
    }

    const result = await this.db.transaction(async (tx) => {
      // 1. 查询所有库存并验证是超期状态
      const expiryDateExpr = sql<string>`
        CASE
          WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date
          WHEN ${material.expiryDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
            THEN (${inventory.productionDate} + (${material.expiryDays} || ' days')::interval)::date
          ELSE NULL
        END
      `;

      const invList = await tx
        .select({
          id: inventory.id,
          materialId: inventory.materialId,
          supplierId: inventory.supplierId,
          quantity: inventory.quantity,
          unit: inventory.unit,
          productionDate: inventory.productionDate,
          batchNo: inventory.batchNo,
          locationId: inventory.locationId,
          locationCode: warehouseLocation.locationCode,
          stockStatus: inventory.stockStatus,
          locked: inventory.locked,
          expiryDate: expiryDateExpr,
          remainingDays: sql<number>`(${expiryDateExpr} - CURRENT_DATE)::integer`.as('remaining_days'),
        })
        .from(inventory)
        .innerJoin(material, eq(inventory.materialId, material.id))
        .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
        .leftJoin(
          sql`(
            SELECT DISTINCT ON (material_id, batch_no, location_id)
              material_id, batch_no, location_id, new_expiry_date
            FROM material_expiry_extension
            ORDER BY material_id, batch_no, location_id, _created_at DESC
          ) ext`,
          and(
            sql`ext.material_id = ${inventory.materialId}`,
            sql`ext.batch_no = ${inventory.batchNo}`,
            sql`ext.location_id = ${inventory.locationId}`,
          ),
        )
        .where(inArray(inventory.id, inventoryIds));

      if (invList.length !== inventoryIds.length) {
        const foundIds = new Set(invList.map((i: { id: string }) => i.id));
        const missingIds = inventoryIds.filter((id: string) => !foundIds.has(id));
        throw new NotFoundException(`库存记录不存在: ${missingIds.join(', ')}`);
      }

      // 校验：超期（剩余天数 <= 0）与预警期（30天内将到期）物料均可提交复检，含不良品仓库存
      const reinspectItems = invList.filter(
        (i: { remainingDays: number }) => Number(i.remainingDays) <= 30,
      );

      if (reinspectItems.length === 0) {
        throw new BadRequestException('所选库存均不在超期或预警期（30天内），无法报检');
      }

      // 校验：同一批次不允许重复报检（已存在进行中的复检待检批次）
      for (const inv of reinspectItems) {
        if (!inv.batchNo) continue;
        const dup = await tx
          .select({ lotNo: iqcLot.lotNo })
          .from(iqcLot)
          .where(
            and(
              eq(iqcLot.materialId, inv.materialId),
              sql`${iqcLot.batchNo} LIKE ${inv.batchNo + '-R%'}`,
              eq(iqcLot.status, 'pending'),
            ),
          )
          .limit(1);
        if (dup.length > 0) {
          throw new BadRequestException(`批次 ${inv.batchNo} 已有进行中的复检报检（${dup[0].lotNo}），请勿重复提交`);
        }
      }

      // 2. 生成 lotNo 序号（通过 SEQUENCE 原子取号）
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const datePart = dateStr.replace(/-/g, '');
      const prefix = `EXP${datePart}`;

      // 3. 逐条创建 IQC 待检批次并锁定库存
      const lotIds: string[] = [];

       for (const inv of reinspectItems) {
         const lotSeqRow = await tx.execute<{ seq: string }>(
           sql`SELECT nextval('seq_iqc_lot_no') AS seq`,
         );
         const lotSeq = Number(lotSeqRow[0]?.seq ?? 1);
         const lotNo = `${prefix}${lotSeq.toString().padStart(4, '0')}`;
         const reinspectBatchNo = inv.batchNo ? `${inv.batchNo}-R01` : undefined;
         // 检验编号：报检即生成，IQC 报告编号直接复用它
         const inspSeqRow = await tx.execute<{ seq: string }>(
           sql`SELECT nextval('seq_iqc_inspection_no') AS seq`,
         );
         const inspSeq = Number(inspSeqRow[0]?.seq ?? 1);
         const inspectionNo = `JY${datePart}${inspSeq.toString().padStart(4, '0')}`;

         const inserted = await tx
           .insert(iqcLot)
           .values({
             lotNo,
             inspectionNo,
             receiptDate: dateStr,
             lastReceiptDate: dateStr,
             supplierId: inv.supplierId ?? undefined,
             materialId: inv.materialId,
             productionDate: inv.productionDate ?? undefined,
             batchNo: reinspectBatchNo,
            totalQty: inv.quantity,
            unit: inv.unit,
            locationCodes: inv.locationCode ?? '',
            inspectionResult: 'pending',
            status: 'pending',
            remark: '超期物料报检',
          })
          // F-11：active 唯一索引（4 列）下同批次重复推送必须幂等，冲突即跳过
          .onConflictDoNothing({
            target: [iqcLot.supplierId, iqcLot.materialId, iqcLot.productionDate, iqcLot.batchNo],
            where: sql`${iqcLot.status} in ('pending','inspecting','review_pending','rejected')`,
          })
          .returning({ id: iqcLot.id });

        if (inserted.length === 0) {
          continue; // 已有进行中批次 → 跳过，不重复锁库存
        }
        lotIds.push(inserted[0].id);

        // 锁定库存（如果之前没锁）；仅锁 good 行（不覆盖 pending_qc 行的锁因）
        if (!inv.locked) {
          await tx
            .update(inventory)
            .set({
              locked: true,
              lockReason: '超期复检中',
            })
            .where(and(eq(inventory.id, inv.id), eq(inventory.stockStatus, 'good')));
        }
      }

      return { lotIds, count: lotIds.length };
    });

    return result;
  }

  async extendExpiry(params: {
    inventoryId: string;
    /** 延长天数（优先）；与 newExpiryDate 二选一 */
    extendDays?: number | null;
    /** 兼容旧调用：直接给目标日期，同样受强制报废期约束 */
    newExpiryDate?: string;
    extendedDays?: number;
    operatorId: string;
    operatorName: string;
    remark?: string;
  }): Promise<{ success: boolean; newExpiryDate: string; extendedDays: number; scrapDate: string | null; maxExtendDays: number | null }> {
    const { inventoryId, operatorId, remark } = params;

    if (!inventoryId) {
      throw new BadRequestException('库存ID不能为空');
    }
    if ((params.extendDays === undefined || params.extendDays === null) && !String(params.newExpiryDate || '').trim()) {
      throw new BadRequestException('请填写延长天数');
    }

    const result = await this.db.transaction(async (tx) => {
      // 1. 查出库存和物料信息，判断是否超期
      const expiryDateExpr = sql<string>`
        CASE
          WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date
          WHEN ${material.expiryDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
            THEN (${inventory.productionDate} + (${material.expiryDays} || ' days')::interval)::date
          ELSE NULL
        END
      `;
      const scrapDateExpr = sql<string>`
        CASE
          WHEN ${material.forceScrapDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
            THEN (${inventory.productionDate} + (${material.forceScrapDays} || ' days')::interval)::date
          ELSE NULL
        END
      `;

      const invResult = await tx
        .select({
          id: inventory.id,
          materialId: inventory.materialId,
          batchNo: inventory.batchNo,
          locationId: inventory.locationId,
          productionDate: inventory.productionDate,
          expiryDays: material.expiryDays,
          locked: inventory.locked,
          lockReason: inventory.lockReason,
          expiryDate: expiryDateExpr,
          scrapDate: sql<string>`${scrapDateExpr}::text`.as('scrap_date'),
          remainingDays: sql<number>`(${expiryDateExpr} - CURRENT_DATE)::integer`.as('remaining_days'),
        })
        .from(inventory)
        .innerJoin(material, eq(inventory.materialId, material.id))
        .leftJoin(
          sql`(
            SELECT DISTINCT ON (material_id, batch_no, location_id)
              material_id, batch_no, location_id, new_expiry_date
            FROM material_expiry_extension
            ORDER BY material_id, batch_no, location_id, _created_at DESC
          ) ext`,
          and(
            sql`ext.material_id = ${inventory.materialId}`,
            sql`ext.batch_no = ${inventory.batchNo}`,
            sql`ext.location_id = ${inventory.locationId}`,
          ),
        )
        .where(eq(inventory.id, inventoryId))
        .limit(1);

      if (invResult.length === 0) {
        throw new NotFoundException('库存记录不存在');
      }

      const inv = invResult[0];

      if (inv.expiryDate === null || inv.expiryDate === undefined) {
        throw new BadRequestException('该物料没有设置有效期，无法延期');
      }

      // 2. 校验：允许超期（剩余天数 <= 0）以及预警阶段（30天内即将到期）发起延期申请
      if (Number(inv.remainingDays) > 30) {
        throw new BadRequestException('该库存距离有效期超过30天，暂无需延期');
      }

      // 3. 按「当前有效期 + 天数」算截止日，并卡住物料强制报废期
      const resolved = this.resolveExtension({
        rows: [{ expiryDate: inv.expiryDate, scrapDate: inv.scrapDate }],
        extendDays: params.extendDays,
        newExpiryDate: params.newExpiryDate,
        label: '本库存行',
      });

      await tx.insert(materialExpiryExtension).values({
        materialId: inv.materialId,
        batchNo: inv.batchNo ?? '',
        locationId: inv.locationId,
        originalExpiryDate: inv.expiryDate,
        newExpiryDate: resolved.newExpiryDate,
        extendedDays: resolved.extendedDays,
        operatorId: operatorId,
        remark: remark ?? null,
      });

      // 4. 不在这里解锁。
      // 原实现延期后立即清掉「超期复检中」锁定，等于**货还没通过 IQC 判定就已经可以发料**，
      // 与「先延期、再判合格才放行」的顺序相反。现在锁定统一由 IQC 判定结果处理：
      //   判合格 → iqc.service.finalizeLotInventory 的 L2 分支按 lock_reason 精确解锁；
      //   判不合格 → 迁到不良品仓并锁给 MRB。

      return resolved;
    });

    return {
      success: true,
      newExpiryDate: result.newExpiryDate,
      extendedDays: result.extendedDays,
      scrapDate: result.scrapDate,
      maxExtendDays: result.maxExtendDays,
    };
  }

  /** 新有效期不得早于今天（延到过去 = 仍然是超期物料） */
  private assertExpiryDateNotPast(newExpiryDate: string): void {
    const target = String(newExpiryDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
      throw new BadRequestException('新有效期格式应为 YYYY-MM-DD');
    }
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (target < todayStr) {
      throw new BadRequestException(`新有效期不能早于今天（${todayStr}），否则物料仍处于超期状态`);
    }
  }

  /** 日期字符串 → UTC 毫秒（只用于纯日期加减，避开本地时区把日期推差一天） */
  private toUtcTime(dateStr: string): number {
    const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
    return Date.UTC(y || 1970, (m || 1) - 1, d || 1);
  }

  /** 纯日期 + 天数 → 日期字符串（YYYY-MM-DD） */
  private addDaysToDate(dateStr: string, days: number): string {
    const dt = new Date(this.toUtcTime(dateStr) + days * 86400000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }

  /** 两个纯日期相差天数（to - from） */
  private diffDateDays(from: string, to: string): number {
    return Math.round((this.toUtcTime(to) - this.toUtcTime(from)) / 86400000);
  }

  /**
   * 延期结果解析：把「延长天数」统一换算成落库用的新有效期，并校验物料强制报废期上限。
   *
   * - 基准日取该批次各行中**最早**的当前有效期（同批次通常一致，取最早可保证每行都是往后延）
   * - 报废上限取各行中**最早**的报废截止日（生产日期 + 物料强制报废期），按最严的一行卡住
   * - 只传目标日期不传天数时按日期执行，但同样受报废期约束（防止绕过天数校验）
   */
  private resolveExtension(params: {
    rows: Array<{ expiryDate: string | null; scrapDate: string | null }>;
    extendDays?: number | null;
    newExpiryDate?: string;
    label: string;
  }): {
    newExpiryDate: string;
    extendedDays: number;
    baseExpiryDate: string;
    scrapDate: string | null;
    maxExtendDays: number | null;
  } {
    const dates = params.rows
      .map((r) => String(r.expiryDate || '').slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    if (dates.length === 0) {
      throw new BadRequestException('该批次没有可计算的有效期（可能缺少生产日期或物料未设置有效期）');
    }
    const baseExpiryDate = dates[0];

    const scrapDates = params.rows
      .map((r) => (r.scrapDate ? String(r.scrapDate).slice(0, 10) : ''))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
    const scrapDate = scrapDates.length > 0 ? scrapDates[0] : null;
    const maxExtendDays = scrapDate ? this.diffDateDays(baseExpiryDate, scrapDate) : null;

    // 天数合法性先校验（输入格式问题，优先提示）
    const useDays = params.extendDays !== undefined && params.extendDays !== null;
    if (useDays) {
      const days = Number(params.extendDays);
      if (!Number.isInteger(days) || days <= 0) {
        throw new BadRequestException('延长天数必须是大于 0 的整数');
      }
    }

    // 报废期已到（物料报废期配得比有效期还短，或历史数据有效期已被延过）：先给出准确提示，
    // 否则会先命中「不能早于今天」，用户看不出真正的卡点在哪
    if (scrapDate && maxExtendDays !== null && maxExtendDays <= 0) {
      throw new BadRequestException(
        `当前有效期 ${baseExpiryDate} 已达到物料强制报废期（${scrapDate}），不能再延期，请按不合格 / 报废流程处理`,
      );
    }

    let newExpiryDate: string;
    let extendedDays: number;

    if (useDays) {
      extendedDays = Number(params.extendDays);
      newExpiryDate = this.addDaysToDate(baseExpiryDate, extendedDays);
    } else {
      const target = String(params.newExpiryDate || '').slice(0, 10);
      if (!target) {
        throw new BadRequestException('请填写延长天数');
      }
      extendedDays = this.diffDateDays(baseExpiryDate, target);
      if (extendedDays <= 0) {
        throw new BadRequestException(`延长后的有效期必须晚于当前有效期（${baseExpiryDate}）`);
      }
      newExpiryDate = target;
    }

    // 延到过去等于没延：物料仍是超期状态，IQC 判定合格时依然会被拦
    this.assertExpiryDateNotPast(newExpiryDate);

    if (scrapDate && maxExtendDays !== null && newExpiryDate > scrapDate) {
      throw new BadRequestException(
        `延长 ${extendedDays} 天后为 ${newExpiryDate}，已超过物料强制报废期 ${scrapDate}。${params.label}最多只能延长 ${maxExtendDays} 天（至 ${scrapDate}）`,
      );
    }

    return { newExpiryDate, extendedDays, baseExpiryDate, scrapDate, maxExtendDays };
  }

  /**
   * 按「物料 + 物理批次」批量延期（IQC 待检清单用）。
   *
   * 一个检验批次往往对应多个库位行，逐行调 extendExpiry 会出现「部分库位延期成功」的
   * 半成品状态（前端循环也拿不到事务）。这里一次事务覆盖该批次全部超期/预警库存行。
   *
   * 检验员只填「延长天数」，截止日由服务端按「当前有效期 + 天数」算出，且不得超过强制报废期。
   *
   * @param batchNo 传检验批次的物理批次（调用方需去掉 -R01 之类的复检后缀）
   */
  async extendExpiryByBatch(params: {
    materialId: string;
    batchNo: string;
    /** 检验员填写的延长天数（优先）；与 newExpiryDate 二选一 */
    extendDays?: number | null;
    newExpiryDate?: string;
    operatorId: string;
    remark?: string;
  }): Promise<{
    success: boolean;
    affected: number;
    extendedDays: number;
    earliestExpiryDate: string | null;
    newExpiryDate: string;
    scrapDate: string | null;
    maxExtendDays: number | null;
  }> {
    const materialId = String(params.materialId || '').trim();
    const batchNo = String(params.batchNo || '').trim();
    if (!materialId || !batchNo) {
      throw new BadRequestException('物料与批次不能为空');
    }
    if ((params.extendDays === undefined || params.extendDays === null) && !String(params.newExpiryDate || '').trim()) {
      throw new BadRequestException('请填写延长天数');
    }

    const expiryDateExpr = sql<string>`
      CASE
        WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date
        WHEN ${material.expiryDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
          THEN (${inventory.productionDate} + (${material.expiryDays} || ' days')::interval)::date
        ELSE NULL
      END
    `;
    const remainingDaysSql = sql<number>`(${expiryDateExpr} - CURRENT_DATE)::integer`;
    // 强制报废截止日：生产日期 + 物料强制报废期天数（与有效期同口径）
    const scrapDateExpr = sql<string>`
      CASE
        WHEN ${material.forceScrapDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
          THEN (${inventory.productionDate} + (${material.forceScrapDays} || ' days')::interval)::date
        ELSE NULL
      END
    `;

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: inventory.id,
          locationId: inventory.locationId,
          expiryDate: sql<string>`${expiryDateExpr}::text`.as('expiry_date'),
          remainingDays: remainingDaysSql.as('remaining_days'),
          scrapDate: sql<string>`${scrapDateExpr}::text`.as('scrap_date'),
        })
        .from(inventory)
        .innerJoin(material, eq(inventory.materialId, material.id))
        .leftJoin(
          sql`(
            SELECT DISTINCT ON (material_id, batch_no, location_id)
              material_id, batch_no, location_id, new_expiry_date
            FROM material_expiry_extension
            ORDER BY material_id, batch_no, location_id, _created_at DESC
          ) ext`,
          and(
            sql`ext.material_id = ${inventory.materialId}`,
            sql`ext.batch_no = ${inventory.batchNo}`,
            sql`ext.location_id = ${inventory.locationId}`,
          ),
        )
        .where(and(
          eq(inventory.materialId, materialId),
          eq(inventory.batchNo, batchNo),
          inArray(inventory.stockStatus, ['good', 'pending_qc']),
          sql`${expiryDateExpr} IS NOT NULL`,
        ));
      // 注：这里不能加 FOR UPDATE —— 查询带 LEFT JOIN 延期子查询，
      // PostgreSQL 会报「FOR UPDATE cannot be applied to the nullable side of an outer join」。
      // 延期是低频人工操作，重复点击最多多留一条最新延期记录（口径按最新记录取），不影响正确性。

      // 只处理超期与预警（≤30 天）的行；距离到期还早的批次没有延期必要
      const targets = (rows as any[]).filter((r) => Number(r.remainingDays) <= 30);
      if (targets.length === 0) {
        throw new BadRequestException(
          '未找到该批次可延期的库存：可能已维护过有效期、距离到期超过 30 天，或库存不在良品仓/待检桶',
        );
      }

      // 统一按「当前有效期 + 天数」算截止日，并卡住物料强制报废期
      const resolved = this.resolveExtension({
        rows: targets.map((r) => ({ expiryDate: r.expiryDate, scrapDate: r.scrapDate })),
        extendDays: params.extendDays,
        newExpiryDate: params.newExpiryDate,
        label: '本批次',
      });

      for (const row of targets) {
        await tx.insert(materialExpiryExtension).values({
          materialId,
          batchNo,
          locationId: row.locationId,
          originalExpiryDate: row.expiryDate,
          newExpiryDate: resolved.newExpiryDate,
          // 每行各自的实际延长天数（同批次有效期一致时与输入天数相同）
          extendedDays: this.diffDateDays(String(row.expiryDate).slice(0, 10), resolved.newExpiryDate),
          operatorId: params.operatorId,
          remark: params.remark ?? null,
        });
      }

      // 与单行延期一致：不在这里解锁，锁定交给 IQC 判定结果处理
      return {
        success: true,
        affected: targets.length,
        extendedDays: resolved.extendedDays,
        earliestExpiryDate: resolved.baseExpiryDate,
        newExpiryDate: resolved.newExpiryDate,
        scrapDate: resolved.scrapDate,
        maxExtendDays: resolved.maxExtendDays,
      };
    });
  }

  async getInventorySummary(): Promise<Array<{ materialId: string; materialCode: string; materialName: string; totalQty: number; unit: string }>> {
    const result = await this.db
      .select({
        materialId: inventory.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        unit: inventory.unit,
        totalQty: sql<string>`sum(${inventory.quantity})`.as('total_qty'),
      })
      .from(inventory)
      .innerJoin(material, eq(inventory.materialId, material.id))
      .where(and(eq(inventory.stockStatus, 'good'), eq(inventory.locked, false)))
      .groupBy(inventory.materialId, material.materialCode, material.materialName, inventory.unit);

    return result.map((item) => ({
      ...item,
      totalQty: Number(item.totalQty),
    }));
  }

  /**
   * 库存现有量统计：按「仓库代码 + 物料编号」汇总整个仓库的库存数量。
   *
   * 与 getInventorySummary 的区别：那个只统计良品可用（good + 未锁定），
   * 这里按业务要求统计**全部库存**，包含不良品仓、待检、锁定等状态，
   * 并给出库位数 / 批次行数，便于盘点对账。
   */
  /**
   * 现有量统计的聚合 SQL（仓库 + 物料维度，不含分页）。
   *
   * 抽成独立方法的原因：列表分页查询与 Excel 导出必须共用同一段 SQL，
   * 否则导出的行数与页面合计一旦口径不同（多/少一层过滤）就会对不上账。
   */
  private buildStockSummarySql(params: {
    warehouseCode?: string;
    materialCode?: string;
    includeDefective?: boolean;
    stockStatus?: string;
  }) {
    const whCode = params.warehouseCode?.trim() || null;
    const kw = params.materialCode?.trim() || null;
    const includeDefective = params.includeDefective !== false;
    const status = params.stockStatus?.trim() || null;

    return sql`
      WITH agg AS (
        SELECT w.wh_code,
               w.wh_name_zh,
               w.wh_type,
               m.material_code,
               m.material_name,
               COALESCE(i.unit, m.unit) AS unit,
               COUNT(DISTINCT i.location_id)::int AS locations,
               COUNT(DISTINCT i.batch_no)::int AS batches,
               COALESCE(SUM(i.quantity), 0) AS qty,
               COUNT(*)::int AS lines
          FROM inventory i
          INNER JOIN material m ON m.id = i.material_id
          INNER JOIN warehouse_location l ON l.id = i.location_id
          INNER JOIN warehouse w ON w.id = l.warehouse_id
         WHERE i.quantity > 0
           AND (${whCode}::text IS NULL OR w.wh_code = ${whCode})
           AND (${kw}::text IS NULL OR m.material_code ILIKE '%' || ${kw} || '%'
                OR m.material_name ILIKE '%' || ${kw} || '%')
           AND (${includeDefective}::boolean OR w.wh_type <> 'defective')
           AND (${status}::text IS NULL OR i.stock_status = ${status})
         GROUP BY w.wh_code, w.wh_name_zh, w.wh_type, m.material_code, m.material_name, COALESCE(i.unit, m.unit)
      )
      SELECT a.*,
             COUNT(*) OVER()::int AS total_rows,
             COALESCE(SUM(a.qty) OVER(), 0) AS grand_qty
        FROM agg a
       ORDER BY a.wh_code ASC, a.qty DESC, a.material_code ASC
    `;
  }

  private mapStockSummaryRows(rows: Array<any>) {
    return rows.map((r) => ({
      warehouseCode: r.wh_code,
      warehouseName: r.wh_name_zh,
      whType: r.wh_type,
      materialCode: r.material_code,
      materialName: r.material_name,
      unit: r.unit || '',
      locations: Number(r.locations ?? 0),
      batches: Number(r.batches ?? 0),
      qty: Number(r.qty ?? 0),
      lines: Number(r.lines ?? 0),
    }));
  }

  async getStockSummary(params: {
    page?: number;
    pageSize?: number;
    warehouseCode?: string;
    materialCode?: string;
    /** 是否包含不良品仓（wh_type='defective'），默认包含 */
    includeDefective?: boolean;
    stockStatus?: string;
  }) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 50;
    const offset = (page - 1) * pageSize;

    const base = this.buildStockSummarySql(params);
    const rows = (await this.db.execute(
      sql`${base} LIMIT ${pageSize} OFFSET ${offset}`,
    )) as unknown as Array<any>;

    return {
      items: this.mapStockSummaryRows(rows),
      total: Number(rows[0]?.total_rows ?? 0),
      grandQty: Number(rows[0]?.grand_qty ?? 0),
      page,
      pageSize,
    };
  }

  /**
   * 导出用：按同一筛选条件取**全部行**（不分页）。
   *
   * 不走 getStockSummary 的 pageSize 上限，避免数据量超过上限时
   * 导出的明细比页面总计少一截（对账时最容易被当成漏数）。
   */
  async getStockSummaryAll(params: {
    warehouseCode?: string;
    materialCode?: string;
    includeDefective?: boolean;
    stockStatus?: string;
  }) {
    const rows = (await this.db.execute(
      this.buildStockSummarySql(params),
    )) as unknown as Array<any>;

    return {
      items: this.mapStockSummaryRows(rows),
      total: Number(rows[0]?.total_rows ?? 0),
      grandQty: Number(rows[0]?.grand_qty ?? 0),
    };
  }

  async verifySourceLocation(params: {
    locationCode: string;
    items: Array<{ qrContent: string; supplierCode: string; materialCode: string; productionDate: string; batchNo: string; serialNo: string; quantity: number }>;
  }): Promise<SourceVerifyResult> {
    const { locationCode, items } = params;

    const locResult = await this.db
      .select({
        id: warehouseLocation.id,
        locationCode: warehouseLocation.locationCode,
        warehouseId: warehouseLocation.warehouseId,
        status: warehouseLocation.status,
      })
      .from(warehouseLocation)
      .where(eq(warehouseLocation.locationCode, locationCode))
      .limit(1);

    if (locResult.length === 0) {
      return { valid: false, errorCode: 'invalid_location', errorMessage: '源地址码不存在' };
    }
    const loc = locResult[0];
    if (loc.status !== 'active') {
      return { valid: false, errorCode: 'invalid_location', errorMessage: '源地址码未启用' };
    }

    const whResult = await this.db
      .select({ whCode: warehouse.whCode })
      .from(warehouse)
      .where(eq(warehouse.id, loc.warehouseId))
      .limit(1);

    const verified: ScannedMoveItem[] = [];
    const failed: Array<{ materialCode: string; batchNo: string; serialNo: string; reason: string }> = [];

    for (const it of items) {
      const matResult = await this.db
        .select({ id: material.id, materialName: material.materialName, unit: material.unit })
        .from(material)
        .where(eq(material.materialCode, it.materialCode))
        .limit(1);
      if (matResult.length === 0) {
        failed.push({ materialCode: it.materialCode, batchNo: it.batchNo, serialNo: it.serialNo, reason: '物料不存在' });
        continue;
      }
      const mat = matResult[0];

      const supResult = await this.db
        .select({ id: supplier.id })
        .from(supplier)
        .where(eq(supplier.supplierCode, it.supplierCode))
        .limit(1);
      if (supResult.length === 0) {
        failed.push({ materialCode: it.materialCode, batchNo: it.batchNo, serialNo: it.serialNo, reason: '供应商不存在' });
        continue;
      }

      // 仅校验良品仓库存：避免同库位同批次存在 defective 行时误判/误配（同 doMoveSingle）
      const invResult = await this.db
        .select({ id: inventory.id, quantity: inventory.quantity })
        .from(inventory)
        .where(
          and(
            eq(inventory.locationId, loc.id),
            eq(inventory.materialId, mat.id),
            eq(inventory.batchNo, it.batchNo),
            eq(inventory.stockStatus, 'good'),
          ),
        )
        .limit(1);

      if (invResult.length === 0 || Number(invResult[0].quantity) < it.quantity) {
        // F-11：区分「待检库存」与「真的没库存」，给出可理解的原因（待检货不可移库）
        let reason = '源库位无此批次库存';
        if (invResult.length === 0) {
          const pending = await this.db
            .select({ id: inventory.id })
            .from(inventory)
            .where(
              and(
                eq(inventory.locationId, loc.id),
                eq(inventory.materialId, mat.id),
                eq(inventory.batchNo, it.batchNo),
                eq(inventory.stockStatus, 'pending_qc'),
              ),
            )
            .limit(1);
          if (pending.length > 0) reason = '该批次为待检库存（IQC 未放行），不可移库';
        }
        failed.push({ materialCode: it.materialCode, batchNo: it.batchNo, serialNo: it.serialNo, reason });
        continue;
      }

      verified.push({
        qrContent: it.qrContent,
        supplierCode: it.supplierCode,
        materialCode: it.materialCode,
        materialName: mat.materialName,
        unit: mat.unit,
        productionDate: it.productionDate,
        batchNo: it.batchNo,
        serialNo: it.serialNo,
        quantity: it.quantity,
        materialId: mat.id,
        supplierId: supResult[0].id,
      });
    }

    if (failed.length > 0) {
      return {
        valid: false,
        errorCode: 'source_stock_mismatch',
        errorMessage: '源库位无此批次库存',
        locationId: loc.id,
        locationCode: loc.locationCode,
        warehouseId: loc.warehouseId,
        whCode: whResult[0]?.whCode,
        items: verified,
        failedItems: failed,
      };
    }

    return {
      valid: true,
      locationId: loc.id,
      locationCode: loc.locationCode,
      warehouseId: loc.warehouseId,
      whCode: whResult[0]?.whCode,
      items: verified,
    };
  }

  async verifyTargetLocation(params: {
    targetLocationCode: string;
    sourceWarehouseId: string;
  }): Promise<{ valid: boolean; errorCode?: string; errorMessage?: string; locationId?: string; locationCode?: string; warehouseId?: string; whCode?: string }> {
    const { targetLocationCode, sourceWarehouseId } = params;

    const locResult = await this.db
      .select({
        id: warehouseLocation.id,
        locationCode: warehouseLocation.locationCode,
        warehouseId: warehouseLocation.warehouseId,
        status: warehouseLocation.status,
      })
      .from(warehouseLocation)
      .where(eq(warehouseLocation.locationCode, targetLocationCode))
      .limit(1);

    if (locResult.length === 0) {
      return { valid: false, errorCode: 'invalid_location', errorMessage: '目标地址码不存在' };
    }
    const loc = locResult[0];
    if (loc.status !== 'active') {
      return { valid: false, errorCode: 'invalid_location', errorMessage: '目标地址码未启用' };
    }
    if (loc.warehouseId !== sourceWarehouseId) {
      return { valid: false, errorCode: 'cross_warehouse', errorMessage: '跨仓请用库存调拨' };
    }

    const whResult = await this.db
      .select({ whCode: warehouse.whCode })
      .from(warehouse)
      .where(eq(warehouse.id, loc.warehouseId))
      .limit(1);

    return {
      valid: true,
      locationId: loc.id,
      locationCode: loc.locationCode,
      warehouseId: loc.warehouseId,
      whCode: whResult[0]?.whCode,
    };
  }

  async batchIntraTransfer(body: {
    fromLocationId: string;
    toLocationId: string;
    warehouseId: string;
    items: ScannedMoveItem[];
    operatorId: string;
    operatorName: string;
    remark?: string;
  }): Promise<StockTransfer[]> {
    const { fromLocationId, toLocationId, warehouseId, items, operatorId, operatorName, remark } = body;

    if (fromLocationId === toLocationId) {
      throw new BadRequestException('源地址码和目标地址码不能相同');
    }
    if (!items || items.length === 0) {
      throw new BadRequestException('移库物料不能为空');
    }

    // 参数校验通过后、任何库存读写之前：拦掉 MRB 「其他」处置的保留库存。
    // 批量移库要**逐条明细**判来源库位（真实场景可能来自多个库位，不能只看外层 fromLocationId）。
    const itemSourceLocIds = items.map((it: any) => (it?.fromLocationId ? String(it.fromLocationId) : fromLocationId));
    await this.assertNotMrbReserved({ locationIds: [fromLocationId, ...itemSourceLocIds] });

    const locations = await this.db
      .select({ id: warehouseLocation.id, warehouseId: warehouseLocation.warehouseId, status: warehouseLocation.status })
      .from(warehouseLocation)
      .where(inArray(warehouseLocation.id, [fromLocationId, toLocationId]));

    const fromLoc = locations.find((l: { id: string; warehouseId: string; status: string }) => l.id === fromLocationId);
    const toLoc = locations.find((l: { id: string; warehouseId: string; status: string }) => l.id === toLocationId);

    if (!fromLoc) throw new NotFoundException('源地址码不存在');
    if (!toLoc) throw new NotFoundException('目标地址码不存在');
    if (fromLoc.warehouseId !== warehouseId || toLoc.warehouseId !== warehouseId) {
      throw new BadRequestException('源地址码和目标地址码必须属于同一仓库');
    }
    if (toLoc.status !== 'active') throw new BadRequestException('目标地址码未启用');

    const results: StockTransfer[] = [];
    const transferNo = await this.generateIntraTransferNo();

    await this.db.transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const result = await this.doMoveSingle({
          tx,
          fromLocationId,
          toLocationId,
          materialId: item.materialId,
          batchNo: item.batchNo,
          quantity: item.quantity,
          operatorId,
          operatorName,
          remark,
          transferNo: `${transferNo}-${(i + 1).toString().padStart(3, '0')}`,
        });
        results.push(result);
      }
    });

    return results;
  }

  private async doMoveSingle(params: {
    tx: any;
    fromLocationId: string;
    toLocationId: string;
    materialId: string;
    batchNo: string | null;
    quantity: number;
    operatorId: string;
    operatorName: string;
    remark?: string;
    transferNo: string;
  }): Promise<StockTransfer> {
    const { tx, fromLocationId, toLocationId, materialId, batchNo, quantity, operatorId, operatorName, remark, transferNo } = params;

    // 仅取良品仓库存（stockStatus='good'）。
    // inventory 唯一键为 (material_id, location_id, batch_no, stock_status)，
    // 同一「物料+库位+批次」可能同时存在 good / defective 等多行；不过滤时
    // 会因物理行序随机取到 defective 行，导致「明明有良品却报库存不足」或误移非良品库存。
    // 与 doTransfer 的源库存查询口径保持一致。
    const sourceInv = await tx
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.locationId, fromLocationId),
          eq(inventory.materialId, materialId),
          eq(inventory.batchNo, batchNo),
          eq(inventory.stockStatus, 'good'),
        ),
      )
      .for('update')
      .limit(1);

    if (sourceInv.length === 0) {
      throw new ConflictException(`物料 ${batchNo} 批次源库位无库存`);
    }
    const source = sourceInv[0];
    if (Number(source.quantity) < quantity) {
      throw new ConflictException(`物料 ${batchNo} 批次源库位库存不足`);
    }

    const newSourceQty = Number(source.quantity) - quantity;
    if (newSourceQty === 0) {
      // BUG-013: 条件删除，affectedRows=0 说明并发下库存已被扣减，防止负库存
      const delRes = await tx.delete(inventory)
        .where(and(eq(inventory.id, source.id), gte(inventory.quantity, String(quantity))))
        .returning({ id: inventory.id });
      if (delRes.length === 0) {
        throw new ConflictException('库存不足，扣减后将为负');
      }
    } else {
      // BUG-013: 条件扣减 UPDATE ... WHERE quantity >= $1，affectedRows=0 则拒绝
      const updRes = await tx.update(inventory)
        .set({ quantity: sql`${inventory.quantity} - ${quantity}` })
        .where(and(eq(inventory.id, source.id), gte(inventory.quantity, String(quantity))))
        .returning({ id: inventory.id });
      if (updRes.length === 0) {
        throw new ConflictException('库存不足，扣减后将为负');
      }
    }

    // 原子 upsert 目标库存：并发下避免唯一约束 (material_id, location_id, batch_no, stock_status) 冲突导致 500
    await tx.insert(inventory).values({
      materialId,
      locationId: toLocationId,
      batchNo: source.batchNo,
      supplierId: source.supplierId,
      quantity: String(quantity),
      unit: source.unit,
      stockStatus: source.stockStatus,
      productionDate: source.productionDate,
      locked: source.locked,
      lockReason: source.lockReason,
    }).onConflictDoUpdate({
      // 冲突目标：库上唯一索引 (material_id, location_id, batch_no, stock_status)。
      // MRB「其他」保留行靠「一张单一个保留库位」隔离，不依赖额外索引。
      target: INVENTORY_STOCK_CONFLICT_TARGET,
      set: {
        quantity: sql`${inventory.quantity} + ${sql.raw('excluded.quantity')}`,
      },
    });

    const today = new Date().toISOString().split('T')[0];
    await tx.insert(stockTransfer).values({
      transferNo,
      transferDate: today,
      fromLocationId,
      toLocationId,
      materialId,
      batchNo: source.batchNo,
      quantity: String(quantity),
      unit: source.unit,
      operatorId,
      status: 'intra_move',
      remark,
    });

    const fromLoc = alias(warehouseLocation, 'fromLoc');
    const toLoc = alias(warehouseLocation, 'toLoc');
    const row = await tx
      .select({
        id: stockTransfer.id,
        transferNo: stockTransfer.transferNo,
        transferDate: stockTransfer.transferDate,
        fromLocationId: stockTransfer.fromLocationId,
        fromLocationCode: fromLoc.locationCode,
        toLocationId: stockTransfer.toLocationId,
        toLocationCode: toLoc.locationCode,
        materialId: stockTransfer.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        batchNo: stockTransfer.batchNo,
        quantity: stockTransfer.quantity,
        unit: stockTransfer.unit,
        status: stockTransfer.status,
        remark: stockTransfer.remark,
      })
      .from(stockTransfer)
      .innerJoin(material, eq(stockTransfer.materialId, material.id))
      .innerJoin(fromLoc, eq(fromLoc.id, stockTransfer.fromLocationId))
      .innerJoin(toLoc, eq(toLoc.id, stockTransfer.toLocationId))
      .where(eq(stockTransfer.transferNo, transferNo))
      .limit(1);

    const r = row[0];
    return {
      id: r.id,
      transferNo: r.transferNo,
      transferDate: r.transferDate,
      fromLocationId: r.fromLocationId,
      fromLocationCode: r.fromLocationCode,
      toLocationId: r.toLocationId,
      toLocationCode: r.toLocationCode,
      materialId: r.materialId,
      materialCode: r.materialCode,
      materialName: r.materialName,
      batchNo: r.batchNo ?? undefined,
      quantity: Number(r.quantity),
      unit: r.unit,
      operatorId: undefined,
      operatorName: undefined,
      status: r.status,
      remark: r.remark ?? undefined,
    };
  }

  /**
   * MRB 占用守卫（设计 v2.1-arch.1 §8 R2）。
   *
   * 「其他」三类处置会把数量搬到**本单专属保留库位**并打 `lock_reason = 'MRB-OTHER:<mrbNo>'`。
   * 这批库存只能由两个合法出口释放：
   *   1. `POST /mrb/disposition/:id/confirm-out`（退回客户确认已提走，按明细数量扣减）；
   *   2. 后续 MRB 流程另行判定。
   * 任何人工库存作业（调拨 / 移库 / 批量移库 / 盘点调整 / 锁定 / 解锁）碰它都会造成
   * 「MRB 账上有占用、库里没有货」的错账 —— 尤其 `unlock` 会把 `lock_reason` 清空，
   * 等于静默释放占用，故必须在**任何写入之前**拦掉。
   *
   * ⚠️ 调用位置必须满足「参数校验 → 本守卫 → 库存读写」：
   *    若放在参数校验之前，`fromLocationId` 为空这类正常参数错误也会报「MRB 占用」，误导用户。
   * ⚠️ 不能只靠 UI 过滤：`StockTransfer.tsx` 的库位是手填 id，必须服务端兜底。
   *
   * @param scope.locationIds 参与判定的库位（源库位 / 批量移库每条明细的来源库位）
   * @param scope.inventoryIds 参与判定的库存行（盘点调整 / 锁定 / 解锁）
   */
  private async assertNotMrbReserved(scope: {
    locationIds?: Array<string | null | undefined>;
    inventoryIds?: Array<string | null | undefined>;
  }): Promise<void> {
    const locationIds = (scope.locationIds || []).filter((v): v is string => !!v);
    const inventoryIds = (scope.inventoryIds || []).filter((v): v is string => !!v);
    // 没有可判定的入参（如参数本身非法）→ 交给后续的 requireUuid / 404 处理
    if (locationIds.length === 0 && inventoryIds.length === 0) return;

    // 两级收窄，口径不同：
    //  - **按库存行**（锁 / 解锁 / 盘点调整）：行上有任何 `MRB-` 标记都不许动。
    //    v3 起退货/报废是「原地冻结」（`MRB-RETURN:` / `MRB-SCRAP:`），
    //    unlock 会清空 lock_reason，等于把待退、待销毁的货静默放回可评审池。
    //  - **按库位**（整库位调拨）：只拦 `MRB-OTHER:`。
    //    因为退货/报废冻结行就躺在正常的收货库位上，与同批次其他库存混在一行，
    //    按库位一刀切会把仓库正常调拨全部堵死。
    const idHit =
      inventoryIds.length > 0
        ? ((await this.db.execute(sql`
            SELECT id, lock_reason FROM inventory
            WHERE lock_reason LIKE ${MRB_LOCK_LIKE_PATTERN}
              AND id IN (${sql.join(inventoryIds.map((id) => sql`${id}::uuid`), sql`, `)})
            LIMIT 1
          `)) as unknown as Array<{ id: string; lock_reason: string }>)
        : [];

    const locHit =
      idHit.length === 0 && locationIds.length > 0
        ? ((await this.db.execute(sql`
            SELECT id, lock_reason FROM inventory
            WHERE lock_reason LIKE ${MRB_OTHER_LIKE_PATTERN}
              AND location_id IN (${sql.join(locationIds.map((id) => sql`${id}::uuid`), sql`, `)})
            LIMIT 1
          `)) as unknown as Array<{ id: string; lock_reason: string }>)
        : [];

    const hit = idHit[0] ?? locHit[0];
    if (!hit) return;

    const lockReason = String(hit.lock_reason || '');
    // 统一去掉 `MRB-<KIND>:` 前缀，错误文案只暴露单号
    const mrbNo = lockReason.startsWith(MRB_LOCK_PREFIX)
      ? lockReason.slice(lockReason.indexOf(':') + 1)
      : lockReason;
    throw new BadRequestException(
      `该库存已被 MRB 占用（${mrbNo}），请先在 MRB 处理`,
    );
  }

  async transferStock(body: {
    fromLocationId: string;
    toLocationId: string;
    materialId: string;
    batchNo?: string;
    quantity: number;
    operatorId: string;
    operatorName: string;
    remark?: string;
  }): Promise<StockTransfer> {
    const { fromLocationId, toLocationId } = body;

    // BUG-021 同类：缺少/非法 UUID 不能落到 SQL 层（否则 PG 报 22P02 被包成 500 并把 SQL 栈回吐给客户端）
    requireUuid(fromLocationId, '源库位');
    requireUuid(toLocationId, '目标库位');
    requireUuid(body.materialId, '物料');

    if (fromLocationId === toLocationId) {
      throw new BadRequestException('源库位和目标库位不能相同');
    }
    if (!Number.isFinite(Number(body.quantity)) || Number(body.quantity) <= 0) {
      throw new BadRequestException('调拨数量必须大于0');
    }

    // 参数校验通过后、任何库存读写之前：拦掉 MRB 「其他」处置的保留库存
    await this.assertNotMrbReserved({ locationIds: [fromLocationId] });

    const transferNo = await this.generateTransferNo();
    return this.doTransfer(body, transferNo, 'completed');
  }

  async intraTransfer(body: {
    warehouseId: string;
    fromLocationId: string;
    toLocationId: string;
    materialId: string;
    batchNo?: string;
    quantity: number;
    operatorId: string;
    operatorName: string;
    remark?: string;
  }): Promise<StockTransfer> {
    const { warehouseId, fromLocationId, toLocationId, quantity } = body;

    // BUG-021 同类：入口先挡掉缺失/非法 UUID，避免 22P02 → 500
    requireUuid(warehouseId, '仓库');
    requireUuid(fromLocationId, '源地址码');
    requireUuid(toLocationId, '目标地址码');
    requireUuid(body.materialId, '物料');

    if (fromLocationId === toLocationId) {
      throw new BadRequestException('源地址码和目标地址码不能相同');
    }
    if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) {
      throw new BadRequestException('移库数量必须大于0');
    }

    // 参数校验通过后、任何库存读写之前：拦掉 MRB 「其他」处置的保留库存
    await this.assertNotMrbReserved({ locationIds: [fromLocationId] });

    // Verify both locations belong to the same warehouse
    const locations = await this.db
      .select({ id: warehouseLocation.id, warehouseId: warehouseLocation.warehouseId, status: warehouseLocation.status })
      .from(warehouseLocation)
      .where(inArray(warehouseLocation.id, [fromLocationId, toLocationId]));

    const fromLoc = locations.find((l: { id: string; warehouseId: string; status: string }) => l.id === fromLocationId);
    const toLoc = locations.find((l: { id: string; warehouseId: string; status: string }) => l.id === toLocationId);

    if (!fromLoc) {
      throw new NotFoundException('源地址码不存在');
    }
    if (!toLoc) {
      throw new NotFoundException('目标地址码不存在');
    }
    if (fromLoc.warehouseId !== warehouseId || toLoc.warehouseId !== warehouseId) {
      throw new BadRequestException('源地址码和目标地址码必须属于同一仓库');
    }
    if (toLoc.status !== 'active') {
      throw new BadRequestException('目标地址码未启用');
    }

    const transferNo = await this.generateIntraTransferNo();
    return this.doTransfer(body, transferNo, 'intra_move');
  }

  private async doTransfer(
    body: {
      fromLocationId: string;
      toLocationId: string;
      materialId: string;
      batchNo?: string;
      quantity: number;
      operatorId: string;
      operatorName: string;
      remark?: string;
    },
    transferNo: string,
    status: string,
  ): Promise<StockTransfer> {
    const { fromLocationId, toLocationId, materialId, batchNo, quantity, operatorId, remark } = body;

    const today = new Date().toISOString().split('T')[0];

    await this.db.transaction(async (tx) => {
      // 1. 锁定源库存行（good, 未锁定），检查数量
      const sourceConditions = [
        eq(inventory.locationId, fromLocationId),
        eq(inventory.materialId, materialId),
        eq(inventory.stockStatus, 'good'),
        eq(inventory.locked, false),
      ];
      if (batchNo) sourceConditions.push(eq(inventory.batchNo, batchNo));

      const sourceInv = await tx
        .select()
        .from(inventory)
        .where(and(...sourceConditions))
        .for('update')
        .limit(1);

      if (sourceInv.length === 0) {
        const lockedInv = await tx
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.locationId, fromLocationId),
              eq(inventory.materialId, materialId),
              eq(inventory.stockStatus, 'good'),
              eq(inventory.locked, true),
            ),
          )
          .limit(1);
        if (lockedInv.length > 0) {
          throw new BadRequestException('该批次尚未完成检验，处于锁定状态，不可移库');
        }
        throw new NotFoundException('源库位无对应良品库存');
      }

      const source = sourceInv[0];
      if (Number(source.quantity) < quantity) {
        throw new ConflictException('源库位库存不足');
      }

      // 2. 检查目标库位是否启用
      const targetLoc = await tx
        .select()
        .from(warehouseLocation)
        .where(eq(warehouseLocation.id, toLocationId))
        .limit(1);

      if (targetLoc.length === 0) {
        throw new NotFoundException('目标库位不存在');
      }
      if (targetLoc[0].status !== 'active') {
        throw new BadRequestException('目标库位未启用');
      }

      // 3. 扣减源库存（BUG-013: 条件扣减，防止负库存）
      const newSourceQty = Number(source.quantity) - quantity;
      if (newSourceQty === 0) {
        const delRes = await tx.delete(inventory)
          .where(and(eq(inventory.id, source.id), gte(inventory.quantity, String(quantity))))
          .returning({ id: inventory.id });
        if (delRes.length === 0) {
          throw new ConflictException('库存不足，扣减后将为负');
        }
      } else {
        const updRes = await tx.update(inventory)
          .set({ quantity: sql`${inventory.quantity} - ${quantity}` })
          .where(and(eq(inventory.id, source.id), gte(inventory.quantity, String(quantity))))
          .returning({ id: inventory.id });
        if (updRes.length === 0) {
          throw new ConflictException('库存不足，扣减后将为负');
        }
      }

      // 4. 原子 upsert 目标库存：并发下避免唯一约束冲突导致 500
      await tx.insert(inventory).values({
        materialId,
        locationId: toLocationId,
        batchNo: source.batchNo,
        supplierId: source.supplierId,
        quantity: String(quantity),
        unit: source.unit,
        stockStatus: source.stockStatus,
        productionDate: source.productionDate,
      }).onConflictDoUpdate({
        target: INVENTORY_STOCK_CONFLICT_TARGET,
        set: {
          quantity: sql`${inventory.quantity} + ${sql.raw('excluded.quantity')}`,
        },
      });

      // 5. 写调拨记录
      await tx.insert(stockTransfer).values({
        transferNo,
        transferDate: today,
        fromLocationId,
        toLocationId,
        materialId,
        batchNo: source.batchNo,
        quantity: String(quantity),
        unit: source.unit,
        operatorId,
        status,
        remark,
      });
    });

    return this.getTransferByNo(transferNo);
  }

  private async generateTransferNo(): Promise<string> {
    return this.generateTransferNoWithPrefix('DB');
  }

  private async generateIntraTransferNo(): Promise<string> {
    return this.generateTransferNoWithPrefix('INT');
  }

  private async generateTransferNoWithPrefix(prefixBase: string): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `${prefixBase}${dateStr}`;

    const result = await this.db.execute<{ seq: string }>(
      sql`SELECT nextval('seq_transfer_no') AS seq`,
    );
    const seq = Number(result[0]?.seq ?? 1);

    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  private async getTransferByNo(transferNo: string): Promise<StockTransfer> {
    const fromLoc = alias(warehouseLocation, 'fromLoc');
    const toLoc = alias(warehouseLocation, 'toLoc');

    const result = await this.db
      .select({
        id: stockTransfer.id,
        transferNo: stockTransfer.transferNo,
        transferDate: stockTransfer.transferDate,
        fromLocationId: stockTransfer.fromLocationId,
        fromLocationCode: fromLoc.locationCode,
        toLocationId: stockTransfer.toLocationId,
        toLocationCode: toLoc.locationCode,
        materialId: stockTransfer.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        batchNo: stockTransfer.batchNo,
        quantity: stockTransfer.quantity,
        unit: stockTransfer.unit,
        operatorId: sql<string>`(${stockTransfer.operatorId}).user_id`.as('operator_id'),
        operatorName: sql<string>`NULL`.as('operator_name'),
        status: stockTransfer.status,
        remark: stockTransfer.remark,
      })
      .from(stockTransfer)
      .innerJoin(material, eq(stockTransfer.materialId, material.id))
      .innerJoin(fromLoc, eq(fromLoc.id, stockTransfer.fromLocationId))
      .innerJoin(toLoc, eq(toLoc.id, stockTransfer.toLocationId))
      .where(eq(stockTransfer.transferNo, transferNo))
      .limit(1);

    if (result.length === 0) throw new NotFoundException('调拨单不存在');

    const row = result[0];
    return {
      id: row.id,
      transferNo: row.transferNo,
      transferDate: row.transferDate,
      fromLocationId: row.fromLocationId,
      fromLocationCode: row.fromLocationCode,
      toLocationId: row.toLocationId,
      toLocationCode: row.toLocationCode,
      materialId: row.materialId,
      materialCode: row.materialCode,
      materialName: row.materialName,
      batchNo: row.batchNo ?? undefined,
      quantity: Number(row.quantity),
      unit: row.unit,
      operatorId: row.operatorId ?? undefined,
      operatorName: row.operatorName ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
    };
  }

  async getTransferList(params: {
    page: number;
    pageSize: number;
    transferNo?: string;
    materialCode?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }): Promise<PaginatedResponse<StockTransfer>> {
    const { page, pageSize, transferNo, materialCode, startDate, endDate, status } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (transferNo) conditions.push(ilike(stockTransfer.transferNo, `%${transferNo}%`));
    if (materialCode) conditions.push(ilike(material.materialCode, `%${materialCode}%`));
    if (status) conditions.push(eq(stockTransfer.status, status));
    if (startDate) conditions.push(gte(stockTransfer.transferDate, startDate));
    if (endDate) {
      const nextDay = new Date(endDate);
      nextDay.setDate(nextDay.getDate() + 1);
      conditions.push(lt(stockTransfer.transferDate, nextDay.toISOString().split('T')[0]));
    }

    const fromLoc = alias(warehouseLocation, 'fromLoc');
    const toLoc = alias(warehouseLocation, 'toLoc');

    const baseQuery = this.db
      .select({
        id: stockTransfer.id,
        transferNo: stockTransfer.transferNo,
        transferDate: stockTransfer.transferDate,
        fromLocationId: stockTransfer.fromLocationId,
        fromLocationCode: fromLoc.locationCode,
        toLocationId: stockTransfer.toLocationId,
        toLocationCode: toLoc.locationCode,
        materialId: stockTransfer.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        batchNo: stockTransfer.batchNo,
        quantity: stockTransfer.quantity,
        unit: stockTransfer.unit,
        operatorId: sql<string>`(${stockTransfer.operatorId}).user_id`.as('operator_id'),
        operatorName: sql<string>`NULL`.as('operator_name'),
        status: stockTransfer.status,
        remark: stockTransfer.remark,
      })
      .from(stockTransfer)
      .innerJoin(material, eq(stockTransfer.materialId, material.id))
      .innerJoin(fromLoc, eq(fromLoc.id, stockTransfer.fromLocationId))
      .innerJoin(toLoc, eq(toLoc.id, stockTransfer.toLocationId));

    const whereQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const [totalResult, items] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(stockTransfer)
        .innerJoin(material, eq(stockTransfer.materialId, material.id))
        .innerJoin(fromLoc, eq(fromLoc.id, stockTransfer.fromLocationId))
        .innerJoin(toLoc, eq(toLoc.id, stockTransfer.toLocationId))
        .where(conditions.length > 0 ? and(...conditions) : undefined),
      whereQuery
        .orderBy(desc(stockTransfer.transferDate), desc(stockTransfer.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: items.map((item) => ({
        ...item,
        quantity: Number(item.quantity),
        batchNo: item.batchNo ?? undefined,
        operatorId: item.operatorId ?? undefined,
        operatorName: item.operatorName ?? undefined,
        remark: item.remark ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async lockInventory(body: {
    inventoryId: string;
    lockReason: string;
    operatorId: string;
    operatorName: string;
  }): Promise<Inventory> {
    const { inventoryId, lockReason } = body;

    if (!inventoryId) throw new BadRequestException('库存ID不能为空');
    if (lockReason === undefined || lockReason === null || String(lockReason).trim() === '') {
      throw new BadRequestException('锁定原因不能为空');
    }

    // 已锁定/待放的 MRB 保留库存不允许人工改动锁定状态
    await this.assertNotMrbReserved({ inventoryIds: [inventoryId] });

    await this.db.transaction(async (tx) => {
      // 行锁读取，避免并发 lock/unlock 交错导致状态不确定
      const inv = await lockRow(tx, inventory, inventory.id, inventoryId);
      if (!inv) throw new NotFoundException('库存记录不存在');
      if (inv.locked === true) {
        throw new ConflictException('该库存已处于锁定状态，请勿重复锁定');
      }

      // CAS：仅当仍为未锁定状态时才更新，防止并发下覆盖他人操作
      await casUpdate(tx, {
        table: inventory,
        idColumn: inventory.id,
        id: inventoryId,
        set: { locked: true, lockReason },
        guard: [eq(inventory.locked, false)],
        conflictMessage: '该库存状态已变更，请刷新后重试',
      });

      await this.writeInventoryAuditTx(tx, {
        inventory: inv,
        txType: 'lock',
        qty: 0,
        balanceAfter: Number(inv.quantity),
        remark: `锁定库存，原因: ${lockReason}`,
        operatorId: body.operatorId,
      });
    });

    return this.getInventoryById(inventoryId);
  }

  async unlockInventory(body: {
    inventoryId: string;
    operatorId: string;
    operatorName: string;
    reason?: string;
  }): Promise<Inventory> {
    const { inventoryId } = body;

    if (!inventoryId) throw new BadRequestException('库存ID不能为空');

    // 最危险的入口：unlock 会清空 lock_reason，等于静默释放 MRB 占用 → 必须最先拦掉
    await this.assertNotMrbReserved({ inventoryIds: [inventoryId] });

    await this.db.transaction(async (tx) => {
      const inv = await lockRow(tx, inventory, inventory.id, inventoryId);
      if (!inv) throw new NotFoundException('库存记录不存在');
      if (inv.locked !== true) {
        throw new ConflictException('该库存未处于锁定状态，无需解锁');
      }
      // F-11：待检库存(pending_qc)的唯一合法出口是 IQC 放行，禁止人工解锁绕过质量门。
      if ((inv as any).stockStatus === 'pending_qc') {
        throw new BadRequestException('待检库存不可解锁，请走 IQC 检验放行流程');
      }

      const prevReason = inv.lockReason ? String(inv.lockReason) : '';

      await casUpdate(tx, {
        table: inventory,
        idColumn: inventory.id,
        id: inventoryId,
        set: { locked: false, lockReason: null },
        guard: [eq(inventory.locked, true)],
        conflictMessage: '该库存状态已变更，请刷新后重试',
      });

      await this.writeInventoryAuditTx(tx, {
        inventory: inv,
        txType: 'unlock',
        qty: 0,
        balanceAfter: Number(inv.quantity),
        remark: `解锁库存${prevReason ? `，原锁定原因: ${prevReason}` : ''}${body.reason ? `，解锁说明: ${body.reason}` : ''}`,
        operatorId: body.operatorId,
      });
    });

    return this.getInventoryById(inventoryId);
  }

  /**
   * 写一条库存审计流水（锁/解锁等无数量变动的事件）。
   * 复用 inventory_transaction，qty=0 表示不涉及数量变化。
   */
  private async writeInventoryAuditTx(
    tx: DbExecutor,
    params: {
      inventory: Record<string, unknown>;
      txType: 'lock' | 'unlock';
      qty: number;
      balanceAfter: number;
      remark: string;
      operatorId?: string;
    },
  ): Promise<void> {
    const inv = params.inventory;
    const txNo = await this.generateAdjustTxNoWithPrefix(tx, params.txType === 'lock' ? 'LCK' : 'ULK');
    await tx.insert(inventoryTransaction).values({
      materialId: String(inv.materialId),
      locationId: String(inv.locationId),
      batchNo: (inv.batchNo as string) ?? null,
      labelNo: (inv.labelNo as string) ?? null,
      stockStatus: String(inv.stockStatus),
      txType: params.txType,
      txNo,
      qty: String(params.qty),
      balanceAfter: String(params.balanceAfter),
      unit: String(inv.unit ?? ''),
      referenceNo: null,
      remark: params.remark,
      createdBy: params.operatorId || null,
      updatedBy: params.operatorId || null,
    });
  }

  async adjustInventory(params: {
    inventoryId: string;
    actualQty: number;
    reason: string;
    operatorId: string;
    operatorName: string;
    /** 系统管理员强制调整锁定库存时使用的授权标记与原因（BUG-017） */
    force?: boolean;
    forceReason?: string;
  }): Promise<Inventory> {
    const { inventoryId, actualQty, reason, operatorId } = params;

    if (!inventoryId) throw new BadRequestException('库存ID不能为空');
    // BUG-013: 盘点调整数量不允许为负数
    if (typeof actualQty !== 'number' || isNaN(actualQty) || actualQty < 0) {
      throw new BadRequestException('调整数量不能为负数');
    }
    // BUG-016: 调整原因不能为空
    if (reason === undefined || reason === null || String(reason).trim() === '') {
      throw new BadRequestException('调整原因不能为空');
    }

    // 参数校验通过后、任何库存读写之前：拦掉 MRB 「其他」处置的保留库存
    // （即使带 force 授权也不放行 —— 保留库存的账只能由 MRB 核销流程改动）
    await this.assertNotMrbReserved({ inventoryIds: [inventoryId] });

    let txNo = '';
    let unchanged = false;

    await this.db.transaction(async (tx) => {
      // BUG-016: 事务级咨询锁 —— 同一库存行的调整必须互斥。
      // 仅靠 CAS 无法拦住「后到请求读到的是前一个已提交的新值」这种串行化成功，
      // 因此先用 pg_try_advisory_xact_lock 抢占该库存行的锁：
      //   - 抢到 → 正常调整；
      //   - 抢不到（有并发调整正在进行）→ 立即 409，不排队、不覆盖。
      // 事务结束（提交/回滚）锁自动释放，不会泄漏。
      const lockRes = (await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtext(${inventoryId})::bigint) AS got`,
      )) as unknown as Array<{ got: boolean }>;
      if (!lockRes?.[0]?.got) {
        throw new ConflictException('该库存正在被其他盘点调整操作处理，请稍后重试');
      }

      // BUG-016: 采用「乐观锁 CAS」而非 FOR UPDATE 行锁。
      //
      // 原实现用 lockRow(...FOR UPDATE) 串行化并发请求：后到的事务会读到前一个事务
      // 已提交的新数量，于是 `quantity = 当前值` 的 CAS 守卫永远成立 → 10 个并发全部成功，
      // 后写覆盖前写，且多条流水的 balance_after 与最终实物值无法对齐（账本不可审计）。
      //
      // 改为事务内普通读取 + CAS 守卫「读取到的旧值」：
      //   - 并发中仅第一个请求更新成功；
      //   - 其余请求 WHERE quantity = 旧值 命中 0 行 → 409「已被其他操作变更，请刷新后重试」；
      //   - 因守卫保证数量自读取后未被改动，据此算出的差额与 balance_after 必然准确。
      const invRows = await tx
        .select()
        .from(inventory)
        .where(eq(inventory.id, inventoryId))
        .limit(1);
      const inv = invRows.length > 0 ? (invRows[0] as Record<string, unknown>) : null;
      if (!inv) throw new NotFoundException('库存记录不存在');

      // BUG-017: 锁定（QC 冻结）库存默认不可盘点调整；仅系统管理员可带授权强制调整并留痕
      if (inv.locked === true) {
        if (!params.force) {
          throw new BadRequestException(
            '该批次处于锁定（质检冻结）状态，不可盘点调整；如需强制调整请由系统管理员授权',
          );
        }
        if (!params.forceReason || String(params.forceReason).trim() === '') {
          throw new BadRequestException('强制调整锁定库存必须填写授权原因（留痕可追溯）');
        }
      }

      const currentQty = Number(inv.quantity);
      const diff = actualQty - currentQty;

      // 无差异，直接返回当前库存（不写流水）
      if (diff === 0) {
        unchanged = true;
        return;
      }

      txNo = await this.generateAdjustTxNoWithPrefix(tx, 'ADJ');
      const signedDiff = `${diff > 0 ? '+' : ''}${diff}`;
      const lockNote = inv.locked === true ? `（管理员强制调整锁定库存，授权原因: ${String(params.forceReason).trim()}）` : '';

      // CAS：仅当数量仍为读取到的旧值时更新，防止并发覆盖
      await casUpdate(tx, {
        table: inventory,
        idColumn: inventory.id,
        id: inventoryId,
        set: { quantity: String(actualQty) },
        guard: [sql`${inventory.quantity} = ${String(currentQty)}`],
        conflictMessage: '库存数量已被其他操作变更，请刷新后重试',
      });

      // 插入库存变动记录：balanceAfter 取本次锁内确认的真实结果值，保证账实一致
      await tx.insert(inventoryTransaction).values({
        materialId: inv.materialId as string,
        locationId: inv.locationId as string,
        batchNo: (inv.batchNo as string) ?? null,
        labelNo: (inv.labelNo as string) ?? null,
        stockStatus: inv.stockStatus as string,
        txType: 'adjust',
        txNo,
        qty: String(diff),
        balanceAfter: String(actualQty),
        unit: String(inv.unit ?? ''),
        referenceNo: null,
        remark: `盘点调整 ${signedDiff}，原因: ${reason}${lockNote}`,
        createdBy: operatorId || null,
        updatedBy: operatorId || null,
      });
    });

    return this.getInventoryById(inventoryId);
  }

  private async generateAdjustTxNo(): Promise<string> {
    return this.generateAdjustTxNoWithPrefix(this.db, 'ADJ');
  }

  /** 生成库存流水号：前缀 + 日期 + 全局序列 */
  private async generateAdjustTxNoWithPrefix(db: DbExecutor, prefixBase: string): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `${prefixBase}${dateStr}`;

    const raw = (await db.execute(
      sql`SELECT nextval('seq_adjust_tx_no') AS seq`,
    )) as unknown as Array<{ seq: string }>;
    const seq = Number(raw[0]?.seq ?? 1);

    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  private async getInventoryById(id: string): Promise<Inventory> {
    const result = await this.db
      .select({
        id: inventory.id,
        materialId: inventory.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        locationId: inventory.locationId,
        locationCode: warehouseLocation.locationCode,
        batchNo: inventory.batchNo,
        supplierId: inventory.supplierId,
        supplierName: supplier.supplierName,
        quantity: inventory.quantity,
        unit: inventory.unit,
        stockStatus: inventory.stockStatus,
        productionDate: inventory.productionDate,
        locked: inventory.locked,
        lockReason: inventory.lockReason,
      })
      .from(inventory)
      .innerJoin(material, eq(inventory.materialId, material.id))
      .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
      .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
      .where(eq(inventory.id, id))
      .limit(1);

    if (result.length === 0) throw new NotFoundException('库存记录不存在');

    const row = result[0];
    return {
      ...row,
      quantity: Number(row.quantity),
      productionDate: row.productionDate ?? undefined,
    };
  }
}
