import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, desc, count, like, sql } from 'drizzle-orm';
import type { PaginatedResponse, ReworkOrder } from '@shared/api.interface';
import {
  reworkOrder,
  inventory,
  inventoryTransaction,
  warehouseLocation,
  mrbDisposition,
} from '@server/database/schema';
import { MrbService } from '../mrb/mrb.service';
import { NoticeService } from '../notice/notice.service';

export interface ReworkQuery {
  page: number;
  pageSize: number;
  reworkNo?: string;
  status?: string;
  materialCode?: string;
}

@Injectable()
export class ReworkService {
  private readonly logger = new Logger(ReworkService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly mrbService: MrbService,
    private readonly noticeService: NoticeService,
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

  private mapOrder(row: any, codes?: {
    mrbNo?: string | null;
    sourceLocationCode?: string | null;
    targetLocationCode?: string | null;
  }): ReworkOrder {
    const toIso = (v: any) => (v instanceof Date ? v.toISOString() : v ?? undefined);
    return {
      id: row.id,
      reworkNo: row.reworkNo,
      mrbId: row.mrbId ?? undefined,
      mrbNo: codes?.mrbNo ?? undefined,
      dispositionId: row.dispositionId ?? undefined,
      materialId: row.materialId,
      materialCode: row.materialCode ?? undefined,
      materialName: row.materialName ?? undefined,
      supplierId: row.supplierId ?? undefined,
      supplierCode: row.supplierCode ?? undefined,
      supplierName: row.supplierName ?? undefined,
      batchNo: row.batchNo ?? undefined,
      quantity: Number(row.quantity),
      unit: row.unit,
      status: row.status,
      sourceLocationId: row.sourceLocationId ?? undefined,
      sourceLocationCode: codes?.sourceLocationCode ?? undefined,
      targetLocationId: row.targetLocationId ?? undefined,
      targetLocationCode: codes?.targetLocationCode ?? undefined,
      finishTime: toIso(row.finishTime),
      finishBy: row.finishBy ?? undefined,
      finishRemark: row.finishRemark ?? undefined,
      reinspectTime: toIso(row.reinspectTime),
      reinspectBy: row.reinspectBy ?? undefined,
      reinspectResult: row.reinspectResult ?? undefined,
      reinspectRemark: row.reinspectRemark ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: toIso(row.createdAt),
    };
  }

  async listOrders(params: ReworkQuery): Promise<PaginatedResponse<ReworkOrder>> {
    const { page, pageSize } = params;
    const conditions = [];
    if (params.reworkNo) conditions.push(like(reworkOrder.reworkNo, `%${params.reworkNo}%`));
    if (params.status) conditions.push(eq(reworkOrder.status, params.status));
    if (params.materialCode) conditions.push(like(reworkOrder.materialCode, `%${params.materialCode}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await this.db.select({ count: count() }).from(reworkOrder).where(where);
    const total = Number(countResult[0]?.count || 0);

    const rows = await this.db
      .select({
        order: reworkOrder,
        mrbNo: sql<string>`(SELECT mrb_no FROM mrb_review WHERE id = ${reworkOrder.mrbId})`.as('mrb_no'),
        sourceLocationCode: sql<string>`(SELECT location_code FROM warehouse_location WHERE id = ${reworkOrder.sourceLocationId})`.as('src_code'),
        targetLocationCode: sql<string>`(SELECT location_code FROM warehouse_location WHERE id = ${reworkOrder.targetLocationId})`.as('tgt_code'),
      })
      .from(reworkOrder)
      .where(where)
      .orderBy(desc(reworkOrder.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: rows.map((r: any) =>
        this.mapOrder(r.order, {
          mrbNo: r.mrbNo,
          sourceLocationCode: r.sourceLocationCode,
          targetLocationCode: r.targetLocationCode,
        }),
      ),
      total,
      page,
      pageSize,
    };
  }

  async getOrderDetail(id: string): Promise<ReworkOrder> {
    const rows = await this.db
      .select({
        order: reworkOrder,
        mrbNo: sql<string>`(SELECT mrb_no FROM mrb_review WHERE id = ${reworkOrder.mrbId})`.as('mrb_no'),
        sourceLocationCode: sql<string>`(SELECT location_code FROM warehouse_location WHERE id = ${reworkOrder.sourceLocationId})`.as('src_code'),
        targetLocationCode: sql<string>`(SELECT location_code FROM warehouse_location WHERE id = ${reworkOrder.targetLocationId})`.as('tgt_code'),
      })
      .from(reworkOrder)
      .where(eq(reworkOrder.id, id))
      .limit(1);

    if (rows.length === 0) throw new NotFoundException('返工单不存在');
    return this.mapOrder(rows[0].order, {
      mrbNo: rows[0].mrbNo,
      sourceLocationCode: rows[0].sourceLocationCode,
      targetLocationCode: rows[0].targetLocationCode,
    });
  }

  /** 开始返工 */
  async startRework(params: {
    id: string;
    operatorId: string;
    remark?: string;
  }): Promise<ReworkOrder> {
    const order = await this.getRawOrder(params.id);
    if (order.status !== 'pending') {
      throw new BadRequestException('仅待返工的返工单可开始返工');
    }
    const cas = await this.db
      .update(reworkOrder)
      .set({ status: 'reworking', remark: params.remark ?? order.remark, updatedBy: params.operatorId || null })
      .where(and(eq(reworkOrder.id, params.id), eq(reworkOrder.status, 'pending')))
      .returning({ id: reworkOrder.id });
    if (cas.length === 0) throw new ConflictException('返工单状态已变更，请刷新后重试');
    return this.getOrderDetail(params.id);
  }

  /**
   * 返工完工 → 待 IQC 复检。
   *
   * 这个动作在业务上是「**SQE 确认供应商已完成返工**」，不是仓管随手点完成：
   * 只有 SQE 跟供应商对过货、确认返工真的做完，才能把货交给 IQC 复检。
   * 角色口径在控制器上锁定（sqe / quality_manager / admin），`finish_by` 即 SQE 签认留痕。
   *
   * 确认成功的副作用：给本批原检验员 + IQC 主管发站内消息。
   * 消息必须和状态变更在**同一事务**里：否则会出现「单子已到待复检、IQC 却从没收到通知」
   * 的静默卡单——货躺在返工状态里既不能发料、也没人知道要复检。
   */
  async finishRework(params: {
    id: string;
    operatorId: string;
    remark?: string;
  }): Promise<ReworkOrder> {
    const order = await this.getRawOrder(params.id);
    if (!['pending', 'reworking'].includes(order.status)) {
      throw new BadRequestException('仅待返工/返工中的返工单可确认完成');
    }

    await this.db.transaction(async (tx) => {
      const cas = await tx
        .update(reworkOrder)
        .set({
          status: 'pending_reinspect',
          finishTime: new Date(),
          finishBy: params.operatorId || null,
          finishRemark: params.remark ?? null,
          updatedBy: params.operatorId || null,
        })
        .where(and(eq(reworkOrder.id, params.id), eq(reworkOrder.status, order.status)))
        .returning({ id: reworkOrder.id });
      if (cas.length === 0) {
        throw new ConflictException('返工单状态已变更，请刷新后重试');
      }

      await this.notifyIqcForReinspect(tx, order, params.operatorId);
    });

    this.logger.log(`SQE 确认返工完成: ${order.reworkNo}，已通知 IQC 复检`);
    return this.getOrderDetail(params.id);
  }

  /**
   * 通知 IQC 复检：本批实际检验员 + 全部 IQC 主管。
   *
   * 为什么带主管兜底：检验员可能休假/离职，只发一个人必然卡单；
   * 为什么不全员广播检验员：会变成「人人收到、人人以为别人做」，反而没人做。
   */
  private async notifyIqcForReinspect(tx: any, order: any, operatorId: string): Promise<void> {
    const recipients = await this.resolveIqcRecipients(order.mrbId);
    if (recipients.length === 0) {
      this.logger.warn(`返工单 ${order.reworkNo} 未找到 IQC 收件人，复检通知未发出`);
      return;
    }

    const mrbNo = await this.mrbNoOf(order.mrbId);
    const operatorName = await this.accountName(operatorId);

    const content = [
      `物料：${[order.materialCode, order.materialName].filter(Boolean).join(' ')}`.trim(),
      `批次：${order.batchNo || '-'}`,
      `数量：${order.quantity} ${order.unit}`,
      mrbNo ? `MRB：${mrbNo}` : '',
      `SQE：${operatorName || '-'}`,
      order.finishRemark ? `返工说明：${order.finishRemark}` : '',
      '请到「MRB → 返工单」做复检确认；确认合格后系统自动解锁，库存可发料。',
    ]
      .filter(Boolean)
      .join('\n');

    await this.noticeService.pushMany(
      {
        userIds: recipients,
        title: `返工完成待复检：${order.reworkNo}`,
        content,
        bizType: 'rework',
        bizId: order.id,
        bizNo: order.reworkNo,
        createdBy: operatorId || null,
      },
      tx,
    );
  }

  /** 本批实际检验员 + 全部启用中的 IQC 主管；都没有时退回全部 IQC 检验员 */
  private async resolveIqcRecipients(mrbId: string | null): Promise<string[]> {
    const ids = new Set<string>();

    if (mrbId) {
      const rows = await this.db.execute(sql`
        SELECT ((l.inspector_id).user_id)::text AS user_id
        FROM mrb_review m
        JOIN iqc_lot l ON l.id = m.lot_id
        WHERE m.id = ${mrbId}::uuid
          AND l.inspector_id IS NOT NULL
      `);
      for (const r of rows as unknown as Array<Record<string, any>>) {
        if (r.user_id) ids.add(r.user_id);
      }
    }

    const managers = await this.db.execute(sql`
      SELECT id::text AS user_id FROM sys_account
      WHERE role_code = 'iqc_manager' AND status = 'active'
    `);
    for (const r of managers as unknown as Array<Record<string, any>>) {
      if (r.user_id) ids.add(r.user_id);
    }

    if (ids.size === 0) {
      const inspectors = await this.db.execute(sql`
        SELECT id::text AS user_id FROM sys_account
        WHERE role_code = 'iqc_inspector' AND status = 'active'
      `);
      for (const r of inspectors as unknown as Array<Record<string, any>>) {
        if (r.user_id) ids.add(r.user_id);
      }
    }

    return [...ids];
  }

  /**
   * 复检回执：通知签认的 SQE。
   * 不合格时同时通知质量经理——复检不合格意味着这批货又要走 MRB，
   * 质量经理是 MRB 终审人，提前知情比事后再补材料有效。
   */
  private async notifyAfterReinspect(
    order: any,
    result: 'pass' | 'fail',
    operatorId: string,
  ): Promise<void> {
    const recipients = await this.resolveSqeRecipients(order.id, result === 'fail');
    if (recipients.length === 0) return;

    const operatorName = await this.accountName(operatorId);
    const mrbNo = await this.mrbNoOf(order.mrbId);
    const qty = `${order.quantity} ${order.unit}`;

    const content =
      result === 'pass'
        ? [
            `物料：${[order.materialCode, order.materialName].filter(Boolean).join(' ')}`.trim(),
            `批次：${order.batchNo || '-'}`,
            `数量：${qty}`,
            mrbNo ? `MRB：${mrbNo}` : '',
            `复检：合格（${operatorName || '-'}）`,
            '库存已解除锁定，可在发料环节正常拣用。',
          ]
            .filter(Boolean)
            .join('\n')
        : [
            `物料：${[order.materialCode, order.materialName].filter(Boolean).join(' ')}`.trim(),
            `批次：${order.batchNo || '-'}`,
            `数量：${qty}`,
            mrbNo ? `MRB：${mrbNo}` : '',
            `复检：不合格（${operatorName || '-'}）`,
            order.reinspectRemark ? `说明：${order.reinspectRemark}` : '',
            '库存已退回不良品状态并锁定，请重新发起 MRB 处理。',
          ]
            .filter(Boolean)
            .join('\n');

    await this.noticeService.pushMany({
      userIds: recipients,
      title: result === 'pass' ? `返工复检合格：${order.reworkNo}` : `返工复检不合格：${order.reworkNo}`,
      content,
      bizType: 'rework',
      bizId: order.id,
      bizNo: order.reworkNo,
      createdBy: operatorId || null,
    });
  }

  /** 返工单的 SQE 签认人；签认人缺失时退回全部 SQE（避免单子没人接） */
  private async resolveSqeRecipients(reworkId: string, withQualityManager: boolean): Promise<string[]> {
    const ids = new Set<string>();

    const signer = await this.db.execute(sql`
      SELECT ((finish_by).user_id)::text AS user_id FROM rework_order WHERE id = ${reworkId}::uuid
    `);
    const signerId = (signer as unknown as Array<Record<string, any>>)[0]?.user_id;
    if (signerId) ids.add(signerId);

    if (!signerId) {
      const sqes = await this.db.execute(sql`
        SELECT id::text AS user_id FROM sys_account WHERE role_code = 'sqe' AND status = 'active'
      `);
      for (const r of sqes as unknown as Array<Record<string, any>>) {
        if (r.user_id) ids.add(r.user_id);
      }
    }

    if (withQualityManager) {
      const qms = await this.db.execute(sql`
        SELECT id::text AS user_id FROM sys_account
        WHERE role_code = 'quality_manager' AND status = 'active'
      `);
      for (const r of qms as unknown as Array<Record<string, any>>) {
        if (r.user_id) ids.add(r.user_id);
      }
    }

    return [...ids];
  }

  private async mrbNoOf(mrbId: string | null): Promise<string | null> {
    if (!mrbId) return null;
    const rows = await this.db.execute(sql`
      SELECT mrb_no FROM mrb_review WHERE id = ${mrbId}::uuid
    `);
    return (rows as unknown as Array<Record<string, any>>)[0]?.mrb_no ?? null;
  }

  private async accountName(userId: string): Promise<string> {
    if (!userId) return '';
    const rows = await this.db.execute(sql`
      SELECT name FROM sys_account WHERE id = ${userId}::uuid
    `);
    return (rows as unknown as Array<Record<string, any>>)[0]?.name ?? '';
  }

  /**
   * IQC 复检确认（`pending_reinspect → passed / failed`）。
   *
   * 这是「系统解锁」的唯一触发点：
   *  - pass：返工库存并入良品仓，`good + locked=false` → 发料环节立刻能拣到；
   *  - fail：退回不良品状态并锁定 → 由 SQE 重新发起 MRB。
   *
   * 复检结论一旦提交就动了库存，因此**不做静默重试**；回执通知失败只记日志，
   * 不能因为消息没发出去就把已经解封的货再锁回去。
   */
  async reinspect(params: {
    id: string;
    operatorId: string;
    result: 'pass' | 'fail';
    remark?: string;
  }): Promise<ReworkOrder> {
    const { id, operatorId, result, remark } = params;
    const order = await this.getRawOrder(id);
    if (order.status !== 'pending_reinspect') {
      throw new BadRequestException('仅待 IQC 复检的返工单可提交复检结论');
    }

    const goodLoc = result === 'pass' ? await this.mrbService.getGoodWarehouseLocation() : null;

    await this.db.transaction(async (tx) => {
      const cas = await tx
        .update(reworkOrder)
        .set({
          status: result === 'pass' ? 'passed' : 'failed',
          reinspectTime: new Date(),
          reinspectBy: operatorId || null,
          reinspectResult: result,
          reinspectRemark: remark ?? null,
          targetLocationId: goodLoc?.id ?? null,
          updatedBy: operatorId || null,
        })
        .where(and(eq(reworkOrder.id, id), eq(reworkOrder.status, 'pending_reinspect')))
        .returning({ id: reworkOrder.id });
      if (cas.length === 0) {
        throw new ConflictException('返工单状态已变更，请刷新后重试');
      }

      // 通过 lockReason = 返工单号 精确定位这批返工库存
      const rows = await tx
        .select()
        .from(inventory)
        .where(
          and(
            eq(inventory.materialId, order.materialId),
            eq(inventory.stockStatus, 'rework'),
            eq(inventory.lockReason, order.reworkNo),
          ),
        )
        .orderBy(inventory.createdAt);

      if (rows.length === 0) {
        throw new BadRequestException('未找到该返工单对应的返工库存');
      }

      const totalScaled = rows.reduce((s, r: any) => s + this.toScaled(r.quantity), 0);

      for (const row of rows) {
        const qtyScaled = this.toScaled(row.quantity);

        // 先移除返工行，再按目标状态 upsert：
        // inventory 在 (物料+库位+批次+状态) 上有唯一约束，直接改库位/状态可能撞键。
        await tx.delete(inventory).where(eq(inventory.id, row.id));

        if (result === 'pass') {
          // 目标良品行若已被**其它原因**锁定（手工锁定 / MRB 其他处置等），
          // 不能因为返工放行就顺手把它解锁——那是别人的占用，不是这张返工单的。
          const existingGood = await tx
            .select({
              id: inventory.id,
              locked: inventory.locked,
              lockReason: inventory.lockReason,
            })
            .from(inventory)
            .where(
              and(
                eq(inventory.materialId, row.materialId),
                eq(inventory.locationId, goodLoc!.id),
                eq(inventory.batchNo, row.batchNo ?? ''),
                eq(inventory.stockStatus, 'good'),
              ),
            )
            .limit(1);

          const hasForeignLock = existingGood.length > 0 && existingGood[0].locked;

          const dest = await this.mrbService.upsertInventoryRow(tx, {
            materialId: row.materialId,
            locationId: goodLoc!.id,
            batchNo: row.batchNo,
            supplierId: row.supplierId,
            stockStatus: 'good',
            unit: row.unit,
            productionDate: row.productionDate,
            deltaScaled: qtyScaled,
            locked: hasForeignLock,
            lockReason: hasForeignLock ? existingGood[0].lockReason : null,
          });

          await tx.insert(inventoryTransaction).values({
            materialId: row.materialId,
            locationId: goodLoc!.id,
            batchNo: row.batchNo ?? null,
            labelNo: row.labelNo ?? null,
            stockStatus: 'good',
            txType: 'rework_in',
            txNo: order.reworkNo,
            qty: this.fromScaled(qtyScaled),
            balanceAfter: this.fromScaled(dest.quantityScaled),
            unit: row.unit ?? 'PCS',
            referenceNo: order.reworkNo,
            remark: `返工完成重检合格，转入良品仓 ${this.fromScaled(qtyScaled)}`,
            createdBy: operatorId || null,
            updatedBy: operatorId || null,
          });
        } else {
          const dest = await this.mrbService.upsertInventoryRow(tx, {
            materialId: row.materialId,
            locationId: row.locationId,
            batchNo: row.batchNo,
            supplierId: row.supplierId,
            stockStatus: 'defective',
            unit: row.unit,
            productionDate: row.productionDate,
            deltaScaled: qtyScaled,
            locked: true,
            lockReason: `返工重检不合格（${order.reworkNo}）`,
          });

          await tx.insert(inventoryTransaction).values({
            materialId: row.materialId,
            locationId: row.locationId,
            batchNo: row.batchNo ?? null,
            labelNo: row.labelNo ?? null,
            stockStatus: 'defective',
            txType: 'rework_fail',
            txNo: order.reworkNo,
            qty: '0',
            balanceAfter: this.fromScaled(dest.quantityScaled),
            unit: row.unit ?? 'PCS',
            referenceNo: order.reworkNo,
            remark: `返工重检不合格，退回不良品状态 ${this.fromScaled(qtyScaled)}`,
            createdBy: operatorId || null,
            updatedBy: operatorId || null,
          });
        }
      }

      if (order.dispositionId) {
        await this.mrbService.markDispositionDone(tx, order.dispositionId);
      }

      this.logger.log(`返工复检完成: ${order.reworkNo} 结果=${result} 数量=${this.fromScaled(totalScaled)}`);
    });

    if (order.mrbId) {
      await this.mrbService.syncExecutionStatus(order.mrbId);
    }

    // 回执通知：合格=已解锁可发料；不合格=已锁定需重开 MRB。
    // 通知失败不能把已生效的复检结论回滚（库存已经动了），只记日志。
    try {
      await this.notifyAfterReinspect({ ...order, reinspectRemark: remark ?? null }, result, operatorId);
    } catch (e) {
      this.logger.error(`返工复检回执通知失败: ${order.reworkNo}`, e as any);
    }

    return this.getOrderDetail(id);
  }

  private async getRawOrder(id: string) {
    const rows = await this.db.select().from(reworkOrder).where(eq(reworkOrder.id, id)).limit(1);
    if (rows.length === 0) throw new NotFoundException('返工单不存在');
    return rows[0];
  }

  /** 待处理返工单数量 */
  async getPendingCount(): Promise<number> {
    const result = await this.db
      .select({ count: count() })
      .from(reworkOrder)
      .where(eq(reworkOrder.status, 'pending_reinspect'));
    return Number(result[0]?.count || 0);
  }
}
