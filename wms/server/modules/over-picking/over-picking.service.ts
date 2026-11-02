import { Inject, Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, gte, lt, desc, sql, count, inArray } from 'drizzle-orm';
import { overPickingOrder, overPickingItem, workOrder, material, pickingOrder, pickingOrderItem } from '@server/database/schema';

export interface OverPickingItemInput {
  materialId?: string;
  materialCode?: string;
  quantity: number;
  workSection?: string;
  reason?: string;
}

const CREATE_ROLES = ['admin', 'production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'];
const APPROVE_ROLES = ['admin', 'production_manager'];

@Injectable()
export class OverPickingService {
  private readonly logger = new Logger(OverPickingService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private async generateOrderNo(): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `CB${datePart}`;
    const result = await this.db.execute<{ seq: string }>(
      sql`SELECT nextval('seq_over_picking_no') AS seq`,
    );
    const seq = Number(result[0]?.seq ?? 1);
    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  private mapOrderRow(row: any) {
    return {
      id: row.id,
      orderNo: row.orderNo,
      workOrderId: row.workOrderId,
      workOrderNo: row.workOrderNo,
      status: row.status,
      totalQty: Number(row.totalQty || 0),
      totalAmount: Number(row.totalAmount || 0),
      applicantId: row.applicantId,
      applicantName: row.applicantName ?? undefined,
      approverName: row.approverName ?? undefined,
      approvalTime: row.approvalTime
        ? (row.approvalTime instanceof Date ? row.approvalTime.toISOString() : row.approvalTime)
        : undefined,
      approvalRemark: row.approvalRemark ?? undefined,
      oaInstanceId: row.oaInstanceId ?? undefined,
      oaStatus: row.oaStatus ?? undefined,
      pickingId: row.pickingId ?? undefined,
      pickingNo: row.pickingNo ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt ? (row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt) : undefined,
    };
  }

  async createOrder(params: {
    workOrderNo: string;
    items: OverPickingItemInput[];
    remark?: string;
    applicantId: string;
    applicantName?: string;
    applicantRole?: string;
  }) {
    const { workOrderNo, items, remark, applicantId, applicantName } = params;

    if (params.applicantRole && !CREATE_ROLES.includes(params.applicantRole)) {
      throw new ForbiddenException('仅生产物料员可创建超补领料单');
    }
    if (!items || items.length === 0) {
      throw new BadRequestException('请至少录入一行超补物料明细');
    }

    // 1. 校验工单存在
    const woResult = await this.db
      .select({ id: workOrder.id, workOrderNo: workOrder.workOrderNo, status: workOrder.status })
      .from(workOrder)
      .where(eq(workOrder.workOrderNo, workOrderNo))
      .limit(1);
    if (woResult.length === 0) {
      throw new NotFoundException(`工单 ${workOrderNo} 不存在`);
    }
    const wo = woResult[0];
    if (['cancelled', 'closed', 'completed'].includes(wo.status)) {
      throw new BadRequestException(`工单 ${workOrderNo} 状态为 ${wo.status}，不可超补领料`);
    }

    // 2. 解析物料 + 单价（取物料主数据 unitPrice，便于金额统计）
    const materialIds = items.map(i => i.materialId).filter(Boolean) as string[];
    const materialCodes = items.map(i => i.materialCode).filter(Boolean) as string[];
    let matRows: any[] = [];
    if (materialIds.length > 0) {
      matRows = await this.db.select().from(material).where(inArray(material.id, materialIds));
    }
    if (materialCodes.length > 0) {
      const byCode = await this.db.select().from(material).where(inArray(material.materialCode, materialCodes));
      const existIds = new Set(matRows.map(m => m.id));
      for (const m of byCode) if (!existIds.has(m.id)) matRows.push(m);
    }
    const matMap = new Map<string, any>();
    for (const m of matRows) {
      matMap.set(m.id, m);
      matMap.set(m.materialCode, m);
    }

    const itemValues: any[] = [];
    let totalQty = 0;
    let totalAmount = 0;
    for (const [idx, item] of items.entries()) {
      const key = item.materialId || item.materialCode || '';
      const mat = matMap.get(key);
      if (!mat) {
        throw new NotFoundException(`第${idx + 1}行物料不存在`);
      }
      const qty = Number(item.quantity);
      if (!qty || qty <= 0) {
        throw new BadRequestException(`第${idx + 1}行数量必须大于0`);
      }
      const unitPrice = Number(mat.unitPrice || 0);
      const amount = Math.round(qty * unitPrice * 100) / 100;
      totalQty += qty;
      totalAmount += amount;
      itemValues.push({
        materialId: mat.id,
        materialCode: mat.materialCode,
        materialName: mat.materialName,
        specification: mat.specification ?? null,
        unit: mat.unit || 'PCS',
        quantity: String(qty),
        unitPrice: String(unitPrice),
        amount: String(amount),
        workSection: item.workSection || null,
        reason: item.reason || null,
      });
    }
    totalQty = Math.round(totalQty * 100) / 100;
    totalAmount = Math.round(totalAmount * 100) / 100;

    // 3. 创建单据
    const orderNo = await this.generateOrderNo();
    const inserted = await this.db
      .insert(overPickingOrder)
      .values({
        orderNo,
        workOrderId: wo.id,
        workOrderNo: wo.workOrderNo,
        status: 'pending_approval',
        totalQty: String(totalQty),
        totalAmount: String(totalAmount),
        applicantId: applicantId || null,
        applicantName: applicantName || null,
        remark: remark || null,
      })
      .returning({ id: overPickingOrder.id });

    await this.db.insert(overPickingItem).values(
      itemValues.map(v => ({ ...v, orderId: inserted[0].id })),
    );

    return this.getDetail(inserted[0].id);
  }

  async getList(params: {
    page: number;
    pageSize: number;
    orderNo?: string;
    workOrderNo?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { page, pageSize, orderNo, workOrderNo, status, startDate, endDate } = params;
    const conditions = [];
    if (orderNo) conditions.push(like(overPickingOrder.orderNo, `%${orderNo}%`));
    if (workOrderNo) conditions.push(like(overPickingOrder.workOrderNo, `%${workOrderNo}%`));
    if (status) conditions.push(eq(overPickingOrder.status, status));
    if (startDate) conditions.push(gte(overPickingOrder.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lt(overPickingOrder.createdAt, new Date(endDate)));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const countResult = await this.db
      .select({ c: count() })
      .from(overPickingOrder)
      .where(where);
    const total = Number(countResult[0]?.c || 0);

    const rows = await this.db
      .select()
      .from(overPickingOrder)
      .where(where)
      .orderBy(desc(overPickingOrder.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { items: rows.map((r: any) => this.mapOrderRow(r)), total, page, pageSize };
  }

  async getDetail(id: string) {
    const rows = await this.db
      .select()
      .from(overPickingOrder)
      .where(eq(overPickingOrder.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('超补领料单不存在');
    }
    const order = { ...this.mapOrderRow(rows[0]), items: [] as any[] };

    const itemRows = await this.db
      .select()
      .from(overPickingItem)
      .where(eq(overPickingItem.orderId, id));
    order.items = itemRows.map((i: any) => ({
      id: i.id,
      materialId: i.materialId,
      materialCode: i.materialCode,
      materialName: i.materialName,
      specification: i.specification ?? undefined,
      unit: i.unit,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice || 0),
      amount: Number(i.amount || 0),
      workSection: i.workSection ?? undefined,
      reason: i.reason ?? undefined,
    }));
    return order;
  }

  async approveOrder(params: {
    id: string;
    pass: boolean;
    approverId: string;
    approverName?: string;
    approvalRemark?: string;
    approverRole?: string;
  }) {
    const { id, pass, approverId, approverName, approvalRemark } = params;
    if (params.approverRole && !APPROVE_ROLES.includes(params.approverRole)) {
      throw new ForbiddenException('仅生产主管可审批超补领料单');
    }

    const rows = await this.db
      .select()
      .from(overPickingOrder)
      .where(eq(overPickingOrder.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('超补领料单不存在');
    }
    const order = rows[0];
    if (order.status !== 'pending_approval') {
      throw new ConflictException('仅待审批状态的超补领料单可审批');
    }

    if (!pass) {
      await this.db
        .update(overPickingOrder)
        .set({
          status: 'rejected',
          approverId: approverId || null,
          approverName: approverName || null,
          approvalTime: new Date(),
          approvalRemark: approvalRemark || null,
          updatedAt: new Date(),
        })
        .where(eq(overPickingOrder.id, id));
      return this.getDetail(id);
    }

    // 审批通过：生成超补领料单（isSupplement=true，状态直接 approved 可领料）
    const items = await this.db
      .select()
      .from(overPickingItem)
      .where(eq(overPickingItem.orderId, id));
    if (items.length === 0) {
      throw new BadRequestException('超补领料单无物料明细，不可审批');
    }

    // 工段：取明细中最常见的工段，缺省 smt
    const sectionCount = new Map<string, number>();
    for (const it of items as any[]) {
      if (it.workSection) sectionCount.set(it.workSection, (sectionCount.get(it.workSection) || 0) + 1);
    }
    let workSection = 'smt';
    let maxCnt = 0;
    for (const [sec, cnt] of sectionCount.entries()) {
      if (cnt > maxCnt) { workSection = sec; maxCnt = cnt; }
    }

    // 领料单号：沿用 seq_picking_no 序列生成 OP 前缀超补领料单号
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const pickingNoPrefix = `PK${dateStr}`;
    const lastPicking = await this.db
      .execute(sql`SELECT picking_no FROM picking_order WHERE picking_no LIKE ${pickingNoPrefix + '%'} ORDER BY picking_no DESC LIMIT 1`);
    let seq = 1;
    if (lastPicking.length > 0) {
      const lastSeq = parseInt(String((lastPicking[0] as any).picking_no).slice(pickingNoPrefix.length), 10);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }
    const pickingNo = `${pickingNoPrefix}${seq.toString().padStart(4, '0')}`;
    const totalQty = items.reduce((s: number, i: any) => s + Number(i.quantity || 0), 0);

    let pickingId: string | undefined;
    await this.db.transaction(async (tx) => {
      const picking = await tx
        .insert(pickingOrder)
        .values({
          pickingNo,
          workOrderId: order.workOrderId,
          workSection,
          isSupplement: true,
          totalQty: String(Math.round(totalQty * 100) / 100),
          status: 'approved',
          applicantId: order.applicantId,
          approverId: approverId || null,
          approvalTime: new Date(),
          approvalRemark: approvalRemark || `超补领料单 ${order.orderNo} 审批生效`,
          remark: `超补领料单 ${order.orderNo}`,
        })
        .returning({ id: pickingOrder.id });
      pickingId = picking[0].id;

      await tx.insert(pickingOrderItem).values(
        (items as any[]).map(it => ({
          pickingId: pickingId!,
          materialId: it.materialId,
          materialCode: it.materialCode,
          materialName: it.materialName,
          unit: it.unit || 'PCS',
          pickQty: String(it.quantity),
          actualQty: '0',
        })),
      );

      await tx
        .update(overPickingOrder)
        .set({
          status: 'approved',
          approverId: approverId || null,
          approverName: approverName || null,
          approvalTime: new Date(),
          approvalRemark: approvalRemark || null,
          pickingId: pickingId!,
          pickingNo,
          updatedAt: new Date(),
        })
        .where(eq(overPickingOrder.id, id));
    });

    return this.getDetail(id);
  }

  async cancelOrder(params: { id: string; userId: string; userRole?: string }) {
    const { id, userId } = params;
    const rows = await this.db
      .select()
      .from(overPickingOrder)
      .where(eq(overPickingOrder.id, id))
      .limit(1);
    if (rows.length === 0) {
      throw new NotFoundException('超补领料单不存在');
    }
    const order = rows[0];
    if (order.status !== 'pending_approval') {
      throw new ConflictException('仅待审批状态的超补领料单可取消');
    }
    const isOwner = (order as any).applicantId?.user_id === userId || (order as any).applicantId === userId;
    if (!isOwner && params.userRole !== 'admin') {
      throw new ForbiddenException('仅创建人或管理员可取消');
    }
    await this.db
      .update(overPickingOrder)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(overPickingOrder.id, id));
    return this.getDetail(id);
  }

  /** 超补金额/数量统计（按日期范围），用于超补比例和金额分析 */
  async getStats(params: { startDate?: string; endDate?: string }) {
    const conditions = [eq(overPickingOrder.status, 'approved')];
    if (params.startDate) conditions.push(gte(overPickingOrder.createdAt, new Date(params.startDate)));
    if (params.endDate) conditions.push(lt(overPickingOrder.createdAt, new Date(params.endDate)));
    const where = and(...conditions);

    const summary = await this.db
      .select({
        orderCount: count(),
        totalQty: sql<string>`COALESCE(SUM(${overPickingOrder.totalQty}), 0)`,
        totalAmount: sql<string>`COALESCE(SUM(${overPickingOrder.totalAmount}), 0)`,
      })
      .from(overPickingOrder)
      .where(where);

    const byWorkOrder = await this.db
      .select({
        workOrderNo: overPickingOrder.workOrderNo,
        orderCount: count(),
        totalQty: sql<string>`COALESCE(SUM(${overPickingOrder.totalQty}), 0)`,
        totalAmount: sql<string>`COALESCE(SUM(${overPickingOrder.totalAmount}), 0)`,
      })
      .from(overPickingOrder)
      .where(where)
      .groupBy(overPickingOrder.workOrderNo)
      .orderBy(desc(sql`SUM(${overPickingOrder.totalAmount})`))
      .limit(50);

    return {
      orderCount: Number(summary[0]?.orderCount || 0),
      totalQty: Number(summary[0]?.totalQty || 0),
      totalAmount: Number(summary[0]?.totalAmount || 0),
      byWorkOrder: byWorkOrder.map((r: any) => ({
        workOrderNo: r.workOrderNo,
        orderCount: Number(r.orderCount),
        totalQty: Number(r.totalQty),
        totalAmount: Number(r.totalAmount),
      })),
    };
  }
}
