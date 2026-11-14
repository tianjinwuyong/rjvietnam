import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, desc, count, like, gte, lt, sql, inArray } from 'drizzle-orm';
import type {
  PaginatedResponse,
  SupplierReturnOrder,
  SupplierReturnItem,
} from '@shared/api.interface';
import {
  supplierReturnOrder,
  supplierReturnItem,
  inventory,
  inventoryTransaction,
  warehouseLocation,
  mrbDisposition,
} from '@server/database/schema';
import { MrbService } from '../mrb/mrb.service';
import { buildReturnLockReason } from '../mrb/mrb.status';
import { requireUuid } from '../../common/utils/cas.util';
import { assertLocationNotFrozen } from '../../common/utils/stocktake-freeze';

export interface SupplierReturnQuery {
  page: number;
  pageSize: number;
  returnNo?: string;
  status?: string;
  supplierCode?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class SupplierReturnService {
  private readonly logger = new Logger(SupplierReturnService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly mrbService: MrbService,
  ) {}

  private toScaled(value: unknown): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 10000);
  }

  private fromScaled(scaled: number): string {
    const n = scaled / 10000;
    return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }

  private mapItem(row: any, locationCode?: string | null): SupplierReturnItem {
    return {
      id: row.id,
      orderId: row.orderId,
      materialId: row.materialId,
      materialCode: row.materialCode ?? undefined,
      materialName: row.materialName ?? undefined,
      batchNo: row.batchNo ?? undefined,
      locationId: row.locationId ?? undefined,
      locationCode: locationCode ?? undefined,
      inventoryId: row.inventoryId ?? undefined,
      quantity: Number(row.quantity),
      outQty: Number(row.outQty),
      unit: row.unit,
      dispositionId: row.dispositionId ?? undefined,
      sortOrder: Number(row.sortOrder || 0),
    };
  }

  private mapOrder(row: any, items?: SupplierReturnItem[]): SupplierReturnOrder {
    return {
      id: row.id,
      returnNo: row.returnNo,
      mrbId: row.mrbId ?? undefined,
      mrbNo: row.mrbNo ?? undefined,
      dispositionId: row.dispositionId ?? undefined,
      supplierId: row.supplierId ?? undefined,
      supplierCode: row.supplierCode ?? undefined,
      supplierName: row.supplierName ?? undefined,
      batchNo: row.batchNo ?? undefined,
      status: row.status,
      totalQty: Number(row.totalQty),
      outQty: Number(row.outQty),
      unit: row.unit,
      outTime: row.outTime instanceof Date ? row.outTime.toISOString() : row.outTime ?? undefined,
      outBy: row.outBy ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt ?? undefined,
      items,
    };
  }

  async listOrders(params: SupplierReturnQuery): Promise<PaginatedResponse<SupplierReturnOrder>> {
    const { page, pageSize } = params;
    const conditions = [];
    if (params.returnNo) conditions.push(like(supplierReturnOrder.returnNo, `%${params.returnNo}%`));
    if (params.status) conditions.push(eq(supplierReturnOrder.status, params.status));
    if (params.supplierCode) conditions.push(like(supplierReturnOrder.supplierCode, `%${params.supplierCode}%`));
    if (params.startDate) conditions.push(gte(supplierReturnOrder.createdAt, new Date(params.startDate)));
    if (params.endDate) conditions.push(lt(supplierReturnOrder.createdAt, new Date(params.endDate)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await this.db
      .select({ count: count() })
      .from(supplierReturnOrder)
      .where(where);
    const total = Number(countResult[0]?.count || 0);

    const rows = await this.db
      .select({
        order: supplierReturnOrder,
        mrbNo: sql<string>`(SELECT mrb_no FROM mrb_review WHERE id = ${supplierReturnOrder.mrbId})`.as('mrb_no'),
      })
      .from(supplierReturnOrder)
      .where(where)
      .orderBy(desc(supplierReturnOrder.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: rows.map((r: any) => this.mapOrder({ ...r.order, mrbNo: r.mrbNo })),
      total,
      page,
      pageSize,
    };
  }

  async getOrderDetail(id: string): Promise<SupplierReturnOrder> {
    const rows = await this.db
      .select({
        order: supplierReturnOrder,
        mrbNo: sql<string>`(SELECT mrb_no FROM mrb_review WHERE id = ${supplierReturnOrder.mrbId})`.as('mrb_no'),
      })
      .from(supplierReturnOrder)
      .where(eq(supplierReturnOrder.id, id))
      .limit(1);

    if (rows.length === 0) throw new NotFoundException('退货单不存在');

    const itemRows = await this.db
      .select({
        item: supplierReturnItem,
        locationCode: warehouseLocation.locationCode,
      })
      .from(supplierReturnItem)
      .leftJoin(warehouseLocation, eq(supplierReturnItem.locationId, warehouseLocation.id))
      .where(eq(supplierReturnItem.orderId, id))
      .orderBy(supplierReturnItem.sortOrder);

    const order = this.mapOrder({ ...rows[0].order, mrbNo: rows[0].mrbNo });
    order.items = itemRows.map((r: any) => this.mapItem(r.item, r.locationCode));
    return order;
  }

  /**
   * 执行退货出库：此刻才真正扣减库存并写流水。
   * 终审阶段只是把库存标记为 returned，实物未离场。
   */
  async confirmOutbound(params: {
    orderId: string;
    operatorId: string;
    remark?: string;
  }): Promise<SupplierReturnOrder> {
    const { orderId, operatorId, remark } = params;
    requireUuid(orderId, '退货单');

    const orderResult = await this.db
      .select()
      .from(supplierReturnOrder)
      .where(eq(supplierReturnOrder.id, orderId))
      .limit(1);
    if (orderResult.length === 0) throw new NotFoundException('退货单不存在');
    const order = orderResult[0];
    if (order.status !== 'pending_out') {
      throw new BadRequestException('仅待出库的退货单可执行出库');
    }

    await this.db.transaction(async (tx) => {
      const cas = await tx
        .update(supplierReturnOrder)
        .set({
          status: 'out',
          outTime: new Date(),
          outBy: operatorId || null,
          remark: remark ?? order.remark,
          updatedBy: operatorId || null,
        })
        .where(and(eq(supplierReturnOrder.id, orderId), eq(supplierReturnOrder.status, 'pending_out')))
        .returning({ id: supplierReturnOrder.id });
      if (cas.length === 0) {
        throw new ConflictException('该退货单已被处理，请刷新后重试');
      }

      const items = await tx
        .select()
        .from(supplierReturnItem)
        .where(eq(supplierReturnItem.orderId, orderId))
        .orderBy(supplierReturnItem.sortOrder);

      let totalOutScaled = 0;
      for (const item of items) {
        let need = this.toScaled(item.quantity) - this.toScaled(item.outQty);
        if (need <= 0) continue;

        // 优先按处置时记录的库存行精确扣减，找不到时再按单号 + 批次兜底匹配。
        //
        // MRB v3 起退货行不再落 `returned`，而是原地 `defective + MRB-RETURN:<mrbNo>`，
        // 由调拨任务搬进不良品仓后仍保持这个标记。所以兜底条件必须认 v3 的口径，
        // 否则一旦 `inventoryId` 因调拨合并而失效，这里会报「待退库存不足」。
        // 库位不能作为兜底条件：调拨任务完成后行已经搬到不良品仓，
        // 而明细里记录的是**处置当时**的库位。
        let rows: any[] = [];
        if (item.inventoryId) {
          rows = await tx.select().from(inventory).where(eq(inventory.id, item.inventoryId));
        }
        if (rows.length === 0) {
          rows = await tx
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.materialId, item.materialId),
                inArray(inventory.stockStatus, ['returned', 'defective']),
                eq(inventory.lockReason, buildReturnLockReason(order.returnNo)),
                item.batchNo ? eq(inventory.batchNo, item.batchNo) : sql`true`,
              ),
            )
            .orderBy(inventory.createdAt);
        }

        const available = rows.reduce((s, r: any) => s + this.toScaled(r.quantity), 0);
        if (available < need) {
          throw new BadRequestException(
            `待退库存不足：物料 ${item.materialCode ?? item.materialId} 需要 ${this.fromScaled(need)}，实际 ${this.fromScaled(available)}`,
          );
        }

        let deducted = 0;
        for (const row of rows) {
          if (need <= 0) break;
          await assertLocationNotFrozen(tx, row.locationId, '退货出库');
          const rowQty = this.toScaled(row.quantity);
          if (rowQty <= 0) continue;
          const take = Math.min(need, rowQty);
          const remain = rowQty - take;

          if (remain === 0) {
            await tx.delete(inventory).where(eq(inventory.id, row.id));
          } else {
            await tx
              .update(inventory)
              .set({ quantity: this.fromScaled(remain) })
              .where(eq(inventory.id, row.id));
          }

          await tx.insert(inventoryTransaction).values({
            materialId: row.materialId,
            locationId: row.locationId,
            batchNo: row.batchNo ?? null,
            labelNo: row.labelNo ?? null,
            stockStatus: 'returned',
            txType: 'mrb_return_out',
            txNo: order.returnNo,
            qty: this.fromScaled(-take),
            balanceAfter: this.fromScaled(remain),
            unit: row.unit ?? 'PCS',
            referenceNo: order.returnNo,
            remark: `退货出库 ${this.fromScaled(take)} ${row.unit ?? 'PCS'}`,
            createdBy: operatorId || null,
            updatedBy: operatorId || null,
          });

          need -= take;
          deducted += take;
        }

        await tx
          .update(supplierReturnItem)
          .set({ outQty: this.fromScaled(this.toScaled(item.outQty) + deducted) })
          .where(eq(supplierReturnItem.id, item.id));

        if (item.dispositionId) {
          await this.mrbService.markDispositionDone(tx, item.dispositionId);
        }
        totalOutScaled += deducted;
      }

      await tx
        .update(supplierReturnOrder)
        .set({ outQty: this.fromScaled(this.toScaled(order.outQty) + totalOutScaled) })
        .where(eq(supplierReturnOrder.id, orderId));
    });

    if (order.mrbId) {
      await this.mrbService.syncExecutionStatus(order.mrbId);
    }

    this.logger.log(`退货出库完成: ${order.returnNo}`);
    return this.getOrderDetail(orderId);
  }

  /** 取消退货单：把库存从「待退」退回不良品状态，并关闭对应处置明细 */
  async cancelOrder(params: {
    orderId: string;
    operatorId: string;
    remark?: string;
  }): Promise<SupplierReturnOrder> {
    const { orderId, operatorId, remark } = params;
    requireUuid(orderId, '退货单');

    const orderResult = await this.db
      .select()
      .from(supplierReturnOrder)
      .where(eq(supplierReturnOrder.id, orderId))
      .limit(1);
    if (orderResult.length === 0) throw new NotFoundException('退货单不存在');
    const order = orderResult[0];
    if (order.status !== 'pending_out') {
      throw new BadRequestException('仅待出库的退货单可取消');
    }

    await this.db.transaction(async (tx) => {
      const cas = await tx
        .update(supplierReturnOrder)
        .set({
          status: 'cancelled',
          remark: remark ?? order.remark,
          updatedBy: operatorId || null,
        })
        .where(and(eq(supplierReturnOrder.id, orderId), eq(supplierReturnOrder.status, 'pending_out')))
        .returning({ id: supplierReturnOrder.id });
      if (cas.length === 0) {
        throw new ConflictException('该退货单已被处理，请刷新后重试');
      }

      const rows = await tx
        .select()
        .from(inventory)
        .where(
          and(
            inArray(inventory.stockStatus, ['returned', 'defective']),
            eq(inventory.lockReason, buildReturnLockReason(order.returnNo)),
          ),
        );

      for (const row of rows) {
        // 先移除待退行，再按不良品状态 upsert（避免撞 inventory 唯一键）
        await assertLocationNotFrozen(tx, row.locationId, '退货取消');
        const qtyScaled = this.toScaled(row.quantity);
        await tx.delete(inventory).where(eq(inventory.id, row.id));
        await this.mrbService.upsertInventoryRow(tx, {
          materialId: row.materialId,
          locationId: row.locationId,
          batchNo: row.batchNo,
          supplierId: row.supplierId,
          stockStatus: 'defective',
          unit: row.unit,
          productionDate: row.productionDate,
          deltaScaled: qtyScaled,
          locked: true,
          lockReason: `退货单 ${order.returnNo} 已取消`,
        });

        await tx.insert(inventoryTransaction).values({
          materialId: row.materialId,
          locationId: row.locationId,
          batchNo: row.batchNo ?? null,
          labelNo: row.labelNo ?? null,
          stockStatus: 'defective',
          txType: 'mrb_return_cancel',
          txNo: order.returnNo,
          qty: '0',
          balanceAfter: String(row.quantity ?? '0'),
          unit: row.unit ?? 'PCS',
          referenceNo: order.returnNo,
          remark: '退货单取消，库存退回不良品状态',
          createdBy: operatorId || null,
          updatedBy: operatorId || null,
        });
      }

      const items = await tx
        .select({ dispositionId: supplierReturnItem.dispositionId })
        .from(supplierReturnItem)
        .where(eq(supplierReturnItem.orderId, orderId));

      for (const item of items) {
        if (!item.dispositionId) continue;
        await tx
          .update(mrbDisposition)
          .set({ execStatus: 'cancelled', execTime: new Date() })
          .where(eq(mrbDisposition.id, item.dispositionId));
      }
    });

    if (order.mrbId) {
      await this.mrbService.syncExecutionStatus(order.mrbId);
    }

    return this.getOrderDetail(orderId);
  }

  /** 待出库退货单数量（首页/角标用） */
  async getPendingCount(): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(supplierReturnOrder)
      .where(eq(supplierReturnOrder.status, 'pending_out'));
    return Number(result[0]?.count || 0);
  }
}
