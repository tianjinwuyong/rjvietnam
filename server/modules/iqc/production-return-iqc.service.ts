import { Inject, Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, gte, lt, desc, count, sql } from 'drizzle-orm';
import {
  productionReturn,
  productionReturnIqc,
} from '@server/database/schema';
import type {
  ProductionReturn,
  ProductionReturnIqc,
  PaginatedResponse,
} from '@shared/api.interface';
import { SupplierDebtService } from '../supplier-debt/supplier-debt.service';

@Injectable()
export class ProductionReturnIqcService {
  private readonly logger = new Logger(ProductionReturnIqcService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly supplierDebtService: SupplierDebtService,
  ) {}

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

  async getDetail(id: string): Promise<ProductionReturn> {
    const rows = await this.buildSelect().where(eq(productionReturn.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException('退料单不存在');
    return this.mapRow(rows[0]);
  }

  async getPendingList(params: {
    page: number;
    pageSize: number;
    returnNo?: string;
    materialCode?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PaginatedResponse<ProductionReturn>> {
    const { page, pageSize, returnNo, materialCode, startDate, endDate } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(productionReturn.status, 'submitted_iqc')];
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

  async inspect(
    id: string,
    body: {
      goodQty: number;
      incomingDefectQty: number;
      operationDefectQty: number;
      inspectorId?: string;
      inspectorName?: string;
      remark?: string;
    },
    userContext: { userId?: string; userName?: string },
  ): Promise<ProductionReturn> {
    const { goodQty, incomingDefectQty, operationDefectQty, remark } = body;
    if (
      typeof goodQty !== 'number' ||
      typeof incomingDefectQty !== 'number' ||
      typeof operationDefectQty !== 'number'
    ) {
      throw new BadRequestException('请提供完整的检验数量');
    }

    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(productionReturn)
        .where(eq(productionReturn.id, id))
        .for('update');
      if (rows.length === 0) throw new NotFoundException('退料单不存在');
      const pr = rows[0];
      if (pr.status !== 'submitted_iqc') {
        throw new BadRequestException('当前状态不允许检验，须为已提交IQC');
      }

      const total = Number(pr.quantity);
      const sum = goodQty + incomingDefectQty + operationDefectQty;
      if (Math.abs(sum - total) > 0.0001) {
        throw new BadRequestException(
          `检验数量之和(${sum})必须等于退料数量(${total})`,
        );
      }

      // 检验员一律以登录身份为准，忽略请求体传入的 inspectorId / inspectorName（防冒名）
      const inspectorId = userContext.userId || '';
      const inspectorName = userContext.userName || '';

      const existing = await tx
        .select()
        .from(productionReturnIqc)
        .where(eq(productionReturnIqc.returnId, id))
        .limit(1);

      if (existing.length > 0) {
        await tx
          .update(productionReturnIqc)
          .set({
            goodQty: String(goodQty),
            incomingDefectQty: String(incomingDefectQty),
            operationDefectQty: String(operationDefectQty),
            inspectorId: inspectorId || null,
            inspectorName: inspectorName || null,
            inspectionTime: new Date(),
            remark: remark || null,
            updatedBy: inspectorId || null,
          })
          .where(eq(productionReturnIqc.id, existing[0].id));
      } else {
        await tx.insert(productionReturnIqc).values({
          returnId: id,
          goodQty: String(goodQty),
          incomingDefectQty: String(incomingDefectQty),
          operationDefectQty: String(operationDefectQty),
          inspectorId: inspectorId || null,
          inspectorName: inspectorName || null,
          inspectionTime: new Date(),
          remark: remark || null,
          createdBy: inspectorId || null,
          updatedBy: inspectorId || null,
        });
      }

      await tx
        .update(productionReturn)
        .set({ status: 'iqc_completed', updatedBy: inspectorId || null })
        .where(eq(productionReturn.id, id));

      // 如果有来料不良，自动创建供应商欠料记录
      if (incomingDefectQty > 0 && pr.supplierId) {
        await this.supplierDebtService.createDebt({
          supplierId: pr.supplierId,
          supplierCode: pr.supplierCode || '',
          supplierName: pr.supplierName || '',
          materialId: pr.materialId,
          materialCode: pr.materialCode,
          materialName: pr.materialName,
          qty: incomingDefectQty,
          sourceType: 'production_return',
          sourceId: id,
          sourceNo: pr.returnNo,
          userId: inspectorId || undefined,
        });
      }

      const detailRows = await tx
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
        .leftJoin(productionReturnIqc, eq(productionReturn.id, productionReturnIqc.returnId))
        .where(eq(productionReturn.id, id))
        .limit(1);

      return this.mapRow(detailRows[0]);
    });
  }
}
