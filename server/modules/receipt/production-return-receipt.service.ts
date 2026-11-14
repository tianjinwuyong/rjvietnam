import { Inject, Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, gte, lt, desc, count, sql } from 'drizzle-orm';
import {
  productionReturn,
  productionReturnIqc,
  productionReturnLabel,
  inventory,
  inventoryTransaction,
  warehouseLocation,
} from '@server/database/schema';
import { INVENTORY_STOCK_CONFLICT_TARGET } from '../../common/db/inventory-conflict';
import { assertLocationNotFrozen } from '../../common/utils/stocktake-freeze';
import type {
  ProductionReturn,
  ProductionReturnIqc,
  ProductionReturnLabel,
  PaginatedResponse,
} from '@shared/api.interface';

type LabelCategory = 'good' | 'incoming_defect' | 'operation_defect';

interface LabelMeta {
  returnId: string;
  category: LabelCategory;
}

@Injectable()
export class ProductionReturnReceiptService {
  private readonly logger = new Logger(ProductionReturnReceiptService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  // ========== 共用查询 ==========

  private buildSelect() {
    return this.db
      .select({
        id: productionReturn.id,
        returnNo: productionReturn.returnNo,
        materialId: productionReturn.materialId,
        materialCode: productionReturn.materialCode,
        materialName: productionReturn.materialName,
        supplierId: productionReturn.supplierId,
        supplierCode: productionReturn.supplierCode,
        supplierName: productionReturn.supplierName,
        quantity: productionReturn.quantity,
        unit: productionReturn.unit,
        productionDate: productionReturn.productionDate,
        batchNo: productionReturn.batchNo,
        returnReason: productionReturn.returnReason,
        workOrderNo: productionReturn.workOrderNo,
        status: productionReturn.status,
        receivedGoodQty: productionReturn.receivedGoodQty,
        receivedIncomingDefectQty: productionReturn.receivedIncomingDefectQty,
        receivedOperationDefectQty: productionReturn.receivedOperationDefectQty,
        createdAt: productionReturn.createdAt,
        updatedAt: productionReturn.updatedAt,
        iqcId: productionReturnIqc.id,
        iqcGoodQty: productionReturnIqc.goodQty,
        iqcIncomingDefectQty: productionReturnIqc.incomingDefectQty,
        iqcOperationDefectQty: productionReturnIqc.operationDefectQty,
        iqcInspectorId: sql<string>`(${productionReturnIqc.inspectorId}).user_id`.as('iqc_inspector_id'),
        iqcInspectorName: productionReturnIqc.inspectorName,
        iqcInspectionTime: productionReturnIqc.inspectionTime,
        iqcRemark: productionReturnIqc.remark,
      })
      .from(productionReturn)
      .leftJoin(productionReturnIqc, eq(productionReturn.id, productionReturnIqc.returnId));
  }

  private mapRow(row: any): ProductionReturn {
    let iqcResult: ProductionReturnIqc | undefined;
    if (row.iqcId) {
      iqcResult = {
        id: row.iqcId,
        returnId: row.id,
        goodQty: Number(row.iqcGoodQty ?? 0),
        incomingDefectQty: Number(row.iqcIncomingDefectQty ?? 0),
        operationDefectQty: Number(row.iqcOperationDefectQty ?? 0),
        inspectorId: row.iqcInspectorId ?? undefined,
        inspectorName: row.iqcInspectorName ?? undefined,
        inspectionTime: row.iqcInspectionTime
          ? new Date(row.iqcInspectionTime).toISOString()
          : undefined,
        remark: row.iqcRemark ?? undefined,
      };
    }
    const productionDate = row.productionDate
      ? (typeof row.productionDate === 'string'
          ? row.productionDate
          : new Date(row.productionDate).toISOString().slice(0, 10))
      : undefined;
    return {
      id: row.id,
      returnNo: row.returnNo,
      materialId: row.materialId,
      materialCode: row.materialCode,
      materialName: row.materialName,
      supplierId: row.supplierId ?? undefined,
      supplierCode: row.supplierCode ?? undefined,
      supplierName: row.supplierName ?? undefined,
      quantity: Number(row.quantity),
      unit: row.unit,
      productionDate,
      batchNo: row.batchNo ?? undefined,
      returnReason: row.returnReason ?? undefined,
      workOrderNo: row.workOrderNo ?? undefined,
      status: row.status,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
      receivedGoodQty: Number(row.receivedGoodQty ?? 0),
      receivedIncomingDefectQty: Number(row.receivedIncomingDefectQty ?? 0),
      receivedOperationDefectQty: Number(row.receivedOperationDefectQty ?? 0),
      iqcResult,
    };
  }

  async getDetail(id: string): Promise<ProductionReturn> {
    const rows = await this.buildSelect().where(eq(productionReturn.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException('退料单不存在');
    return this.mapRow(rows[0]);
  }

  /** 可入库退料单列表：仅 iqc_completed */
  async getList(params: {
    page: number;
    pageSize: number;
    returnNo?: string;
    materialCode?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PaginatedResponse<ProductionReturn>> {
    const { page, pageSize, returnNo, materialCode, startDate, endDate } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(productionReturn.status, 'iqc_completed')];
    if (returnNo) conditions.push(like(productionReturn.returnNo, `%${returnNo}%`));
    if (materialCode) conditions.push(like(productionReturn.materialCode, `%${materialCode}%`));
    if (startDate) conditions.push(gte(productionReturn.createdAt, new Date(startDate)));
    if (endDate) {
      const nextDay = new Date(endDate);
      nextDay.setDate(nextDay.getDate() + 1);
      conditions.push(lt(productionReturn.createdAt, nextDay));
    }
    const whereClause = and(...conditions);

    const [totalResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(productionReturn).where(whereClause),
      this.buildSelect()
        .where(whereClause)
        .orderBy(desc(productionReturn.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    return {
      items: rows.map((r) => this.mapRow(r)),
      total: Number(totalResult[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  // ========== 标签生成 ==========

  /** 本地时区 yyyyMMdd（与退料单号 TL+日期规则保持一致） */
  private localDateStr(d = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }

  /** 取当天已生成标签的最大 3 位流水（流水号规则：TL{yyyyMMdd}{3位流水}） */
  private async nextLabelSeq(datePrefix: string, conn: any): Promise<number> {
    const result = await conn
      .select({ maxNo: sql<string>`MAX(${productionReturnLabel.labelNo})`.as('max_no') })
      .from(productionReturnLabel)
      .where(like(productionReturnLabel.labelNo, `${datePrefix}%`));
    const maxNo = result[0]?.maxNo;
    if (!maxNo) return 1;
    const seqPart = maxNo.slice(datePrefix.length, datePrefix.length + 3);
    const seq = parseInt(seqPart, 10);
    return isNaN(seq) ? 1 : seq + 1;
  }

  async generateLabels(id: string): Promise<ProductionReturnLabel[]> {
    const detail = await this.getDetail(id);
    if (detail.status !== 'iqc_completed') {
      throw new BadRequestException('仅检验完成状态可生成标签');
    }
    if (!detail.iqcResult) {
      throw new BadRequestException('缺少IQC检验结果');
    }

    // 流水号规则：TL{yyyyMMdd}{3位流水}，例如 TL20261001001。
    // 二维码严格保持六段码格式：供应商代码*料号*生产日期*数量*批次*流水号，
    // 仅第 6 段流水号改为短码；类别不编码进流水号，由 production_return_label 表记录，
    // 入库扫码时后台按第 6 段查表校验。
    const datePrefix = `TL${this.localDateStr()}`;

    const categories: Array<{ category: LabelCategory; qty: number }> = [
      { category: 'good', qty: detail.iqcResult.goodQty },
      { category: 'incoming_defect', qty: detail.iqcResult.incomingDefectQty },
      { category: 'operation_defect', qty: detail.iqcResult.operationDefectQty },
    ];
    const toGenerate = categories.filter((c) => c.qty && c.qty > 0);
    if (toGenerate.length === 0) {
      throw new BadRequestException('IQC检验结果无任何数量，无法生成标签');
    }

    // 事务内取流水并写入标签表（labelNo 唯一约束兜底并发）
    const supplierCode = detail.supplierCode || '';
    const productionDate = detail.productionDate || '';
    const batchNo = detail.batchNo || '';
    const created = await this.db.transaction(async (tx) => {
      const baseSeq = await this.nextLabelSeq(datePrefix, tx);
      const rows: Array<{ serialNo: string; labelNo: string; category: LabelCategory; qty: number }> = [];
      let seq = baseSeq;
      for (const c of toGenerate) {
        const serialNo = `${datePrefix}${String(seq).padStart(3, '0')}`;
        seq += 1;
        // 六段码格式：供应商代码*料号*生产日期*数量*批次*流水号
        const labelNo = `${supplierCode}*${detail.materialCode}*${productionDate}*${c.qty}*${batchNo}*${serialNo}`;
        rows.push({ serialNo, labelNo, category: c.category, qty: c.qty });
        await tx.insert(productionReturnLabel).values({
          labelNo: serialNo,
          returnId: id,
          category: c.category,
          quantity: String(c.qty),
        });
      }
      return rows;
    });

    return created.map((r) => ({
      labelNo: r.labelNo,
      serialNo: r.serialNo,
      returnNo: detail.returnNo,
      materialCode: detail.materialCode,
      materialName: detail.materialName,
      supplierCode: detail.supplierCode,
      supplierName: detail.supplierName,
      quantity: r.qty,
      stockStatus: r.category,
      productionDate: detail.productionDate,
      batchNo: detail.batchNo,
    }));
  }

  /**
   * 解析扫码内容 → returnId + category
   * 新格式：六段码 供应商*料号*生产日期*数量*批次*流水号，第 6 段为短流水号
   *   TL{yyyyMMdd}{3seq}，查 production_return_label 表获取关联信息；
   * 旧格式兼容：第 6 段为 RT{yyyyMMdd}{6seq}_{returnId}_{category}（信息在码内）；
   * 兼容直接输入短流水号（无 *，手输场景）。
   */
  private async resolveLabel(labelNo: string): Promise<LabelMeta> {
    // 六段码：取第 6 段流水号再解析
    if (labelNo.includes('*')) {
      const parts = labelNo.split('*');
      if (parts.length !== 6) {
        throw new BadRequestException('标签号格式错误，应为六段码格式');
      }
      const serialNo = parts[5];
      // 旧六段码：流水号内含 returnId/category
      if (serialNo.includes('_')) {
        return this.parseLegacySerialNo(serialNo);
      }
      return this.lookupSerialNo(serialNo);
    }
    // 无 *：短流水号直查
    return this.lookupSerialNo(labelNo);
  }

  /** 按短流水号查标签表 */
  private async lookupSerialNo(serialNo: string): Promise<LabelMeta> {
    const rows = await this.db
      .select({
        returnId: productionReturnLabel.returnId,
        category: productionReturnLabel.category,
      })
      .from(productionReturnLabel)
      .where(eq(productionReturnLabel.labelNo, serialNo))
      .limit(1);
    if (rows.length === 0) {
      throw new BadRequestException('标签不存在或无效，请确认扫描的是退料标签');
    }
    return { returnId: rows[0].returnId, category: rows[0].category as LabelCategory };
  }

  /** 旧流水号解析（RT{yyyyMMdd}{6seq}_{returnId}_{category}，历史已打印标签仍可扫码入库） */
  private parseLegacySerialNo(serialNo: string): LabelMeta {
    // 按后缀识别类别，再从剩余部分取 returnId。
    let category: LabelCategory | undefined;
    if (serialNo.endsWith('_good')) category = 'good';
    else if (serialNo.endsWith('_incoming_defect')) category = 'incoming_defect';
    else if (serialNo.endsWith('_operation_defect')) category = 'operation_defect';
    if (!category) {
      throw new BadRequestException('标签类别错误');
    }
    const withoutCategory = serialNo.slice(0, serialNo.length - category.length - 1);
    const serialParts = withoutCategory.split('_');
    if (serialParts.length < 2 || !serialParts[1]) {
      throw new BadRequestException('流水号格式错误');
    }
    const returnId = serialParts[1];
    return { returnId, category };
  }

  private mapStockStatus(category: LabelCategory): 'good' | 'defect' {
    return category === 'good' ? 'good' : 'defect';
  }

  // ========== 扫码入库 ==========

  async scanInbound(
    body: { labelNo: string; locationId: string; quantity?: number },
    userId: string,
  ): Promise<ProductionReturn> {
    const { labelNo, locationId, quantity } = body;
    if (!labelNo) throw new BadRequestException('请扫描标签');
    if (!locationId) throw new BadRequestException('请选择库位');

    const meta = await this.resolveLabel(labelNo);
    // 库存 label_no 列为 varchar(100)：新格式直接存短流水号；
    // 旧六段码兼容格式只存第 6 段流水号（与正常收货入库保持一致）。
    const serialOnly = labelNo.includes('*') ? labelNo.split('*')[5] || labelNo : labelNo;

    const locRows = await this.db
      .select()
      .from(warehouseLocation)
      .where(eq(warehouseLocation.id, locationId))
      .limit(1);
    if (locRows.length === 0) throw new BadRequestException('库位不存在');

    // 强制校验：良品只能入良品仓库，作业不良/来料不良只能入不良品仓库
    const requiredLocType = meta.category === 'good' ? 'good' : 'defective';
    if (locRows[0].locationType !== requiredLocType) {
      throw new BadRequestException(
        meta.category === 'good'
          ? '良品只能入良品仓库，请扫描/选择良品库位'
          : `${meta.category === 'incoming_defect' ? '来料不良' : '作业不良'}属于不良品，只能入不良品仓库，请扫描/选择不良品库位`,
      );
    }

    // 修复：此处不能 `return await`——事务回调返回的 pr.id 会直接成为函数返回值，
    // 导致下方「事务提交后重新查询最新明细」成为不可达死代码（接口只返回 id，
    // 前端拿不到已入库数量/状态，入库进度恒显示 0/0）。
    await this.db.transaction(async (tx) => {
      const prRows = await tx
        .select()
        .from(productionReturn)
        .where(and(eq(productionReturn.id, meta.returnId)))
        .for('update');
      if (prRows.length === 0) throw new NotFoundException('退料单不存在');
      const pr = prRows[0];
      if (pr.status !== 'iqc_completed' && pr.status !== 'received') {
        throw new BadRequestException('当前状态不允许入库');
      }

      const iqcRows = await tx
        .select()
        .from(productionReturnIqc)
        .where(eq(productionReturnIqc.returnId, meta.returnId))
        .limit(1);
      if (iqcRows.length === 0) throw new BadRequestException('缺少IQC检验结果');
      const iqc = iqcRows[0];

      let iqcQty: number;
      let receivedCol: 'receivedGoodQty' | 'receivedIncomingDefectQty' | 'receivedOperationDefectQty';
      if (meta.category === 'good') {
        iqcQty = Number(iqc.goodQty);
        receivedCol = 'receivedGoodQty';
      } else if (meta.category === 'incoming_defect') {
        iqcQty = Number(iqc.incomingDefectQty);
        receivedCol = 'receivedIncomingDefectQty';
      } else {
        iqcQty = Number(iqc.operationDefectQty);
        receivedCol = 'receivedOperationDefectQty';
      }
      const receivedQty = Number(pr[receivedCol] ?? 0);
      const remaining = iqcQty - receivedQty;
      if (remaining <= 0) {
        throw new BadRequestException('该类别已全部入库');
      }

      const inboundQty = quantity && quantity > 0 ? Number(quantity) : remaining;
      if (inboundQty <= 0) throw new BadRequestException('入库数量必须大于0');
      if (inboundQty > remaining + 0.0001) {
        throw new BadRequestException(`入库数量超过待入库数量(${remaining})`);
      }

      const stockStatus = this.mapStockStatus(meta.category);

      // F-01 修复（同类·P0）：库存合并由「SELECT 命中则 UPDATE / 否则 INSERT」的读改写
      // 改为单条原子 UPSERT（与 receipt.service 同源）。原写法在并发入库时会：
      //   (a) 丢失更新（currentQty 无行锁、无 CAS，后写覆盖先写）；(b) 两个并发事务都查不到行 →
      //   都 INSERT → 后者违反唯一索引 inventory_material_id_location_id_batch_no_stock_status_key
      //   → PG 23505 → 被全局过滤器映射为 409 误拒。
      // 现以唯一索引为冲突目标原子累加，并用 RETURNING 取回累加后的最新数量（供库存流水 balanceAfter）。
      // 冲突时只累加数量并刷新 updatedBy，保留既有行的 label_no 等字段（不覆盖）；
      // batchNo 统一走 '' 兜底，保证与唯一索引口径一致（PG 中 NULL 在唯一索引里互不相等会失效）。
      const batchNo = pr.batchNo || '';
      await assertLocationNotFrozen(tx, locationId, '生产退料入库');
      const upserted = await tx
        .insert(inventory)
        .values({
          materialId: pr.materialId,
          locationId,
          batchNo,
          supplierId: pr.supplierId,
          quantity: String(inboundQty),
          unit: pr.unit,
          stockStatus,
          productionDate: pr.productionDate,
          labelNo: serialOnly,
          createdBy: userId || null,
          updatedBy: userId || null,
        })
        .onConflictDoUpdate({
          // 冲突目标 = 库上唯一索引 (material_id, location_id, batch_no, stock_status)
          target: INVENTORY_STOCK_CONFLICT_TARGET,
          set: {
            quantity: sql`${inventory.quantity} + ${String(inboundQty)}::numeric`,
            updatedBy: userId || null,
          },
        })
        .returning({ quantity: inventory.quantity });
      const newQty = Number(upserted[0]?.quantity ?? 0);

      // 库存流水
      await tx.insert(inventoryTransaction).values({
        materialId: pr.materialId,
        locationId,
        batchNo: pr.batchNo,
        labelNo: serialOnly,
        stockStatus,
        txType: 'production_return_in',
        txNo: serialOnly,
        qty: String(inboundQty),
        balanceAfter: String(newQty),
        unit: pr.unit,
        referenceNo: pr.returnNo,
        remark: `产线退料入库 ${meta.category}`,
        createdBy: userId || null,
        updatedBy: userId || null,
      });

      // 更新退料单已入库数量
      const newReceivedQty = receivedQty + inboundQty;
      const patch: Record<string, any> = {
        [receivedCol]: String(newReceivedQty),
        updatedBy: userId || null,
      };

      const totalReceived =
        Number(pr.receivedGoodQty) +
        Number(pr.receivedIncomingDefectQty) +
        Number(pr.receivedOperationDefectQty) +
        inboundQty;
      const totalIqc =
        Number(iqc.goodQty) + Number(iqc.incomingDefectQty) + Number(iqc.operationDefectQty);
      if (totalReceived + 0.0001 >= totalIqc) {
        patch.status = 'received';
      }
      await tx.update(productionReturn).set(patch).where(eq(productionReturn.id, pr.id));
    });
    // 事务提交后重新查询最新明细返回（已入库数量/状态）
    return this.getDetail(meta.returnId);
  }

  // ========== 入库进度 ==========

  async getInboundProgress(id: string): Promise<{
    returnId: string;
    returnNo: string;
    status: string;
    categories: Array<{
      category: LabelCategory;
      iqcQty: number;
      receivedQty: number;
      remainingQty: number;
    }>;
    totalIqcQty: number;
    totalReceivedQty: number;
  }> {
    const detail = await this.getDetail(id);
    if (!detail.iqcResult) throw new BadRequestException('缺少IQC检验结果');

    const iqc = detail.iqcResult;
    const cats = [
      { category: 'good' as LabelCategory, iqcQty: iqc.goodQty, receivedQty: detail.receivedGoodQty ?? 0 },
      { category: 'incoming_defect' as LabelCategory, iqcQty: iqc.incomingDefectQty, receivedQty: detail.receivedIncomingDefectQty ?? 0 },
      { category: 'operation_defect' as LabelCategory, iqcQty: iqc.operationDefectQty, receivedQty: detail.receivedOperationDefectQty ?? 0 },
    ];
    const categories = cats.map((c) => ({
      category: c.category,
      iqcQty: c.iqcQty,
      receivedQty: c.receivedQty,
      remainingQty: Math.max(0, c.iqcQty - c.receivedQty),
    }));
    return {
      returnId: detail.id,
      returnNo: detail.returnNo,
      status: detail.status,
      categories,
      totalIqcQty: iqc.goodQty + iqc.incomingDefectQty + iqc.operationDefectQty,
      totalReceivedQty: categories.reduce((s, c) => s + c.receivedQty, 0),
    };
  }
}
