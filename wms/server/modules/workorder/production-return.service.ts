import { Inject, Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, gte, lt, desc, count, sql, inArray } from 'drizzle-orm';
import {
  productionReturn,
  productionReturnIqc,
  material,
  supplier,
} from '@server/database/schema';
import type {
  ProductionReturn,
  ProductionReturnIqc,
  PaginatedResponse,
} from '@shared/api.interface';

@Injectable()
export class ProductionReturnService {
  private readonly logger = new Logger(ProductionReturnService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  // ========== 查询（含 IQC 关联） ==========

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
        createdBy: sql<string>`(${productionReturn.createdBy}).user_id`.as('created_by'),
        updatedAt: productionReturn.updatedAt,
        updatedBy: sql<string>`(${productionReturn.updatedBy}).user_id`.as('updated_by'),
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
      createdBy: row.createdBy ?? undefined,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : undefined,
      updatedBy: row.updatedBy ?? undefined,
      receivedGoodQty: Number(row.receivedGoodQty ?? 0),
      receivedIncomingDefectQty: Number(row.receivedIncomingDefectQty ?? 0),
      receivedOperationDefectQty: Number(row.receivedOperationDefectQty ?? 0),
      iqcResult,
    };
  }

  async getList(params: {
    page: number;
    pageSize: number;
    returnNo?: string;
    materialCode?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PaginatedResponse<ProductionReturn>> {
    const { page, pageSize, returnNo, materialCode, status, startDate, endDate } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (returnNo) conditions.push(like(productionReturn.returnNo, `%${returnNo}%`));
    if (materialCode) conditions.push(like(productionReturn.materialCode, `%${materialCode}%`));
    if (status) conditions.push(eq(productionReturn.status, status));
    if (startDate) conditions.push(gte(productionReturn.createdAt, new Date(startDate)));
    if (endDate) {
      const nextDay = new Date(endDate);
      nextDay.setDate(nextDay.getDate() + 1);
      conditions.push(lt(productionReturn.createdAt, nextDay));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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

  async getDetail(id: string): Promise<ProductionReturn> {
    const rows = await this.buildSelect().where(eq(productionReturn.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException('退料单不存在');
    return this.mapRow(rows[0]);
  }

  // ========== 单号生成 ==========

  /**
   * 取当天单号前缀 + 下一个可用流水号。
   * 批量制单要在一个事务里连续出号，必须「先取种子、再在内存里递增」——
   * 每张单都去查 MAX 的话，事务里刚插入的行还没提交，`this.db` 看不到，会生成重复单号。
   */
  private async nextReturnNoSeed(executor: any = this.db): Promise<{ prefix: string; seq: number }> {
    // 单号格式：TL{yyyyMMdd}{3位流水}，如 TL20261001001（TL=退料，001=当天第一张）
    // 使用本地时区日期（UTC 会在北京时间 0-8 点生成错误日期）
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix = `TL${dateStr}`;
    const result = await executor
      .select({ maxNo: sql<string>`MAX(${productionReturn.returnNo})`.as('max_no') })
      .from(productionReturn)
      .where(like(productionReturn.returnNo, `${prefix}%`));
    const maxNo = result[0]?.maxNo;
    let seq = 1;
    if (maxNo && maxNo.length > prefix.length) {
      const seqPart = maxNo.substring(prefix.length);
      const parsed = parseInt(seqPart, 10);
      if (!isNaN(parsed)) seq = parsed + 1;
    }
    return { prefix, seq };
  }

  private formatReturnNo(prefix: string, seq: number): string {
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }

  private async generateReturnNo(): Promise<string> {
    const { prefix, seq } = await this.nextReturnNoSeed();
    return this.formatReturnNo(prefix, seq);
  }

  // ========== 创建 / 更新 / 提交 / 删除 ==========

  /**
   * 批量制单：一次提交多个料号，每行生成一张独立退料单。
   *
   * 为什么是「一料一单」而不是「一单多行」：production_return 本身就是单料行结构
   * （material_code / quantity 都是列），下游 IQC 报检、入库也按单号逐张走，
   * 所以批量制单 = 一个事务里连续建 N 张草稿单，要么全成要么全不成。
   *
   * 退料原因支持**逐行**：`items[].returnReason` 优先，未传时回落到 body.returnReason
   * （保留单头口径，兼容老调用方）。
   */
  async createBatch(
    body: {
      workOrderNo?: string;
      returnReason?: string;
      items: Array<{
        materialId: string;
        quantity: number;
        productionDate?: string;
        batchNo?: string;
        supplierCode?: string;
        /** 逐行退料原因；不传则用 body.returnReason */
        returnReason?: string;
      }>;
    },
    userId: string,
  ): Promise<ProductionReturn[]> {
    const workOrderNo = String(body?.workOrderNo ?? '').trim();
    const fallbackReason = String(body?.returnReason ?? '').trim();
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!workOrderNo) throw new BadRequestException('请输入工单号');
    if (items.length === 0) throw new BadRequestException('请至少填写一行退料物料');
    if (items.length > 200) throw new BadRequestException('一次最多批量制单 200 行');

    // 每行的最终原因：行内优先，其次单头兜底
    const rowReasons = items.map((it) => String(it?.returnReason ?? '').trim() || fallbackReason);

    // 逐行校验，错误信息带上行号，便于在几十行里定位
    items.forEach((it, idx) => {
      const line = idx + 1;
      if (!it?.materialId) throw new BadRequestException(`第 ${line} 行：请选择物料`);
      if (!it.quantity || Number(it.quantity) <= 0) throw new BadRequestException(`第 ${line} 行：退料数量必须大于0`);
      if (!rowReasons[idx]) throw new BadRequestException(`第 ${line} 行：请选择退料原因`);
    });
    // 同一物料出现多次容易重复退料，直接拦下（不同批次请分行填写并各填批次号）
    const dupCheck = new Set<string>();
    items.forEach((it, idx) => {
      if (dupCheck.has(it.materialId)) {
        throw new BadRequestException(`第 ${idx + 1} 行：物料重复，请合并为一行或删掉多余行`);
      }
      dupCheck.add(it.materialId);
    });

    // 物料主数据一次取全，避免逐行查
    const matIds = Array.from(new Set(items.map((it) => it.materialId)));
    const matRows = await this.db.select().from(material).where(inArray(material.id, matIds));
    const matMap = new Map(matRows.map((m) => [m.id, m]));
    const missing = matIds.filter((id) => !matMap.has(id));
    if (missing.length > 0) throw new NotFoundException(`物料不存在：${missing.join(', ')}`);

    // 供应商代码（行内优先，缺省用物料默认供应商）一次解析完
    const codes = Array.from(
      new Set(
        items
          .map((it) => (it.supplierCode?.trim() || matMap.get(it.materialId)?.supplierCode || '').trim())
          .filter(Boolean),
      ),
    );
    const supRows = codes.length > 0
      ? await this.db.select().from(supplier).where(inArray(supplier.supplierCode, codes))
      : [];
    const supMap = new Map(supRows.map((s) => [s.supplierCode, s]));

    const createdIds = await this.db.transaction(async (tx) => {
      // 串行化当天的出号：并发批量制单各自算 MAX 会撞唯一索引
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wms:production_return:no'))`);
      const seed = await this.nextReturnNoSeed(tx);

      const ids: string[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        const mat = matMap.get(it.materialId)!;
        const code = (it.supplierCode?.trim() || mat.supplierCode || '').trim();
        const sup = code ? supMap.get(code) : undefined;
        // 行号在内存里递增，保证同一批内单号连续且不重复
        const returnNo = this.formatReturnNo(seed.prefix, seed.seq + i);

        const [created] = await tx
          .insert(productionReturn)
          .values({
            returnNo,
            materialId: mat.id,
            materialCode: mat.materialCode,
            materialName: mat.materialName,
            supplierId: sup?.id ?? null,
            supplierCode: sup?.supplierCode ?? (code || null),
            supplierName: sup?.supplierName ?? null,
            quantity: String(it.quantity),
            unit: mat.unit,
            productionDate: it.productionDate || null,
            batchNo: it.batchNo || null,
            returnReason: rowReasons[i] || null,
            workOrderNo,
            status: 'draft',
            createdBy: userId || null,
            updatedBy: userId || null,
          })
          .returning({ id: productionReturn.id });
        ids.push(created.id);
      }
      return ids;
    });

    this.logger.log(`批量制单：工单 ${workOrderNo}，共 ${createdIds.length} 张退料单`);
    return Promise.all(createdIds.map((id) => this.getDetail(id)));
  }

  /** 按供应商代码解析供应商（优先用入参，其次物料默认供应商） */
  private async resolveSupplier(supplierCode?: string | null): Promise<{
    supplierId: string | null;
    supplierCode: string | null;
    supplierName: string | null;
  }> {
    let code = supplierCode?.trim() || null;
    let supplierId: string | null = null;
    let supplierName: string | null = null;
    if (code) {
      const supRows = await this.db
        .select()
        .from(supplier)
        .where(eq(supplier.supplierCode, code))
        .limit(1);
      if (supRows.length > 0) {
        supplierId = supRows[0].id;
        supplierName = supRows[0].supplierName;
      }
    }
    return { supplierId, supplierCode: code, supplierName };
  }

  async create(
    body: {
      materialId: string;
      quantity: number;
      productionDate?: string;
      batchNo?: string;
      returnReason?: string;
      workOrderNo?: string;
      supplierCode?: string;
    },
    userId: string,
  ): Promise<ProductionReturn> {
    const { materialId, quantity, productionDate, batchNo, returnReason, workOrderNo } = body;
    if (!materialId) throw new BadRequestException('请选择物料');
    if (!quantity || quantity <= 0) throw new BadRequestException('退料数量必须大于0');

    const matRows = await this.db
      .select()
      .from(material)
      .where(eq(material.id, materialId))
      .limit(1);
    if (matRows.length === 0) throw new NotFoundException('物料不存在');
    const mat = matRows[0];

    const sup = await this.resolveSupplier(body.supplierCode || mat.supplierCode);

    const returnNo = await this.generateReturnNo();

    const [created] = await this.db
      .insert(productionReturn)
      .values({
        returnNo,
        materialId: mat.id,
        materialCode: mat.materialCode,
        materialName: mat.materialName,
        supplierId: sup.supplierId,
        supplierCode: sup.supplierCode,
        supplierName: sup.supplierName,
        quantity: String(quantity),
        unit: mat.unit,
        productionDate: productionDate || null,
        batchNo: batchNo || null,
        returnReason: returnReason || null,
        workOrderNo: workOrderNo || null,
        status: 'draft',
        createdBy: userId || null,
        updatedBy: userId || null,
      })
      .returning({ id: productionReturn.id });

    return this.getDetail(created.id);
  }

  async update(
    id: string,
    body: {
      materialId?: string;
      quantity?: number;
      productionDate?: string;
      batchNo?: string;
      returnReason?: string;
      workOrderNo?: string;
      supplierCode?: string;
    },
    userId: string,
  ): Promise<ProductionReturn> {
    const rows = await this.db
      .select()
      .from(productionReturn)
      .where(eq(productionReturn.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('退料单不存在');
    const existing = rows[0];
    if (existing.status !== 'draft') {
      throw new BadRequestException('仅草稿状态可编辑');
    }

    const patch: Record<string, any> = { updatedBy: userId || null };

    let materialId = body.materialId;
    if (materialId && materialId !== existing.materialId) {
      const matRows = await this.db
        .select()
        .from(material)
        .where(eq(material.id, materialId))
        .limit(1);
      if (matRows.length === 0) throw new NotFoundException('物料不存在');
      const mat = matRows[0];
      patch.materialId = mat.id;
      patch.materialCode = mat.materialCode;
      patch.materialName = mat.materialName;
      patch.unit = mat.unit;
      const sup = await this.resolveSupplier(body.supplierCode || mat.supplierCode);
      patch.supplierId = sup.supplierId;
      patch.supplierCode = sup.supplierCode;
      patch.supplierName = sup.supplierName;
    } else if (body.supplierCode !== undefined && body.supplierCode !== existing.supplierCode) {
      const sup = await this.resolveSupplier(body.supplierCode);
      patch.supplierId = sup.supplierId;
      patch.supplierCode = sup.supplierCode;
      patch.supplierName = sup.supplierName;
    }

    if (body.quantity !== undefined) {
      if (body.quantity <= 0) throw new BadRequestException('退料数量必须大于0');
      patch.quantity = String(body.quantity);
    }
    if (body.productionDate !== undefined) patch.productionDate = body.productionDate || null;
    if (body.batchNo !== undefined) patch.batchNo = body.batchNo || null;
    if (body.returnReason !== undefined) patch.returnReason = body.returnReason || null;
    if (body.workOrderNo !== undefined) patch.workOrderNo = body.workOrderNo || null;

    await this.db.update(productionReturn).set(patch).where(eq(productionReturn.id, id));
    return this.getDetail(id);
  }

  async submit(id: string, userId: string): Promise<ProductionReturn> {
    const rows = await this.db
      .select()
      .from(productionReturn)
      .where(eq(productionReturn.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('退料单不存在');
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿状态可提交');
    }
    await this.db
      .update(productionReturn)
      .set({ status: 'submitted_iqc', updatedBy: userId || null })
      .where(eq(productionReturn.id, id));
    return this.getDetail(id);
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const rows = await this.db
      .select()
      .from(productionReturn)
      .where(eq(productionReturn.id, id))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('退料单不存在');
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿状态可删除');
    }
    await this.db.delete(productionReturn).where(eq(productionReturn.id, id));
    return { success: true };
  }
}
