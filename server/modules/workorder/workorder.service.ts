import { Inject, Injectable, BadRequestException, NotFoundException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, or, ilike, gte, lt, desc, count, sql, inArray } from 'drizzle-orm';
import {
  workOrder,
  bom,
  bomItem,
  materialRequirement,
  materialRequirementItem,
  pickingOrder,
  pickingOrderItem,
  pickingReel,
  inventory,
  warehouseLocation,
  material,
  materialExpiryExtension,
  materialSubstitution,
  supplier,
  inventoryTransaction,
  overPickingOrder,
  overPickingItem,
  sysAccount,
} from '@server/database/schema';
import { assertLocationNotFrozen } from '../../common/utils/stocktake-freeze';
import type {
  WorkOrder,
  MaterialRequirement,
  MaterialRequirementItem,
  PickingOrder,
  PickingOrderItem,
  PaginatedResponse,
  WorkSection,
  TailLabel,
  PickMaterialResult,
} from '@shared/api.interface';

const WORK_SECTIONS: WorkSection[] = ['smt', 'dip', 'assembly', 'packing'];

// BUG-008 修复（2026-09-30 恢复，原修复在 09-24 改版时丢失）：
// BOM 中 workSection 可能为中文/大写/带空格（如 'SMT'、'组装'、'包装'），
// 直接用会导致按工段分组时键名不匹配，工单下发生成 0 张领料单。
// 统一归一化为 smt/dip/assembly/packing 四个合法值，无法识别时默认 'smt'。
const SECTION_ALIAS: Record<string, WorkSection> = {
  贴片: 'smt',
  smt: 'smt',
  插件: 'dip',
  后焊: 'dip',
  dip: 'dip',
  组装: 'assembly',
  装配: 'assembly',
  测试: 'assembly',
  assembly: 'assembly',
  包装: 'packing',
  打包: 'packing',
  packing: 'packing',
};

function normalizeWorkSection(raw: string | null | undefined): WorkSection {
  if (!raw) return 'smt';
  const key = String(raw).trim().toLowerCase();
  return SECTION_ALIAS[key] ?? 'smt';
}

@Injectable()
export class WorkorderService {
  private readonly logger = new Logger(WorkorderService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  // ========== Work Order ==========

  async getWorkOrderList(params: {
    page: number;
    pageSize: number;
    workOrderNo?: string;
    productCode?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
    isSupplement?: boolean;
    parentOrderNo?: string;
  }): Promise<PaginatedResponse<WorkOrder>> {
    const { page, pageSize, workOrderNo, productCode, status, startDate, endDate, isSupplement, parentOrderNo } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (workOrderNo) conditions.push(ilike(workOrder.workOrderNo, `%${workOrderNo}%`));
    if (productCode) conditions.push(ilike(workOrder.productCode, `%${productCode}%`));
    if (status) conditions.push(eq(workOrder.status, status));
    if (startDate) conditions.push(gte(workOrder.workOrderDate, startDate));
    if (endDate) {
      const nextDay = new Date(endDate);
      nextDay.setDate(nextDay.getDate() + 1);
      conditions.push(lt(workOrder.workOrderDate, nextDay.toISOString().split('T')[0]));
    }
    if (isSupplement !== undefined) conditions.push(eq(workOrder.isSupplement, isSupplement));
    if (parentOrderNo) {
      conditions.push(sql`EXISTS (SELECT 1 FROM work_order parent WHERE parent.id = work_order.parent_order_id AND parent.work_order_no ILIKE ${`%${parentOrderNo}%`})`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        id: workOrder.id,
        workOrderNo: workOrder.workOrderNo,
        bomId: workOrder.bomId,
        bomCode: bom.bomCode,
        productCode: workOrder.productCode,
        productName: workOrder.productName,
        planQty: workOrder.planQty,
        actualQty: workOrder.actualQty,
        workOrderDate: workOrder.workOrderDate,
        isSupplement: workOrder.isSupplement,
        parentOrderId: workOrder.parentOrderId,
        parentOrderNo: sql<string>`(
          SELECT p.work_order_no FROM work_order p WHERE p.id = work_order.parent_order_id LIMIT 1
        )`.as('parent_order_no'),
        status: workOrder.status,
        source: workOrder.source,
        mesMoNo: workOrder.mesMoNo,
        mesStatus: workOrder.mesStatus,
        // 是否「由 MES 管控」——前端据此隐藏下发/撤回/结案/取消。
        // 判定口径与 resolveMesControl() 完全一致：有 MES 领料单 → 是；有非 MES 领料单 → 否；
        // 一张领料单都没有时再看工单本身来源。
        mesControlled: sql<boolean>`(
          CASE
            WHEN EXISTS (
              SELECT 1 FROM picking_order p
               WHERE p.work_order_id = ${workOrder.id} AND p.status <> 'cancelled' AND p.source = 'mes'
            ) THEN true
            WHEN EXISTS (
              SELECT 1 FROM picking_order p
               WHERE p.work_order_id = ${workOrder.id} AND p.status <> 'cancelled'
            ) THEN false
            WHEN ${workOrder.source} = 'mes' THEN true
            ELSE false
          END
        )`.as('mes_controlled'),
        plannerId: sql<string>`(${workOrder.plannerId}).user_id`.as('planner_id'),
        plannerName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${workOrder.plannerId}).user_id)::uuid LIMIT 1)`.as('planner_name'),
        remark: workOrder.remark,
      })
      .from(workOrder)
      // 用 leftJoin：MES 同步进来的工单可能没有对应的 WMS BOM（bom_id 为空），
      // 用 innerJoin 会让这类工单在列表里直接消失。
      .leftJoin(bom, eq(workOrder.bomId, bom.id));

    const [totalResult, items] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(workOrder)
        .leftJoin(bom, eq(workOrder.bomId, bom.id))
        .where(whereClause),
      baseQuery
        .where(whereClause)
        .orderBy(desc(workOrder.workOrderDate), desc(workOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: items.map((item) => ({
        ...item,
        planQty: Number(item.planQty),
        actualQty: Number(item.actualQty),
        parentOrderId: item.parentOrderId ?? undefined,
        parentOrderNo: (item as any).parentOrderNo ?? undefined,
        plannerId: item.plannerId ?? undefined,
        plannerName: item.plannerName ?? undefined,
        remark: item.remark ?? undefined,
        source: item.source ?? 'manual',
        mesMoNo: item.mesMoNo ?? undefined,
        mesStatus: item.mesStatus ?? undefined,
        mesControlled: item.mesControlled === true,
      })),
      total,
      page,
      pageSize,
    };
  }

  async createWorkOrder(body: {
    bomId: string;
    planQty: number;
    workOrderDate: string;
    plannerId: string;
    plannerName: string;
    remark?: string;
    /** 自定义工单号：可选，留空则由系统按 WO+日期+流水号 自动生成 */
    workOrderNo?: string;
  }): Promise<WorkOrder> {
    const { bomId, planQty, workOrderDate, plannerId, remark } = body;

    if (planQty <= 0) throw new BadRequestException('计划数量必须大于0');
    // BUG-003 修复：workOrderDate 是 NOT NULL date 列，缺省时原实现会把 '' 透传给数据库导致 500。
    // 这里前置校验，给出明确的 400 提示。
    if (!workOrderDate || String(workOrderDate).trim() === '') {
      throw new BadRequestException('工单日期不能为空');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(workOrderDate).trim())) {
      throw new BadRequestException('工单日期格式应为 YYYY-MM-DD');
    }

    const bomResult = await this.db.select().from(bom).where(eq(bom.id, bomId)).limit(1);
    if (bomResult.length === 0) throw new NotFoundException('BOM不存在');

    // 自定义工单号（可选）：校验长度、字符集与唯一性；留空走自动生成
    const customNo = (body.workOrderNo || '').trim();
    let workOrderNo: string;
    if (customNo) {
      if (customNo.length > 50) throw new BadRequestException('工单号长度不能超过50个字符');
      if (!/^[A-Za-z0-9_-]+$/.test(customNo)) {
        throw new BadRequestException('工单号只能包含字母、数字、中划线或下划线');
      }
      const dup = await this.db
        .select({ id: workOrder.id })
        .from(workOrder)
        .where(eq(workOrder.workOrderNo, customNo))
        .limit(1);
      if (dup.length > 0) throw new ConflictException('工单号已存在');
      workOrderNo = customNo;
    } else {
      workOrderNo = await this.generateWorkOrderNo();
    }

    let created: { id: string };
    try {
      [created] = await this.db.insert(workOrder).values({
        workOrderNo,
        bomId,
        productCode: bomResult[0].productCode,
        productName: bomResult[0].productName,
        planQty: String(planQty),
        workOrderDate,
        isSupplement: false,
        status: 'created',
        plannerId,
        remark,
      }).returning({ id: workOrder.id });
    } catch (e: any) {
      // BUG-006 修复：并发插入同一自定义工单号时唯一索引报错，转为友好提示。
      // 注意 Drizzle 会把 PostgresError 包一层，真实错误码在 e.cause.code，
      // 原实现只判断 e.code === '23505' 永远不成立，导致该场景变成 500。
      const nestedCode = e?.code ?? e?.cause?.code;
      const msg = String(e?.message || '') + String(e?.cause?.message || '');
      if (customNo && (nestedCode === '23505' || /duplicate key|unique/i.test(msg))) {
        throw new ConflictException('工单号已存在');
      }
      throw e;
    }

    return this.getWorkOrderById(created.id);
  }

  async getWorkOrderDetail(id: string): Promise<WorkOrder> {
    return this.getWorkOrderById(id);
  }

  private async getWorkOrderById(id: string): Promise<WorkOrder> {
    const result = await this.db
      .select({
        id: workOrder.id,
        workOrderNo: workOrder.workOrderNo,
        bomId: workOrder.bomId,
        bomCode: bom.bomCode,
        productCode: workOrder.productCode,
        productName: workOrder.productName,
        planQty: workOrder.planQty,
        actualQty: workOrder.actualQty,
        workOrderDate: workOrder.workOrderDate,
        isSupplement: workOrder.isSupplement,
        parentOrderId: workOrder.parentOrderId,
        status: workOrder.status,
        source: workOrder.source,
        mesMoNo: workOrder.mesMoNo,
        mesStatus: workOrder.mesStatus,
        // 是否「由 MES 管控」——前端据此隐藏下发/撤回/结案/取消。
        // 判定口径与 resolveMesControl() 完全一致：有 MES 领料单 → 是；有非 MES 领料单 → 否；
        // 一张领料单都没有时再看工单本身来源。
        mesControlled: sql<boolean>`(
          CASE
            WHEN EXISTS (
              SELECT 1 FROM picking_order p
               WHERE p.work_order_id = ${workOrder.id} AND p.status <> 'cancelled' AND p.source = 'mes'
            ) THEN true
            WHEN EXISTS (
              SELECT 1 FROM picking_order p
               WHERE p.work_order_id = ${workOrder.id} AND p.status <> 'cancelled'
            ) THEN false
            WHEN ${workOrder.source} = 'mes' THEN true
            ELSE false
          END
        )`.as('mes_controlled'),
        plannerId: sql<string>`(${workOrder.plannerId}).user_id`.as('planner_id'),
        plannerName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${workOrder.plannerId}).user_id)::uuid LIMIT 1)`.as('planner_name'),
        remark: workOrder.remark,
      })
      .from(workOrder)
      // 同上：MES 工单可能没有 BOM，必须 leftJoin 才能取到详情
      .leftJoin(bom, eq(workOrder.bomId, bom.id))
      .where(eq(workOrder.id, id))
      .limit(1);

    if (result.length === 0) throw new NotFoundException('工单不存在');

    const row = result[0];
    return {
      ...row,
      bomCode: row.bomCode ?? undefined,
      bomId: row.bomId ?? undefined,
      planQty: Number(row.planQty),
      actualQty: Number(row.actualQty),
      parentOrderId: row.parentOrderId ?? undefined,
      source: row.source ?? 'manual',
      mesMoNo: row.mesMoNo ?? undefined,
      mesStatus: row.mesStatus ?? undefined,
      mesControlled: row.mesControlled === true,
      plannerId: row.plannerId ?? undefined,
      plannerName: row.plannerName ?? undefined,
      remark: row.remark ?? undefined,
    };
  }

  private async generateWorkOrderNo(): Promise<string> {
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `WO${dateStr}`;

    const result = await this.db
      .select({ workOrderNo: workOrder.workOrderNo })
      .from(workOrder)
      .where(ilike(workOrder.workOrderNo, `${prefix}%`))
      .orderBy(desc(workOrder.workOrderNo))
      .limit(1);

    let seq = 1;
    if (result.length > 0) {
      const lastSeq = parseInt(result[0].workOrderNo.slice(prefix.length), 10);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }

    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  // ========== Material Requirement ==========

  async previewMaterialRequirement(body: {
    workOrderNo: string;
  }): Promise<{ items: MaterialRequirementItem[]; workOrderNo: string; sections: string[] }> {
    const { workOrderNo } = body;

    const wo = await this.db.select().from(workOrder).where(eq(workOrder.workOrderNo, workOrderNo)).limit(1);
    if (wo.length === 0) throw new NotFoundException('工单不存在');

    const bomItems = await this.db
      .select()
      .from(bomItem)
      .where(eq(bomItem.bomId, wo[0].bomId))
      .orderBy(bomItem.workSection, bomItem.sortOrder);

    if (bomItems.length === 0) {
      throw new BadRequestException('BOM中无物料，无法生成需求');
    }

    const materialCodes = bomItems.map((item) => item.materialCode);
    const matRows = await this.db.select({ id: material.id, materialCode: material.materialCode })
      .from(material)
      .where(inArray(material.materialCode, materialCodes));
    const matCodeToId = new Map<string, string>();
    for (const m of matRows) matCodeToId.set(m.materialCode, m.id);

    const missingMats = bomItems.filter((item) => !matCodeToId.has(item.materialCode));
    if (missingMats.length > 0) {
      const uniqueMissing = new Map<string, typeof missingMats[0]>();
      for (const item of missingMats) {
        if (!uniqueMissing.has(item.materialCode)) uniqueMissing.set(item.materialCode, item);
      }
      const inserted = await this.db.insert(material).values(
        Array.from(uniqueMissing.values()).map((item) => ({
          materialCode: item.materialCode,
          materialName: item.materialName,
          specification: item.specification,
          unit: item.unit,
          materialType: 'other',
          status: 'active',
        })),
      ).returning({ id: material.id, materialCode: material.materialCode });
      for (const m of inserted) matCodeToId.set(m.materialCode, m.id);
    }

    const planQty = Number(wo[0].planQty);
    const sectionSet = new Set<string>();

    const items: MaterialRequirementItem[] = bomItems.map((item, index: number) => {
      const section = normalizeWorkSection(item.workSection);
      sectionSet.add(section);
      return {
        id: `preview-${index}`,
        reqId: '',
        materialId: matCodeToId.get(item.materialCode) || '',
        materialCode: item.materialCode,
        materialName: item.materialName,
        specification: item.specification ?? undefined,
        unit: item.unit,
        unitUsage: Number(item.quantity),
        requiredQty: Number(item.quantity) * planQty,
        issuedQty: 0,
        workSection: section,
      };
    });

    const sections = WORK_SECTIONS.filter((s) => sectionSet.has(s));
    if (sections.length === 0 && items.length > 0) sections.push('smt');

    return {
      items,
      workOrderNo: wo[0].workOrderNo,
      sections,
    };
  }

  async generateMaterialRequirement(body: {
    workOrderNo: string;
    applicantId: string;
    applicantName: string;
  }): Promise<MaterialRequirement[]> {
    const { workOrderNo, applicantId } = body;

    // 入参校验：缺少 workOrderNo 时应返回 400，而不是把 undefined 传进 eq() 变成 500
    if (!workOrderNo || typeof workOrderNo !== 'string') {
      throw new BadRequestException('缺少工单号 workOrderNo');
    }

    const wo = await this.db.select().from(workOrder).where(eq(workOrder.workOrderNo, workOrderNo)).limit(1);
    if (wo.length === 0) throw new NotFoundException('工单不存在');

    // BUG-004 修复：需求单生成必须幂等。
    // 原实现无任何「已生成」校验，双击/刷新/重试会为同一工单重复生成 N 张需求单
    // （实测 3 次调用产生 3 张 MR 单），进而导致重复领料。
    // 现改为：若该工单已存在未取消的需求单，直接返回已有单据，不再重复创建。
    const existingReqs = await this.db
      .select({ id: materialRequirement.id })
      .from(materialRequirement)
      .where(and(
        eq(materialRequirement.workOrderId, wo[0].id),
        sql`${materialRequirement.status} <> 'cancelled'`,
      ));

    if (existingReqs.length > 0) {
      const result: MaterialRequirement[] = [];
      for (const r of existingReqs) {
        result.push(await this.getRequirementById(r.id));
      }
      return result;
    }

    const bomItems = await this.db
      .select()
      .from(bomItem)
      .where(eq(bomItem.bomId, wo[0].bomId))
      .orderBy(bomItem.workSection, bomItem.sortOrder);

    if (bomItems.length === 0) {
      throw new BadRequestException('BOM无子项，无法生成物料需求单');
    }

    const materialCodes = bomItems.map((item) => item.materialCode);
    const matRows = await this.db.select({
      id: material.id,
      materialCode: material.materialCode,
      overIssueRatio: material.overIssueRatio,
      supplementRatio: material.supplementRatio,
    })
      .from(material)
      .where(inArray(material.materialCode, materialCodes));
    // materialCode -> { id, overIssueRatio, supplementRatio }
    const matCodeMap = new Map<string, { id: string; overIssueRatio: number; supplementRatio: number }>();
    for (const m of matRows) {
      matCodeMap.set(m.materialCode, {
        id: m.id,
        overIssueRatio: m.overIssueRatio ?? 0,
        supplementRatio: m.supplementRatio ?? 0,
      });
    }

    const missingMats = bomItems.filter((item) => !matCodeMap.has(item.materialCode));
    if (missingMats.length > 0) {
      const uniqueMissing = new Map<string, typeof missingMats[0]>();
      for (const item of missingMats) {
        if (!uniqueMissing.has(item.materialCode)) uniqueMissing.set(item.materialCode, item);
      }
      const inserted = await this.db.insert(material).values(
        Array.from(uniqueMissing.values()).map((item) => ({
          materialCode: item.materialCode,
          materialName: item.materialName,
          specification: item.specification,
          unit: item.unit,
          materialType: 'other',
          status: 'active',
        })),
      ).returning({ id: material.id, materialCode: material.materialCode });
      for (const m of inserted) {
        matCodeMap.set(m.materialCode, { id: m.id, overIssueRatio: 0, supplementRatio: 0 });
      }
    }

    const planQty = Number(wo[0].planQty);
    const now = new Date();

    // Group by work section
    const itemsBySection = new Map<string, typeof bomItems>();
    for (const item of bomItems) {
      const section = normalizeWorkSection(item.workSection);
      if (!itemsBySection.has(section)) itemsBySection.set(section, []);
      itemsBySection.get(section)!.push(item);
    }

    const createdReqs: MaterialRequirement[] = [];

    for (const section of WORK_SECTIONS) {
      const sectionItems = itemsBySection.get(section);
      if (!sectionItems || sectionItems.length === 0) continue;

      const reqNo = await this.generateReqNo();

      // 计算每个物料的基础用量、超领量、补料量、实际需求量
      const computedItems = sectionItems.map((item) => {
        const baseQty = Number(item.quantity) * planQty;
        const ratio = matCodeMap.get(item.materialCode) || { overIssueRatio: 0, supplementRatio: 0 };
        const overIssueRatio = ratio.overIssueRatio || 0;
        const supplementRatio = ratio.supplementRatio || 0;
        const overIssueQty = Math.round(baseQty * overIssueRatio / 100 * 100) / 100;
        const supplementQty = Math.round(baseQty * supplementRatio / 100 * 100) / 100;
        const requiredQty = baseQty + overIssueQty + supplementQty;
        return { item, baseQty, overIssueQty, supplementQty, requiredQty };
      });

      const totalQty = computedItems.reduce(
        (sum: number, c) => sum + c.requiredQty,
        0,
      );

      const [req] = await this.db.insert(materialRequirement).values({
        reqNo,
        workOrderId: wo[0].id,
        workSection: section,
        totalQty: String(totalQty),
        status: 'draft',
        applicantId,
      // 注意：DB 侧是**部分**唯一索引 material_requirement_wo_section_uniq
      //       （... WHERE status <> 'cancelled'）。PostgreSQL 的 ON CONFLICT 只有在
      //       冲突目标里带上同样的谓词时才能推断出该部分索引，否则报
      //       「there is no unique or exclusion constraint matching the ON CONFLICT specification」→ 500。
      //       因此这里必须用 where 带上相同条件（drizzle 的字段名就叫 where）。
      }).onConflictDoNothing({
        target: [materialRequirement.workOrderId, materialRequirement.workSection],
        where: sql`${materialRequirement.status} <> 'cancelled'`,
      }).returning();

      // 并发下被唯一索引拦截（已存在该工单+工段的需求单）→ 复用已有单据，保证幂等
      if (!req) {
        const dup = await this.db
          .select({ id: materialRequirement.id })
          .from(materialRequirement)
          .where(and(
            eq(materialRequirement.workOrderId, wo[0].id),
            eq(materialRequirement.workSection, section),
          ))
          .limit(1);
        if (dup.length > 0) createdReqs.push(await this.getRequirementById(dup[0].id));
        continue;
      }

      const reqItems = computedItems.map(({ item, baseQty, overIssueQty, supplementQty, requiredQty }) => ({
        reqId: req.id,
        materialId: matCodeMap.get(item.materialCode)?.id || item.materialId || '',
        materialCode: item.materialCode,
        materialName: item.materialName,
        specification: item.specification,
        unit: item.unit,
        unitUsage: String(item.quantity),
        requiredQty: String(requiredQty),
        baseQty: String(baseQty),
        overIssueQty: String(overIssueQty),
        supplementQty: String(supplementQty),
        workSection: section,
      }));

      await this.db.insert(materialRequirementItem).values(reqItems);

      createdReqs.push(await this.getRequirementById(req.id));
    }

    return createdReqs;
  }

  /**
   * 工单下发：直接按工段生成各工段领料单，跳过物料需求中间环节
   * 领料单状态直接为 pending_approval，由生产主管审批
   */
  async issueWorkOrder(body: {
    workOrderNo: string;
    applicantId: string;
    applicantName: string;
  }): Promise<PickingOrder[]> {
    const { workOrderNo, applicantId } = body;

    const wo = await this.db.select().from(workOrder).where(eq(workOrder.workOrderNo, workOrderNo)).limit(1);
    if (wo.length === 0) throw new NotFoundException('工单不存在');

    // MES 管控的工单不允许 WMS 下发（判定见 resolveMesControl：以领料单来源为准）
    await this.assertWorkOrderOperable(
      this.db,
      wo[0] as { id: string; source?: string | null; mesMoNo?: string | null },
      '下发',
    );

    if (wo[0].status === 'released' || wo[0].status === 'in_production') {
      throw new ConflictException('工单已下发，请勿重复操作');
    }
    if (wo[0].status === 'completed' || wo[0].status === 'closed' || wo[0].status === 'cancelled') {
      throw new BadRequestException('当前工单状态不允许下发');
    }

    const bomItems = await this.db
      .select()
      .from(bomItem)
      .where(eq(bomItem.bomId, wo[0].bomId))
      .orderBy(bomItem.workSection, bomItem.sortOrder);

    if (bomItems.length === 0) {
      throw new BadRequestException('BOM无子项，无法下发工单');
    }

    // 检查是否已存在领料单（排除已取消的：召回/取消工单产生的 cancelled 领料单不应阻止重新下发）
    const existingPicking = await this.db
      .select({ id: pickingOrder.id })
      .from(pickingOrder)
      .where(and(eq(pickingOrder.workOrderId, wo[0].id), sql`${pickingOrder.status} <> 'cancelled'`))
      .limit(1);
    if (existingPicking.length > 0) {
      throw new ConflictException('该工单已生成领料单');
    }

    const materialCodes = bomItems.map((item) => item.materialCode);
    const matRows = await this.db.select({
      id: material.id,
      materialCode: material.materialCode,
      overIssueRatio: material.overIssueRatio,
      supplementRatio: material.supplementRatio,
    })
      .from(material)
      .where(inArray(material.materialCode, materialCodes));
    const matCodeMap = new Map<string, { id: string; overIssueRatio: number; supplementRatio: number }>();
    for (const m of matRows) {
      matCodeMap.set(m.materialCode, {
        id: m.id,
        overIssueRatio: m.overIssueRatio ?? 0,
        supplementRatio: m.supplementRatio ?? 0,
      });
    }

    // 自动补建缺失物料
    const missingMats = bomItems.filter((item) => !matCodeMap.has(item.materialCode));
    if (missingMats.length > 0) {
      const uniqueMissing = new Map<string, typeof missingMats[0]>();
      for (const item of missingMats) {
        if (!uniqueMissing.has(item.materialCode)) uniqueMissing.set(item.materialCode, item);
      }
      const inserted = await this.db.insert(material).values(
        Array.from(uniqueMissing.values()).map((item) => ({
          materialCode: item.materialCode,
          materialName: item.materialName,
          specification: item.specification,
          unit: item.unit,
          materialType: 'other',
          status: 'active',
        })),
      ).returning({ id: material.id, materialCode: material.materialCode });
      for (const m of inserted) {
        matCodeMap.set(m.materialCode, { id: m.id, overIssueRatio: 0, supplementRatio: 0 });
      }
    }

    const planQty = Number(wo[0].planQty);

    // 按工段分组
    const itemsBySection = new Map<string, typeof bomItems>();
    for (const item of bomItems) {
      const section = normalizeWorkSection(item.workSection);
      if (!itemsBySection.has(section)) itemsBySection.set(section, []);
      itemsBySection.get(section)!.push(item);
    }

    const createdPickingIds: string[] = [];

    // 预生成所有工段的领料单号（手动递增序号，避免事务内重复）
    const activeSections = WORK_SECTIONS.filter((s) => itemsBySection.has(s) && itemsBySection.get(s)!.length > 0);
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `PK${dateStr}`;
    const lastPicking = await this.db
      .select({ pickingNo: pickingOrder.pickingNo })
      .from(pickingOrder)
      .where(ilike(pickingOrder.pickingNo, `${prefix}%`))
      .orderBy(desc(pickingOrder.pickingNo))
      .limit(1);
    let seq = 1;
    if (lastPicking.length > 0) {
      const lastSeq = parseInt(lastPicking[0].pickingNo.slice(prefix.length), 10);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }
    const pickingNos: string[] = activeSections.map(() => `${prefix}${(seq++).toString().padStart(4, '0')}`);

    await this.db.transaction(async (tx) => {
      // BUG-009 修复（2026-09-30 恢复，原修复在 09-24 改版时丢失）：
      // 事务内 FOR UPDATE 锁工单行，锁后复查状态与领料单，
      // 防止并发下发同一工单时重复生成领料单（检查与插入之间的竞态窗口）
      const [lockedWo] = await tx
        .select({ id: workOrder.id, status: workOrder.status })
        .from(workOrder)
        .where(eq(workOrder.id, wo[0].id))
        .for('update');
      if (!lockedWo) throw new NotFoundException('工单不存在');
      if (lockedWo.status === 'released' || lockedWo.status === 'in_production') {
        throw new ConflictException('工单已下发，请勿重复操作');
      }
      if (lockedWo.status === 'completed' || lockedWo.status === 'closed' || lockedWo.status === 'cancelled') {
        throw new BadRequestException('当前工单状态不允许下发');
      }
      // 仅存在未取消的领料单时才拦截（召回/取消工单会产生 cancelled 领料单，不应阻止重新下发）
      const existingPickingInTx = await tx
        .select({ id: pickingOrder.id })
        .from(pickingOrder)
        .where(and(eq(pickingOrder.workOrderId, wo[0].id), sql`${pickingOrder.status} <> 'cancelled'`))
        .limit(1);
      if (existingPickingInTx.length > 0) {
        throw new ConflictException('该工单已生成领料单');
      }

      let pickingNoIndex = 0;
      for (const section of WORK_SECTIONS) {
        const sectionItems = itemsBySection.get(section);
        if (!sectionItems || sectionItems.length === 0) continue;

        // 计算每个物料的用量（含超领、补料比例）
        const computedItems = sectionItems.map((item) => {
          const baseQty = Number(item.quantity) * planQty;
          const ratio = matCodeMap.get(item.materialCode) || { overIssueRatio: 0, supplementRatio: 0 };
          const overIssueQty = Math.round(baseQty * (ratio.overIssueRatio || 0) / 100 * 100) / 100;
          const supplementQty = Math.round(baseQty * (ratio.supplementRatio || 0) / 100 * 100) / 100;
          const requiredQty = baseQty + overIssueQty + supplementQty;
          return { item, requiredQty };
        });

        const totalQty = computedItems.reduce((sum: number, c) => sum + c.requiredQty, 0);
        const pickingNo = pickingNos[pickingNoIndex++];

        const [newPicking] = await tx.insert(pickingOrder).values({
          pickingNo,
          workOrderId: wo[0].id,
          reqId: null,
          workSection: section,
          isSupplement: false,
          totalQty: String(totalQty),
          status: 'pending_approval',
          applicantId,
          remark: '工单下发自动生成',
        }).returning();

        const pickItems = computedItems.map(({ item, requiredQty }) => ({
          pickingId: newPicking.id,
          materialId: matCodeMap.get(item.materialCode)?.id || '',
          materialCode: item.materialCode,
          materialName: item.materialName,
          unit: item.unit,
          pickQty: String(requiredQty),
          actualQty: '0',
        }));

        await tx.insert(pickingOrderItem).values(pickItems);
        createdPickingIds.push(newPicking.id);
      }

      // 更新工单状态为已下发
      await tx.update(workOrder).set({ status: 'released' }).where(eq(workOrder.id, wo[0].id));
    });

    const pickingOrders = await Promise.all(
      createdPickingIds.map((id) => this.getPickingOrderById(id)),
    );

    return pickingOrders;
  }

  /**
   * 超补比例报表：关联 material_requirement + material_requirement_item + work_order
   * 展示每条物料需求明细的基础用量、超领量、补料量、实际需求、实际领料及超补率
   */
  async getOverSupplementReport(params: {
    workOrderNo?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: Array<{
      reqId: string;
      workOrderNo: string;
      workOrderDate: string;
      materialCode: string;
      materialName: string;
      unitUsage: number;
      baseQty: number;
      overIssueQty: number;
      supplementQty: number;
      requiredQty: number;
      issuedQty: number;
      overSupplementRate: number;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { workOrderNo, startDate, endDate, page = 1, pageSize = 20 } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (workOrderNo) conditions.push(ilike(workOrder.workOrderNo, `%${workOrderNo}%`));
    if (startDate) conditions.push(gte(workOrder.workOrderDate, startDate));
    if (endDate) {
      const nextDay = new Date(endDate);
      nextDay.setDate(nextDay.getDate() + 1);
      conditions.push(lt(workOrder.workOrderDate, nextDay.toISOString().split('T')[0]));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        reqId: materialRequirement.id,
        workOrderNo: workOrder.workOrderNo,
        workOrderDate: workOrder.workOrderDate,
        materialCode: materialRequirementItem.materialCode,
        materialName: materialRequirementItem.materialName,
        unitUsage: materialRequirementItem.unitUsage,
        baseQty: materialRequirementItem.baseQty,
        overIssueQty: materialRequirementItem.overIssueQty,
        supplementQty: materialRequirementItem.supplementQty,
        requiredQty: materialRequirementItem.requiredQty,
        issuedQty: materialRequirementItem.issuedQty,
      })
      .from(materialRequirementItem)
      .innerJoin(materialRequirement, eq(materialRequirementItem.reqId, materialRequirement.id))
      .innerJoin(workOrder, eq(materialRequirement.workOrderId, workOrder.id));

    const [countResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(materialRequirementItem)
        .innerJoin(materialRequirement, eq(materialRequirementItem.reqId, materialRequirement.id))
        .innerJoin(workOrder, eq(materialRequirement.workOrderId, workOrder.id))
        .where(whereClause),
      baseQuery
        .where(whereClause)
        .orderBy(desc(materialRequirementItem.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    const items = rows.map((row) => {
      const baseQty = Number(row.baseQty ?? 0);
      const overIssueQty = Number(row.overIssueQty ?? 0);
      const supplementQty = Number(row.supplementQty ?? 0);
      const requiredQty = Number(row.requiredQty ?? 0);
      const issuedQty = Number(row.issuedQty ?? 0);
      const overSupplementRate = baseQty > 0
        ? Math.round(((overIssueQty + supplementQty) / baseQty) * 10000) / 100
        : 0;
      return {
        reqId: row.reqId,
        workOrderNo: row.workOrderNo,
        workOrderDate: typeof row.workOrderDate === 'string'
          ? row.workOrderDate
          : row.workOrderDate.toISOString().split('T')[0],
        materialCode: row.materialCode,
        materialName: row.materialName,
        unitUsage: Number(row.unitUsage ?? 0),
        baseQty,
        overIssueQty,
        supplementQty,
        requiredQty,
        issuedQty,
        overSupplementRate,
      };
    });

    return { items, total, page, pageSize };
  }

  /**
   * 超补比例报表（金额维度，按工单汇总，用于成本管控）
   * 正常物料金额 = Σ 正常领料单(is_supplement=false, approved/completed) 明细数量 × 物料单价
   * 超补物料金额 = Σ 已生效超补领料单明细金额（创建时录入的 amount，缺省 数量×单价）
   * 超补比例 = 超补物料金额 / 正常物料金额 × 100%
   */
  async getOverSupplementAmountReport(params: {
    workOrderNo?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    items: Array<{
      workOrderId: string;
      workOrderNo: string;
      workOrderDate: string;
      productCode: string;
      normalAmount: number;
      overAmount: number;
      overSupplementRate: number;
    }>;
    summary: {
      normalAmount: number;
      overAmount: number;
      overSupplementRate: number;
    };
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { workOrderNo, startDate, endDate, page = 1, pageSize = 20 } = params;
    const offset = (page - 1) * pageSize;

    // 工单维度筛选条件（正常金额与超补金额查询共用）
    const woConds = [];
    if (workOrderNo) woConds.push(ilike(workOrder.workOrderNo, `%${workOrderNo}%`));
    if (startDate) woConds.push(gte(workOrder.workOrderDate, startDate));
    if (endDate) {
      const nextDay = new Date(endDate);
      nextDay.setDate(nextDay.getDate() + 1);
      woConds.push(lt(workOrder.workOrderDate, nextDay.toISOString().split('T')[0]));
    }

    // 正常物料金额：正常领料单（is_supplement=false，approved/completed）明细数量 × 物料单价
    const groupRows = await this.db
      .select({
        workOrderId: pickingOrder.workOrderId,
        workOrderNo: workOrder.workOrderNo,
        workOrderDate: workOrder.workOrderDate,
        productCode: workOrder.productCode,
        amount: sql<string>`COALESCE(SUM(COALESCE(${pickingOrderItem.pickQty}, 0) * COALESCE(${material.unitPrice}, 0)), 0)`,
      })
      .from(pickingOrder)
      .innerJoin(pickingOrderItem, eq(pickingOrderItem.pickingId, pickingOrder.id))
      .innerJoin(workOrder, eq(pickingOrder.workOrderId, workOrder.id))
      .leftJoin(material, eq(material.id, pickingOrderItem.materialId))
      .where(and(
        inArray(pickingOrder.status, ['approved', 'completed']),
        eq(pickingOrder.isSupplement, false),
        ...woConds,
      ))
      .groupBy(
        pickingOrder.workOrderId,
        workOrder.workOrderNo,
        workOrder.workOrderDate,
        workOrder.productCode,
      );

    // 超补物料金额：已生效超补领料单明细金额（创建时录入的 amount，缺省 数量×单价）
    const overRows = await this.db
      .select({
        workOrderId: overPickingOrder.workOrderId,
        amount: sql<string>`COALESCE(SUM(COALESCE(${overPickingItem.amount}, COALESCE(${overPickingItem.quantity}, 0) * COALESCE(${overPickingItem.unitPrice}, 0))), 0)`,
      })
      .from(overPickingOrder)
      .innerJoin(overPickingItem, eq(overPickingItem.orderId, overPickingOrder.id))
      .innerJoin(workOrder, eq(overPickingOrder.workOrderId, workOrder.id))
      .where(and(eq(overPickingOrder.status, 'approved'), ...woConds))
      .groupBy(overPickingOrder.workOrderId);

    const overMap = new Map<string, number>();
    for (const row of overRows) {
      overMap.set(row.workOrderId, Number(row.amount ?? 0));
    }

    // 按工单聚合正常/超补金额
    const woMap = new Map<string, {
      workOrderId: string;
      workOrderNo: string;
      workOrderDate: string;
      productCode: string;
      normalAmount: number;
      overAmount: number;
    }>();
    for (const row of groupRows) {
      const amt = Number(row.amount ?? 0);
      let entry = woMap.get(row.workOrderId);
      if (!entry) {
        entry = {
          workOrderId: row.workOrderId,
          workOrderNo: row.workOrderNo,
          workOrderDate: typeof row.workOrderDate === 'string'
            ? row.workOrderDate
            : row.workOrderDate.toISOString().split('T')[0],
          productCode: row.productCode,
          normalAmount: 0,
          overAmount: 0,
        };
        woMap.set(row.workOrderId, entry);
      }
      entry.normalAmount += amt;
    }

    // 合并超补金额（有超补但没有正常领料的工单也要展示）
    for (const [workOrderId, overAmt] of overMap.entries()) {
      let entry = woMap.get(workOrderId);
      if (!entry) {
        const meta = (await this.db
          .select({
            workOrderNo: workOrder.workOrderNo,
            workOrderDate: workOrder.workOrderDate,
            productCode: workOrder.productCode,
          })
          .from(workOrder)
          .where(eq(workOrder.id, workOrderId))
          .limit(1))[0];
        if (!meta) continue;
        entry = {
          workOrderId,
          workOrderNo: meta.workOrderNo,
          workOrderDate: typeof meta.workOrderDate === 'string'
            ? meta.workOrderDate
            : meta.workOrderDate.toISOString().split('T')[0],
          productCode: meta.productCode,
          normalAmount: 0,
          overAmount: 0,
        };
        woMap.set(workOrderId, entry);
      }
      entry.overAmount += overAmt;
    }

    const allItems = Array.from(woMap.values()).sort((a, b) =>
      a.workOrderDate === b.workOrderDate
        ? b.workOrderNo.localeCompare(a.workOrderNo)
        : b.workOrderDate.localeCompare(a.workOrderDate),
    );

    const round2 = (v: number) => Math.round(v * 100) / 100;
    for (const item of allItems) {
      item.normalAmount = round2(item.normalAmount);
      item.overAmount = round2(item.overAmount);
    }

    // 合计（全部匹配数据，不受分页影响）
    const sumNormal = round2(allItems.reduce((s, i) => s + i.normalAmount, 0));
    const sumOver = round2(allItems.reduce((s, i) => s + i.overAmount, 0));
    const summary = {
      normalAmount: sumNormal,
      overAmount: sumOver,
      overSupplementRate: sumNormal > 0 ? Math.round((sumOver / sumNormal) * 10000) / 100 : 0,
    };

    const total = allItems.length;
    const items = allItems.slice(offset, offset + pageSize).map((item) => ({
      ...item,
      overSupplementRate:
        item.normalAmount > 0 ? Math.round((item.overAmount / item.normalAmount) * 10000) / 100 : 0,
    }));

    return { items, summary, total, page, pageSize };
  }

  private async generateReqNo(): Promise<string> {
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `MR${dateStr}`;

    const result = await this.db
      .select({ reqNo: materialRequirement.reqNo })
      .from(materialRequirement)
      .where(ilike(materialRequirement.reqNo, `${prefix}%`))
      .orderBy(desc(materialRequirement.reqNo))
      .limit(1);

    let seq = 1;
    if (result.length > 0) {
      const lastSeq = parseInt(result[0].reqNo.slice(prefix.length), 10);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }

    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  async getRequirementList(params: {
    page: number;
    pageSize: number;
    reqNo?: string;
    workOrderNo?: string;
    workSection?: string;
    status?: string;
  }): Promise<PaginatedResponse<MaterialRequirement>> {
    const { page, pageSize, reqNo, workOrderNo, workSection, status } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (reqNo) conditions.push(ilike(materialRequirement.reqNo, `%${reqNo}%`));
    if (workOrderNo) conditions.push(ilike(workOrder.workOrderNo, `%${workOrderNo}%`));
    if (workSection) conditions.push(eq(materialRequirement.workSection, workSection));
    if (status) conditions.push(eq(materialRequirement.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        id: materialRequirement.id,
        reqNo: materialRequirement.reqNo,
        workOrderId: materialRequirement.workOrderId,
        workOrderNo: workOrder.workOrderNo,
        workSection: materialRequirement.workSection,
        totalQty: materialRequirement.totalQty,
        status: materialRequirement.status,
        applicantId: sql<string>`(${materialRequirement.applicantId}).user_id`.as('applicant_id'),
        applicantName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${materialRequirement.applicantId}).user_id)::uuid LIMIT 1)`.as('applicant_name'),
        approverId: sql<string>`(${materialRequirement.approverId}).user_id`.as('approver_id'),
        approverName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${materialRequirement.approverId}).user_id)::uuid LIMIT 1)`.as('approver_name'),
        approvalTime: materialRequirement.approvalTime,
        approvalRemark: materialRequirement.approvalRemark,
        remark: materialRequirement.remark,
      })
      .from(materialRequirement)
      .innerJoin(workOrder, eq(materialRequirement.workOrderId, workOrder.id));

    const [totalResult, items] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(materialRequirement)
        .innerJoin(workOrder, eq(materialRequirement.workOrderId, workOrder.id))
        .where(whereClause),
      baseQuery
        .where(whereClause)
        .orderBy(desc(materialRequirement.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: items.map((item) => ({
        ...item,
        totalQty: Number(item.totalQty),
        workSection: item.workSection ?? undefined,
        applicantId: item.applicantId ?? undefined,
        applicantName: item.applicantName ?? undefined,
        approverId: item.approverId ?? undefined,
        approverName: item.approverName ?? undefined,
        approvalTime: item.approvalTime ? item.approvalTime.toISOString() : undefined,
        approvalRemark: item.approvalRemark ?? undefined,
        remark: item.remark ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async submitRequirement(id: string, body: { submitterId: string; submitterName: string }): Promise<MaterialRequirement> {
    const req = await this.db.select().from(materialRequirement).where(eq(materialRequirement.id, id)).limit(1);
    if (req.length === 0) throw new NotFoundException('需求单不存在');
    if (req[0].status !== 'draft') throw new BadRequestException('仅草稿状态可提交');

    await this.db.update(materialRequirement)
      .set({ status: 'pending_approval' })
      .where(eq(materialRequirement.id, id));

    return this.getRequirementById(id);
  }

  async submitRequirementsByWorkOrder(
    workOrderId: string,
    body: { submitterId: string; submitterName: string },
  ): Promise<MaterialRequirement[]> {
    const reqs = await this.db.select().from(materialRequirement)
      .where(and(eq(materialRequirement.workOrderId, workOrderId), eq(materialRequirement.status, 'draft')));

    if (reqs.length === 0) return [];

    const ids = reqs.map((r) => r.id);

    await this.db.transaction(async (tx) => {
      await tx.update(materialRequirement)
        .set({ status: 'pending_approval' })
        .where(inArray(materialRequirement.id, ids));

      const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const prefix = `PK${dateStr}`;
      const lastNoResult = await tx
        .select({ pickingNo: pickingOrder.pickingNo })
        .from(pickingOrder)
        .where(ilike(pickingOrder.pickingNo, `${prefix}%`))
        .orderBy(desc(pickingOrder.pickingNo))
        .limit(1);
      let seq = 1;
      if (lastNoResult.length > 0) {
        const lastSeq = parseInt(lastNoResult[0].pickingNo.slice(prefix.length), 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
      }

      for (const req of reqs) {
        const existing = await tx.select().from(pickingOrder).where(eq(pickingOrder.reqId, req.id)).limit(1);
        if (existing.length > 0) continue;

        const reqItems = await tx
          .select()
          .from(materialRequirementItem)
          .where(eq(materialRequirementItem.reqId, req.id));

        const pickingNo = `${prefix}${seq.toString().padStart(4, '0')}`;
        seq += 1;
        const totalQty = reqItems.reduce((sum: number, item) => sum + Number(item.requiredQty), 0);

        const [newPicking] = await tx.insert(pickingOrder).values({
          pickingNo,
          workOrderId: req.workOrderId,
          reqId: req.id,
          workSection: req.workSection || 'smt',
          isSupplement: false,
          totalQty: String(totalQty),
          status: 'pending_approval',
          applicantId: req.applicantId || undefined,
        }).returning();

        const pickItems = reqItems.map((item) => ({
          pickingId: newPicking.id,
          materialId: item.materialId || undefined,
          materialCode: item.materialCode,
          materialName: item.materialName,
          unit: item.unit,
          pickQty: item.requiredQty,
          actualQty: '0',
        }));

        await tx.insert(pickingOrderItem).values(pickItems);
      }
    });

    const results: MaterialRequirement[] = [];
    for (const id of ids) {
      results.push(await this.getRequirementById(id));
    }
    return results;
  }

  async batchSubmitRequirements(
    ids: string[],
    body: { submitterId: string; submitterName: string },
  ): Promise<MaterialRequirement[]> {
    if (!ids || ids.length === 0) return [];

    const reqs = await this.db.select().from(materialRequirement)
      .where(inArray(materialRequirement.id, ids));

    const draftReqs = reqs.filter((r) => r.status === 'draft');
    if (draftReqs.length === 0) return [];

    const draftIds = draftReqs.map((r) => r.id);

    await this.db.transaction(async (tx) => {
      await tx.update(materialRequirement)
        .set({ status: 'pending_approval' })
        .where(inArray(materialRequirement.id, draftIds));

      const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const prefix = `PK${dateStr}`;
      const lastNoResult = await tx
        .select({ pickingNo: pickingOrder.pickingNo })
        .from(pickingOrder)
        .where(ilike(pickingOrder.pickingNo, `${prefix}%`))
        .orderBy(desc(pickingOrder.pickingNo))
        .limit(1);
      let seq = 1;
      if (lastNoResult.length > 0) {
        const lastSeq = parseInt(lastNoResult[0].pickingNo.slice(prefix.length), 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
      }

      for (const req of draftReqs) {
        const existing = await tx.select().from(pickingOrder).where(eq(pickingOrder.reqId, req.id)).limit(1);
        if (existing.length > 0) continue;

        const reqItems = await tx
          .select()
          .from(materialRequirementItem)
          .where(eq(materialRequirementItem.reqId, req.id));

        const pickingNo = `${prefix}${seq.toString().padStart(4, '0')}`;
        seq += 1;
        const totalQty = reqItems.reduce((sum: number, item) => sum + Number(item.requiredQty), 0);

        const [newPicking] = await tx.insert(pickingOrder).values({
          pickingNo,
          workOrderId: req.workOrderId,
          reqId: req.id,
          workSection: req.workSection || 'smt',
          isSupplement: false,
          totalQty: String(totalQty),
          status: 'pending_approval',
          applicantId: req.applicantId || undefined,
        }).returning();

        const pickItems = reqItems.map((item) => ({
          pickingId: newPicking.id,
          materialId: item.materialId || undefined,
          materialCode: item.materialCode,
          materialName: item.materialName,
          unit: item.unit,
          pickQty: item.requiredQty,
          actualQty: '0',
        }));

        await tx.insert(pickingOrderItem).values(pickItems);
      }
    });

    const results: MaterialRequirement[] = [];
    for (const id of draftIds) {
      results.push(await this.getRequirementById(id));
    }
    return results;
  }

  async approveRequirement(id: string, body: {
    approverId: string;
    approverName: string;
    approvalRemark?: string;
    pass: boolean;
  }): Promise<MaterialRequirement> {
    const { approverId, approvalRemark, pass } = body;

    const req = await this.db.select().from(materialRequirement).where(eq(materialRequirement.id, id)).limit(1);
    if (req.length === 0) throw new NotFoundException('需求单不存在');
    if (req[0].status !== 'pending_approval') throw new BadRequestException('仅待审批状态可审批');

    await this.db.transaction(async (tx) => {
      await tx.update(materialRequirement)
        .set({
          status: pass ? 'approved' : 'rejected',
          approverId,
          approvalTime: new Date(),
          approvalRemark,
        })
        .where(eq(materialRequirement.id, id));

      if (pass) {
        const existing = await tx.select().from(pickingOrder).where(eq(pickingOrder.reqId, id)).limit(1);
        if (existing.length === 0) {
          const reqItems = await tx
            .select()
            .from(materialRequirementItem)
            .where(eq(materialRequirementItem.reqId, id));

          const pickingNo = await this.generatePickingNo();
          const totalQty = reqItems.reduce((sum: number, item) => sum + Number(item.requiredQty), 0);

          const [newPicking] = await tx.insert(pickingOrder).values({
            pickingNo,
            workOrderId: req[0].workOrderId,
            reqId: id,
            workSection: req[0].workSection || 'smt',
            isSupplement: false,
            totalQty: String(totalQty),
            status: 'approved',
            applicantId: req[0].applicantId || undefined,
            approverId,
            approvalTime: new Date(),
            approvalRemark,
          }).returning();

          const pickItems = reqItems.map((item) => ({
            pickingId: newPicking.id,
            materialId: item.materialId || undefined,
            materialCode: item.materialCode,
            materialName: item.materialName,
            unit: item.unit,
            pickQty: item.requiredQty,
            actualQty: '0',
          }));

          await tx.insert(pickingOrderItem).values(pickItems);
        } else {
          await tx.update(pickingOrder)
            .set({
              status: 'approved',
              approverId,
              approvalTime: new Date(),
              approvalRemark,
            })
            .where(eq(pickingOrder.id, existing[0].id));
        }
      }
    });

    return this.getRequirementById(id);
  }

  private async getRequirementById(id: string): Promise<MaterialRequirement> {
    const result = await this.db
      .select({
        id: materialRequirement.id,
        reqNo: materialRequirement.reqNo,
        workOrderId: materialRequirement.workOrderId,
        workOrderNo: workOrder.workOrderNo,
        workSection: materialRequirement.workSection,
        totalQty: materialRequirement.totalQty,
        status: materialRequirement.status,
        applicantId: sql<string>`(${materialRequirement.applicantId}).user_id`.as('applicant_id'),
        applicantName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${materialRequirement.applicantId}).user_id)::uuid LIMIT 1)`.as('applicant_name'),
        approverId: sql<string>`(${materialRequirement.approverId}).user_id`.as('approver_id'),
        approverName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${materialRequirement.approverId}).user_id)::uuid LIMIT 1)`.as('approver_name'),
        approvalTime: materialRequirement.approvalTime,
        approvalRemark: materialRequirement.approvalRemark,
        remark: materialRequirement.remark,
      })
      .from(materialRequirement)
      .innerJoin(workOrder, eq(materialRequirement.workOrderId, workOrder.id))
      .where(eq(materialRequirement.id, id))
      .limit(1);

    if (result.length === 0) throw new NotFoundException('需求单不存在');

    const row = result[0];

    // Get items
    const items = await this.db
      .select()
      .from(materialRequirementItem)
      .where(eq(materialRequirementItem.reqId, id))
      .orderBy(materialRequirementItem.workSection, materialRequirementItem.createdAt);

    return {
      id: row.id,
      reqNo: row.reqNo,
      workOrderId: row.workOrderId,
      workOrderNo: row.workOrderNo,
      workSection: row.workSection ?? undefined,
      totalQty: Number(row.totalQty),
      status: row.status,
      applicantId: row.applicantId ?? undefined,
      applicantName: row.applicantName ?? undefined,
      approverId: row.approverId ?? undefined,
      approverName: row.approverName ?? undefined,
      approvalTime: row.approvalTime ? row.approvalTime.toISOString() : undefined,
      approvalRemark: row.approvalRemark ?? undefined,
      remark: row.remark ?? undefined,
      items: items.map((item) => ({
        id: item.id,
        reqId: item.reqId,
        materialId: item.materialId,
        materialCode: item.materialCode,
        materialName: item.materialName,
        specification: item.specification ?? undefined,
        unit: item.unit,
        unitUsage: Number(item.unitUsage || 0),
        requiredQty: Number(item.requiredQty),
        baseQty: item.baseQty != null ? Number(item.baseQty) : undefined,
        overIssueQty: item.overIssueQty != null ? Number(item.overIssueQty) : undefined,
        supplementQty: item.supplementQty != null ? Number(item.supplementQty) : undefined,
        issuedQty: Number(item.issuedQty || 0),
        workSection: item.workSection ?? undefined,
      })),
    };
  }

  // ========== Picking Order ==========

  async getPickingOrderList(params: {
    page: number;
    pageSize: number;
    pickingNo?: string;
    workOrderNo?: string;
    workSection?: string;
    status?: string;
    userRole?: string;
    userWorkSection?: string;
  }): Promise<PaginatedResponse<PickingOrder>> {
    const { page, pageSize, pickingNo, workOrderNo, workSection, status, userRole, userWorkSection } = params;
    const offset = (page - 1) * pageSize;

    const MATERIAL_ROLES = ['production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'];
    const isMaterialHandler = userRole && MATERIAL_ROLES.includes(userRole);

    const conditions = [];
    // 仓库手上拿的是 MES 领料单号（LL...-SMT），不是 WMS 的 PK... 号。
    // 搜索框只有「领料单号」一个入口，所以这里一并匹配 mes_issue_no，
    // 否则 MES 推过来的单在发料管理里按手上的单号根本查不出来。
    if (pickingNo) {
      conditions.push(or(
        ilike(pickingOrder.pickingNo, `%${pickingNo}%`),
        ilike(pickingOrder.mesIssueNo, `%${pickingNo}%`),
      ));
    }
    if (workOrderNo) conditions.push(ilike(workOrder.workOrderNo, `%${workOrderNo}%`));
    if (workSection) conditions.push(eq(pickingOrder.workSection, workSection));
    if (status) conditions.push(eq(pickingOrder.status, status));
    if (isMaterialHandler && userWorkSection) {
      conditions.push(eq(pickingOrder.workSection, userWorkSection));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        id: pickingOrder.id,
        pickingNo: pickingOrder.pickingNo,
        workOrderId: pickingOrder.workOrderId,
        workOrderNo: workOrder.workOrderNo,
        // 领料单随工单带出产品编码，便于按产品归类管理
        productCode: workOrder.productCode,
        productName: workOrder.productName,
        reqId: pickingOrder.reqId,
        workSection: pickingOrder.workSection,
        isSupplement: pickingOrder.isSupplement,
        totalQty: pickingOrder.totalQty,
        status: pickingOrder.status,
        applicantId: sql<string>`(${pickingOrder.applicantId}).user_id`.as('applicant_id'),
        applicantName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.applicantId}).user_id)::uuid LIMIT 1)`.as('applicant_name'),
        approverId: sql<string>`(${pickingOrder.approverId}).user_id`.as('approver_id'),
        approverName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.approverId}).user_id)::uuid LIMIT 1)`.as('approver_name'),
        approvalTime: pickingOrder.approvalTime,
        approvalRemark: pickingOrder.approvalRemark,
        pickerId: sql<string>`(${pickingOrder.pickerId}).user_id`.as('picker_id'),
        pickerName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.pickerId}).user_id)::uuid LIMIT 1)`.as('picker_name'),
        pickTime: pickingOrder.pickTime,
        oaInstanceId: pickingOrder.oaInstanceId,
        oaStatus: pickingOrder.oaStatus,
        remark: pickingOrder.remark,
        // MES 自动开的单没有申请人，界面要能标出来源
        source: pickingOrder.source,
        // MES 侧领料单号：仓库拿它对单、跟 MES 台账核对
        mesIssueNo: pickingOrder.mesIssueNo,
      })
      .from(pickingOrder)
      .innerJoin(workOrder, eq(pickingOrder.workOrderId, workOrder.id));

    const [totalResult, items] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(pickingOrder)
        .innerJoin(workOrder, eq(pickingOrder.workOrderId, workOrder.id))
        .where(whereClause),
      baseQuery
        .where(whereClause)
        .orderBy(desc(pickingOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: items.map((item) => ({
        ...item,
        totalQty: Number(item.totalQty),
        reqId: item.reqId ?? undefined,
        applicantId: item.applicantId ?? undefined,
        applicantName: item.applicantName ?? undefined,
        approverId: item.approverId ?? undefined,
        approverName: item.approverName ?? undefined,
        approvalTime: item.approvalTime ? item.approvalTime.toISOString() : undefined,
        approvalRemark: item.approvalRemark ?? undefined,
        pickerId: item.pickerId ?? undefined,
        pickerName: item.pickerName ?? undefined,
        pickTime: item.pickTime ? item.pickTime.toISOString() : undefined,
        remark: item.remark ?? undefined,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getPickingOrdersByWorkOrder(workOrderId: string): Promise<PickingOrder[]> {
    const rows = await this.db
      .select({
        id: pickingOrder.id,
        pickingNo: pickingOrder.pickingNo,
        workOrderId: pickingOrder.workOrderId,
        workOrderNo: workOrder.workOrderNo,
        // 领料单随工单带出产品编码，便于按产品归类管理
        productCode: workOrder.productCode,
        productName: workOrder.productName,
        reqId: pickingOrder.reqId,
        workSection: pickingOrder.workSection,
        isSupplement: pickingOrder.isSupplement,
        totalQty: pickingOrder.totalQty,
        status: pickingOrder.status,
        applicantId: sql<string>`(${pickingOrder.applicantId}).user_id`.as('applicant_id'),
        applicantName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.applicantId}).user_id)::uuid LIMIT 1)`.as('applicant_name'),
        approverId: sql<string>`(${pickingOrder.approverId}).user_id`.as('approver_id'),
        approverName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.approverId}).user_id)::uuid LIMIT 1)`.as('approver_name'),
        approvalTime: pickingOrder.approvalTime,
        approvalRemark: pickingOrder.approvalRemark,
        pickerId: sql<string>`(${pickingOrder.pickerId}).user_id`.as('picker_id'),
        pickerName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.pickerId}).user_id)::uuid LIMIT 1)`.as('picker_name'),
        pickTime: pickingOrder.pickTime,
        remark: pickingOrder.remark,
      })
      .from(pickingOrder)
      .innerJoin(workOrder, eq(pickingOrder.workOrderId, workOrder.id))
      .where(eq(pickingOrder.workOrderId, workOrderId))
      .orderBy(desc(pickingOrder.createdAt));

    return rows.map((item) => ({
      ...item,
      totalQty: Number(item.totalQty),
      reqId: item.reqId ?? undefined,
      applicantId: item.applicantId ?? undefined,
      applicantName: item.applicantName ?? undefined,
      approverId: item.approverId ?? undefined,
      approverName: item.approverName ?? undefined,
      approvalTime: item.approvalTime ? item.approvalTime.toISOString() : undefined,
      approvalRemark: item.approvalRemark ?? undefined,
      pickerId: item.pickerId ?? undefined,
      pickerName: item.pickerName ?? undefined,
      pickTime: item.pickTime ? item.pickTime.toISOString() : undefined,
      remark: item.remark ?? undefined,
    }));
  }

  async batchApprovePickingOrders(body: {
    ids: string[];
    approverId: string;
    approverName: string;
    approvalRemark?: string;
    pass: boolean;
  }): Promise<PickingOrder[]> {
    const { ids, approverId, approverName, approvalRemark, pass } = body;
    if (!ids || ids.length === 0) return [];

    const updated: PickingOrder[] = [];
    await this.db.transaction(async (tx) => {
      const pos = await tx.select().from(pickingOrder).where(inArray(pickingOrder.id, ids));

      const invalid = pos.filter((p) => p.status !== 'pending_approval');
      if (invalid.length > 0) {
        throw new BadRequestException('存在非待审批状态的领料单，无法批量审批');
      }

      await tx.update(pickingOrder)
        .set({
          status: pass ? 'approved' : 'rejected',
          approverId,
          approvalTime: new Date(),
          approvalRemark,
        })
        .where(inArray(pickingOrder.id, ids));

      // 审批通过时，同步更新对应物料需求单状态为approved
      if (pass) {
        const reqIds = pos.map((p) => p.reqId).filter((id): id is string => !!id);
        if (reqIds.length > 0) {
          await tx.update(materialRequirement)
            .set({
              status: 'approved',
              approverId,
              approvalTime: new Date(),
              approvalRemark,
            })
            .where(inArray(materialRequirement.id, reqIds));
        }
      } else {
        // 驳回时，对应物料需求单状态改回draft，可重新提交
        const reqIds = pos.map((p) => p.reqId).filter((id): id is string => !!id);
        if (reqIds.length > 0) {
          await tx.update(materialRequirement)
            .set({
              status: 'draft',
              approverId,
              approvalTime: new Date(),
              approvalRemark,
            })
            .where(inArray(materialRequirement.id, reqIds));
        }
      }
    });

    for (const id of ids) {
      updated.push(await this.getPickingOrderById(id));
    }
    return updated;
  }

  async generatePickingOrder(body: { reqId: string; applicantId: string; applicantName: string }): Promise<PickingOrder> {
    const { reqId, applicantId } = body;

    const req = await this.db.select().from(materialRequirement).where(eq(materialRequirement.id, reqId)).limit(1);
    if (req.length === 0) throw new NotFoundException('需求单不存在');
    if (req[0].status !== 'approved') throw new BadRequestException('仅已审批的需求单可生成领料单');

    // Check if picking order already exists for this req
    const existing = await this.db.select().from(pickingOrder).where(eq(pickingOrder.reqId, reqId)).limit(1);
    if (existing.length > 0) throw new ConflictException('该需求单已生成领料单');

    const reqItems = await this.db
      .select()
      .from(materialRequirementItem)
      .where(eq(materialRequirementItem.reqId, reqId));

    const pickingNo = await this.generatePickingNo();

    const created = await this.db.transaction(async (tx) => {
      const [newPicking] = await tx.insert(pickingOrder).values({
        pickingNo,
        workOrderId: req[0].workOrderId,
        reqId,
        workSection: req[0].workSection || 'smt',
        isSupplement: req[0].workSection === 'supplement' ? true : false,
        totalQty: req[0].totalQty,
        status: 'pending_approval',
        applicantId,
      }).returning();

      const pickItems = reqItems.map((item) => ({
        pickingId: newPicking.id,
        materialId: item.materialId || '',
        materialCode: item.materialCode,
        materialName: item.materialName,
        unit: item.unit,
        pickQty: item.requiredQty,
        actualQty: '0',
      }));

      await tx.insert(pickingOrderItem).values(pickItems);

      return newPicking;
    });

    return this.getPickingOrderById(created.id);
  }

  private async generatePickingNo(): Promise<string> {
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `PK${dateStr}`;

    const result = await this.db
      .select({ pickingNo: pickingOrder.pickingNo })
      .from(pickingOrder)
      .where(ilike(pickingOrder.pickingNo, `${prefix}%`))
      .orderBy(desc(pickingOrder.pickingNo))
      .limit(1);

    let seq = 1;
    if (result.length > 0) {
      const lastSeq = parseInt(result[0].pickingNo.slice(prefix.length), 10);
      if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }

    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  async approvePickingOrder(id: string, body: {
    approverId: string;
    approverName: string;
    approvalRemark?: string;
    pass: boolean;
  }): Promise<PickingOrder> {
    const { approverId, approvalRemark, pass } = body;

    const po = await this.db.select().from(pickingOrder).where(eq(pickingOrder.id, id)).limit(1);
    if (po.length === 0) throw new NotFoundException('领料单不存在');
    if (po[0].status !== 'pending_approval') throw new BadRequestException('仅待审批状态可审批');

    await this.db.update(pickingOrder)
      .set({
        status: pass ? 'approved' : 'rejected',
        approverId,
        approvalTime: new Date(),
        approvalRemark,
      })
      .where(eq(pickingOrder.id, id));

    return this.getPickingOrderById(id);
  }

  async pickMaterial(id: string, body: {
    pickerId: string;
    pickerName: string;
    items: Array<{ id: string; actualQty: number; labelNo?: string; labelQty?: number }>;
  }): Promise<PickMaterialResult> {
    const { pickerId, items: pickItems } = body;

    const po = await this.db.select().from(pickingOrder).where(eq(pickingOrder.id, id)).limit(1);
    if (po.length === 0) throw new NotFoundException('领料单不存在');
    if (po[0].status !== 'approved') throw new BadRequestException('仅已审批的领料单可领料');

    const poItems = await this.db
      .select()
      .from(pickingOrderItem)
      .where(eq(pickingOrderItem.pickingId, id));

    if (poItems.length === 0) throw new BadRequestException('领料单无明细');

    const tailLabels: TailLabel[] = [];
    const txNo = po[0].pickingNo;

    await this.db.transaction(async (tx) => {
      for (const pickItem of pickItems) {
        const item = poItems.find((i) => i.id === pickItem.id);
        if (!item) throw new BadRequestException(`明细项不存在: ${pickItem.id}`);
        if (pickItem.actualQty <= 0) continue;
        if (pickItem.actualQty > Number(item.pickQty)) {
          throw new BadRequestException(`实际领料数量不能超过应领数量: ${item.materialCode}`);
        }

        let remaining = pickItem.actualQty;

        const goodStock = await tx
          .select({
            inventory,
            material: {
              materialCode: material.materialCode,
              materialName: material.materialName,
              specification: material.specification,
              unit: material.unit,
              expiryDays: material.expiryDays,
              packagingType: material.packagingType,
            },
            location: {
              locationCode: warehouseLocation.locationCode,
            },
            supplier: {
              supplierCode: supplier.supplierCode,
              supplierName: supplier.supplierName,
            },
          })
          .from(inventory)
          .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
          .innerJoin(material, eq(inventory.materialId, material.id))
          .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
          .where(and(
            eq(inventory.materialId, item.materialId),
            eq(inventory.stockStatus, 'good'),
            eq(inventory.locked, false),
            eq(warehouseLocation.locationType, 'good'),
            sql`(
              ${material.expiryDays} IS NULL
              OR COALESCE(
                (
                  SELECT me.new_expiry_date
                  FROM ${materialExpiryExtension} me
                  WHERE me.material_id = ${inventory.materialId}
                    AND me.batch_no = ${inventory.batchNo}
                    AND me.location_id = ${inventory.locationId}
                  ORDER BY me._created_at DESC
                  LIMIT 1
                ),
                ${inventory.productionDate} + (${material.expiryDays} || ' days')::interval
              ) > CURRENT_DATE
              OR (
                ${material.expiryDays} IS NOT NULL
                AND ${inventory.productionDate} IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM ${materialExpiryExtension} me2
                  WHERE me2.material_id = ${inventory.materialId}
                    AND me2.batch_no = ${inventory.batchNo}
                    AND me2.location_id = ${inventory.locationId}
                )
              )
            )`,
          ))
          .orderBy(inventory.productionDate, inventory.createdAt);

        const totalAvailable = goodStock.reduce(
          (sum: number, row) => sum + Number(row.inventory.quantity),
          0,
        );

        if (totalAvailable < pickItem.actualQty) {
          const lockedStock = await tx
            .select({ qty: sql<number>`sum(${inventory.quantity})::numeric` })
            .from(inventory)
            .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
            .where(and(
              eq(inventory.materialId, item.materialId),
              eq(inventory.stockStatus, 'good'),
              eq(inventory.locked, true),
              eq(warehouseLocation.locationType, 'good'),
            ));
          const lockedQty = Number(lockedStock[0]?.qty || 0);
          if (lockedQty > 0) {
            throw new ConflictException(
              `物料 ${item.materialCode} 有 ${lockedQty} 库存尚未完成检验，处于锁定状态，不可发料；可用良品库存不足`,
            );
          }

          const totalGoodStock = await tx
            .select({ qty: sql<number>`sum(${inventory.quantity})::numeric` })
            .from(inventory)
            .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
            .where(and(
              eq(inventory.materialId, item.materialId),
              eq(inventory.stockStatus, 'good'),
              eq(inventory.locked, false),
              eq(warehouseLocation.locationType, 'good'),
            ));
          const totalGoodQty = Number(totalGoodStock[0]?.qty || 0);
          if (totalGoodQty > 0 && totalAvailable === 0) {
            throw new ConflictException(
              `物料 ${item.materialCode} 已超期，禁止发料，请先做超期复检`,
            );
          }

          throw new ConflictException(`物料 ${item.materialCode} 良品库存不足`);
        }

        // 本次实际发出的总量：按「箱」扣减时可能小于请求量（一箱不够就停）
        let issuedTotal = 0;
        for (const stock of goodStock) {
          if (remaining <= 0) break;
          const stockQty = Number(stock.inventory.quantity);
          // 扫描标签代表「这一箱」：拆箱必须按箱算，不能按合并后的库存行算。
          // 同物料+库位+批次+状态在库存表里是一行（多箱合并），行数量可能远大于单箱。
          const labelQtyRaw = Number((pickItem as any).labelQty);
          const hasLabelQty = Number.isFinite(labelQtyRaw) && labelQtyRaw > 0;
          const boxQty = hasLabelQty ? labelQtyRaw : stockQty;
          // 盘装料（Reel）按物料主数据的 packagingType 自动关联盘台账，不再要求单独扫「盘号」。
          // 现场收料标签只有一个六段码（供应商*料号*生产日期*数量*批次*流水号），
          // 第 6 段流水号就是实物标签号，下方 sourceLabelNo 会直接拿它当 reel_no 记盘台账。
          // 2026-10-23 用户口径：删掉原「必须扫盘号发料」的硬拦截 —— 现场无盘号可扫。
          const isReel = (stock.material as any).packagingType === 'reel';
          if (boxQty > stockQty) {
            throw new ConflictException(
              `扫描标签数量 ${boxQty} 大于系统库存 ${stockQty}（${item.materialCode} 批次 ${stock.inventory.batchNo || '-'}），请先盘点核对后再发料`,
            );
          }
          // 一箱最多只发这一箱的量；不够时本次到此为止，由用户扫下一箱
          const deductQty = Math.min(remaining, boxQty);
          const remainQty = stockQty - deductQty;    // 库存行剩余（写流水/余额）
          const boxRemainQty = boxQty - deductQty;   // 这一箱剩余（打留库标签）
          const isSplit = boxRemainQty > 0;

          let remainLabelNo: string | null = null;
          let issueLabelNo: string | null = null;

          // 本次扫描到的实物标签流水号优先：拆箱后「留在仓库的那一箱」和「发出去的那一箱」
          // 都沿用箱子上原有的流水号，只改数量，保证可与实物标签一一对应。
          // 未传 labelNo（如人工录入/其他调用方）时回退到库存行上的标签号。
          const scannedLabelNo = (pickItem.labelNo || '').trim();
          const sourceLabelNo = scannedLabelNo || stock.inventory.labelNo || stock.inventory.batchNo || null;
          // 盘装料必须能追到「哪一盘」：标签号/批次都取不到时才拦（正常收料一定有六段码流水号）
          if (isReel && !sourceLabelNo) {
            throw new BadRequestException(
              `物料 ${item.materialCode} 是盘装料，但该库存没有标签号/批次，无法建立盘台账；请扫描物料标签（六段码）后发料`,
            );
          }

          if (isSplit) {
            remainLabelNo = sourceLabelNo;
            issueLabelNo = sourceLabelNo;
          }

          // 盘点冻结守卫：发料会改变库存，若该库位所属仓库正在盘点则拦截
          await assertLocationNotFrozen(tx, stock.inventory.locationId, '发料出库');

          if (stockQty === deductQty) {
            await tx.delete(inventory).where(eq(inventory.id, stock.inventory.id));
          } else {
            await tx.update(inventory)
              .set({
                quantity: sql`${inventory.quantity} - ${deductQty}`,
                labelNo: isSplit ? sourceLabelNo : stock.inventory.labelNo,
              })
              .where(eq(inventory.id, stock.inventory.id));
          }

          await tx.insert(inventoryTransaction).values({
            materialId: stock.inventory.materialId,
            locationId: stock.inventory.locationId,
            batchNo: stock.inventory.batchNo,
            labelNo: sourceLabelNo,
            stockStatus: 'good',
            txType: 'issue',
            txNo,
            qty: String(-deductQty),
            balanceAfter: String(remainQty),
            unit: stock.material.unit,
            referenceNo: po[0].pickingNo,
            remark: `领料出库 ${deductQty} ${stock.material.unit}`,
            createdBy: pickerId || null,
            updatedBy: pickerId || null,
          });

          if (isSplit && remainLabelNo && issueLabelNo) {
            await tx.insert(inventoryTransaction).values({
              materialId: stock.inventory.materialId,
              locationId: stock.inventory.locationId,
              batchNo: stock.inventory.batchNo,
              labelNo: sourceLabelNo,
              stockStatus: 'good',
              txType: 'split_remain',
              txNo,
              qty: String(remainQty),
              balanceAfter: String(remainQty),
              unit: stock.material.unit,
              referenceNo: po[0].pickingNo,
              remark: `拆箱留库 ${boxRemainQty} ${stock.material.unit}（本箱），库存行剩余 ${remainQty}，流水号沿用原标签 ${remainLabelNo}`,
              createdBy: pickerId || null,
              updatedBy: pickerId || null,
            });

            tailLabels.push({
              labelNo: sourceLabelNo,
              materialCode: stock.material.materialCode,
              materialName: stock.material.materialName,
              specification: stock.material.specification ?? undefined,
              unit: stock.material.unit,
              supplierCode: stock.supplier?.supplierCode || '',
              supplierName: stock.supplier?.supplierName ?? undefined,
              batchNo: stock.inventory.batchNo ?? undefined,
              productionDate: stock.inventory.productionDate
                ? String(stock.inventory.productionDate)
                : undefined,
              quantity: boxRemainQty,
              locationCode: stock.location.locationCode,
              direction: 'remain',
            });

            tailLabels.push({
              labelNo: issueLabelNo,
              materialCode: stock.material.materialCode,
              materialName: stock.material.materialName,
              specification: stock.material.specification ?? undefined,
              unit: stock.material.unit,
              supplierCode: stock.supplier?.supplierCode || '',
              supplierName: stock.supplier?.supplierName ?? undefined,
              batchNo: stock.inventory.batchNo ?? undefined,
              productionDate: stock.inventory.productionDate
                ? String(stock.inventory.productionDate)
                : undefined,
              quantity: deductQty,
              locationCode: stock.location.locationCode,
              direction: 'issue',
            });
          }

          // 盘台账：扫了盘号才记；整盘/拆盘都按本次实发数量累加
          if (sourceLabelNo) {
            await tx.execute(sql`
              INSERT INTO picking_reel
                (picking_id, picking_item_id, work_order_id, material_id, reel_no, batch_no, from_location_id, issued_qty, consumed_qty, status)
              VALUES
                (${id}::uuid, ${item.id}::uuid, ${po[0].workOrderId}::uuid, ${item.materialId}::uuid,
                 ${sourceLabelNo}, ${stock.inventory.batchNo}, ${stock.inventory.locationId}, ${deductQty}, ${deductQty}, 'issued')
              ON CONFLICT (picking_id, reel_no) DO UPDATE SET
                issued_qty = picking_reel.issued_qty + EXCLUDED.issued_qty,
                consumed_qty = (picking_reel.issued_qty + EXCLUDED.issued_qty) - picking_reel.returned_qty,
                _updated_at = CURRENT_TIMESTAMP
            `);
          }

          remaining -= deductQty;
          issuedTotal += deductQty;
          // 扫的这一箱发完还不够：停下，等用户扫下一箱，绝不能悄悄从别的箱扣
          if (hasLabelQty && remaining > 0) break;
        }

        await tx.update(pickingOrderItem)
          .set({ actualQty: String(Number(item.actualQty || 0) + issuedTotal) })
          .where(eq(pickingOrderItem.id, item.id));
      }

      await tx.update(pickingOrder)
        .set({
          status: 'issued',
          pickerId,
          pickTime: new Date(),
        })
        .where(eq(pickingOrder.id, id));

      // 发料完成 → 记一条待回写事件，与发料同事务，不会漏
      await this.enqueueMesWriteback(tx, id);
    });

    const order = await this.getPickingOrderById(id);
    return { order, tailLabels };
  }

  /**
   * 领料签收：发料完成后由领料方（生产线物料员）确认实收数量。
   *
   * 为什么需要：发料只代表仓库出库，不代表产线收到。没有这一步时，
   * 少发、错料、运输破损在系统里没有任何异议记录，completed 又是终态，
   * 事后只能靠补料/退料单纠偏。
   *
   * 差异处理：实收 < 实发时记录在明细 receive_qty / receive_remark，
   * 单据仍可签收（允许短收），差额由业务决定走补料还是退料。
   */
  async receivePickingOrder(id: string, body: {
    items?: Array<{ id: string; receivedQty: number; remark?: string }>;
    remark?: string;
    operatorId?: string;
    operatorName?: string;
    operatorRole?: string;
    operatorWorkSection?: string;
  }): Promise<PickingOrder> {
    const po = await this.db.select().from(pickingOrder).where(eq(pickingOrder.id, id)).limit(1);
    if (po.length === 0) throw new NotFoundException('领料单不存在');
    const order = po[0];
    if (!['issued', 'completed'].includes(order.status)) {
      throw new BadRequestException('仅已发料待签收的领料单可签收');
    }

    const MATERIAL_ROLES = ['production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'];
    if (body.operatorRole && body.operatorRole !== 'admin') {
      if (MATERIAL_ROLES.includes(body.operatorRole)) {
        if (body.operatorWorkSection && order.workSection !== body.operatorWorkSection) {
          throw new ForbiddenException('仅本工段物料员可签收该领料单');
        }
      } else if (!['production_manager', 'wh_manager'].includes(body.operatorRole)) {
        throw new ForbiddenException('仅领料方物料员、生产主管或仓库主管可签收');
      }
    }

    const items = await this.db
      .select()
      .from(pickingOrderItem)
      .where(eq(pickingOrderItem.pickingId, id));
    if (items.length === 0) throw new BadRequestException('领料单无明细');

    const inputMap = new Map((body.items || []).map((i) => [i.id, i]));

    await this.db.transaction(async (tx) => {
      for (const item of items) {
        const input = inputMap.get(item.id);
        const issued = Number(item.actualQty || 0);
        const recv = input ? Number(input.receivedQty) : issued;
        if (!Number.isFinite(recv) || recv < 0) {
          throw new BadRequestException(`物料 ${item.materialCode} 的实收数量无效`);
        }
        if (recv > issued) {
          throw new BadRequestException(
            `物料 ${item.materialCode} 实收 ${recv} 超过发料 ${issued}，请核对`,
          );
        }
        await tx.update(pickingOrderItem)
          .set({
            receivedQty: String(recv),
            receiveRemark: input?.remark ?? null,
            updatedAt: new Date(),
          })
          .where(eq(pickingOrderItem.id, item.id));
      }

      await tx.update(pickingOrder)
        .set({
          status: 'received',
          receivedBy: body.operatorId || null,
          receivedTime: new Date(),
          receiveRemark: body.remark ?? null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(pickingOrder.id, id),
          inArray(pickingOrder.status, ['issued', 'completed']),
        ));
    });

    return this.getPickingOrderById(id);
  }

  // ==================== SMT 盘装料台账 ====================

  /** 盘台账查询：按工单号 / 盘号 / 状态 */
  async listPickingReels(params: { workOrderNo?: string; reelNo?: string; status?: string }) {
    const conds: any[] = [];
    if (params.workOrderNo?.trim()) {
      const wo = await this.db
        .select({ id: workOrder.id })
        .from(workOrder)
        .where(eq(workOrder.workOrderNo, params.workOrderNo.trim()))
        .limit(1);
      if (wo.length === 0) throw new NotFoundException('工单不存在');
      conds.push(eq(pickingReel.workOrderId, wo[0].id));
    }
    if (params.reelNo?.trim()) conds.push(ilike(pickingReel.reelNo, `%${params.reelNo.trim()}%`));
    if (params.status?.trim()) conds.push(eq(pickingReel.status, params.status.trim()));

    const rows = await this.db
      .select({
        id: pickingReel.id,
        pickingId: pickingReel.pickingId,
        workOrderId: pickingReel.workOrderId,
        materialId: pickingReel.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        unit: material.unit,
        reelNo: pickingReel.reelNo,
        batchNo: pickingReel.batchNo,
        issuedQty: pickingReel.issuedQty,
        returnedQty: pickingReel.returnedQty,
        consumedQty: pickingReel.consumedQty,
        status: pickingReel.status,
        issuedAt: pickingReel.issuedAt,
        returnedAt: pickingReel.returnedAt,
      })
      .from(pickingReel)
      .leftJoin(material, eq(pickingReel.materialId, material.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(pickingReel.issuedAt))
      .limit(500);

    return rows.map((r) => ({
      ...r,
      materialCode: r.materialCode || '-',
      materialName: r.materialName || '-',
      issuedQty: Number(r.issuedQty || 0),
      returnedQty: Number(r.returnedQty || 0),
      consumedQty: Number(r.consumedQty || 0),
    }));
  }

  /**
   * 余料退回：优先扫原盘号；找不到盘号时按物料退回，系统生成新标签入库。
   * 退回后 consumed = issued - returned，盘状态 closed（全部退完）或 partial_returned。
   */
  async returnReel(params: {
    reelNo?: string;
    materialCode?: string;
    batchNo?: string;
    quantity: number;
    locationCode?: string;
    remark?: string;
    operatorId?: string;
    operatorName?: string;
  }) {
    const qty = Number(params.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('退回数量必须大于 0');

    let reel: any = null;
    if (params.reelNo?.trim()) {
      const rows = await this.db
        .select()
        .from(pickingReel)
        .where(and(
          eq(pickingReel.reelNo, params.reelNo.trim()),
          inArray(pickingReel.status, ['issued', 'partial_returned']),
        ))
        .orderBy(desc(pickingReel.issuedAt))
        .limit(1);
      reel = rows[0] || null;
      if (!reel) throw new BadRequestException(`盘号 ${params.reelNo} 没有待退回的发料记录`);
    }

    // 无码退回：必须给物料编码，生成新标签
    const materialCode = reel ? null : params.materialCode?.trim();
    if (!reel && !materialCode) throw new BadRequestException('找不到原盘号时必须提供物料编码');
    if (!reel && !params.batchNo?.trim()) throw new BadRequestException('找不到原盘号时必须提供批次号');

    const matRows = await this.db
      .select({ id: material.id, code: material.materialCode, name: material.materialName, unit: material.unit })
      .from(material)
      .where(eq(material.materialCode, (reel ? '' : materialCode) || ''))
      .limit(1);
    const mat = reel
      ? { id: reel.materialId, unit: 'PCS', code: '', name: '' }
      : matRows[0];
    if (!mat) throw new BadRequestException(`物料 ${materialCode} 不存在`);

    const materialId = reel ? reel.materialId : mat.id;
    const batchNo = reel ? reel.batchNo : (params.batchNo?.trim() || null);

    // 目标库位：传入优先，其次原发料库位
    let locationId = reel?.fromLocationId || null;
    if (params.locationCode?.trim()) {
      const loc = await this.db
        .select({ id: warehouseLocation.id })
        .from(warehouseLocation)
        .where(eq(warehouseLocation.locationCode, params.locationCode.trim()))
        .limit(1);
      if (loc.length === 0) throw new BadRequestException(`库位 ${params.locationCode} 不存在`);
      locationId = loc[0].id;
    }
    if (!locationId) throw new BadRequestException('请指定退回库位');

    if (reel) {
      const remain = Number(reel.issuedQty) - Number(reel.returnedQty);
      if (qty > remain) throw new BadRequestException(`退回数量 ${qty} 超过该盘可退数量 ${remain}`);
    }

    // 新标签：无原盘时生成，便于后续追溯
    const labelNo = reel?.reelNo || `RET${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(Date.now()).slice(-6)}`;
    const unit = reel ? (mat.unit || 'PCS') : (mat.unit || 'PCS');

    await this.db.transaction(async (tx) => {
      // 入库：同键行累加，否则新建
      const existing = await tx
        .select({ id: inventory.id, quantity: inventory.quantity })
        .from(inventory)
        .where(and(
          eq(inventory.materialId, materialId),
          eq(inventory.locationId, locationId!),
          batchNo ? eq(inventory.batchNo, batchNo) : sql`${inventory.batchNo} IS NULL`,
          eq(inventory.stockStatus, 'good'),
        ))
        .limit(1);

      if (existing.length > 0) {
        await tx.update(inventory)
          .set({ quantity: sql`${inventory.quantity} + ${qty}`, updatedAt: new Date() })
          .where(eq(inventory.id, existing[0].id));
      } else {
        await tx.insert(inventory).values({
          materialId,
          locationId: locationId!,
          batchNo,
          quantity: String(qty),
          unit,
          stockStatus: 'good',
          locked: false,
          labelNo,
        });
      }

      await tx.insert(inventoryTransaction).values({
        materialId,
        locationId: locationId!,
        batchNo,
        labelNo,
        stockStatus: 'good',
        txType: 'production_return_in',
        txNo: `RT${Date.now()}`,
        qty: String(qty),
        balanceAfter: null,
        unit,
        referenceNo: labelNo,
        remark: params.remark || `余料退回（盘号 ${labelNo}）`,
        createdBy: params.operatorId || null,
        updatedBy: params.operatorId || null,
      });

      if (reel) {
        const returned = Number(reel.returnedQty) + qty;
        const issued = Number(reel.issuedQty);
        await tx.update(pickingReel)
          .set({
            returnedQty: String(returned),
            consumedQty: String(Math.max(0, issued - returned)),
            status: returned >= issued ? 'closed' : 'partial_returned',
            returnedAt: new Date(),
            returnedBy: params.operatorId || null,
            remark: params.remark || reel.remark,
            updatedAt: new Date(),
          })
          .where(eq(pickingReel.id, reel.id));
      }
    });

    return { success: true, reelNo: labelNo, quantity: qty };
  }

  /** 工单用料核销：按盘汇总消耗，与 BOM 标准用量对比，超 3‰ 标记需审批 */
  async getWorkOrderConsumption(workOrderNo: string) {
    const woRows = await this.db
      .select()
      .from(workOrder)
      .where(eq(workOrder.workOrderNo, workOrderNo))
      .limit(1);
    if (woRows.length === 0) throw new NotFoundException('工单不存在');
    const wo = woRows[0];

    const reels = await this.db
      .select()
      .from(pickingReel)
      .where(eq(pickingReel.workOrderId, wo.id));

    const byMaterial = new Map<string, { issued: number; returned: number; consumed: number }>();
    for (const r of reels) {
      const cur = byMaterial.get(r.materialId) || { issued: 0, returned: 0, consumed: 0 };
      cur.issued += Number(r.issuedQty || 0);
      cur.returned += Number(r.returnedQty || 0);
      cur.consumed += Number(r.consumedQty || 0);
      byMaterial.set(r.materialId, cur);
    }

    const bomRows = wo.bomId
      ? await this.db.select().from(bomItem).where(eq(bomItem.bomId, wo.bomId))
      : [];

    const planQty = Number(wo.planQty || 0);
    const items = bomRows.map((b) => {
      const stat = byMaterial.get(b.materialId || '') || { issued: 0, returned: 0, consumed: 0 };
      const standard = Number(b.quantity || 0) * planQty;
      const actual = stat.consumed;
      const over = actual - standard;
      const rate = standard > 0 ? over / standard : 0;
      return {
        materialId: b.materialId,
        materialCode: b.materialCode,
        materialName: b.materialName,
        unit: b.unit,
        standardQty: Number(standard.toFixed(3)),
        issuedQty: stat.issued,
        returnedQty: stat.returned,
        consumedQty: stat.consumed,
        overQty: Number(over.toFixed(3)),
        overRate: Number(rate.toFixed(6)),
        needsApproval: over > 0 && rate > 0.003,
      };
    });

    // 整体超耗率按「总超耗量 / 总标准量」近似，用于工单级标记
    const totalStd = items.reduce((s, i) => s + i.standardQty, 0);
    const totalOver = items.reduce((s, i) => s + Math.max(0, i.overQty), 0);
    const overallRate = totalStd > 0 ? totalOver / totalStd : 0;
    const needsApproval = items.some((i) => i.needsApproval);

    return {
      workOrderNo: wo.workOrderNo,
      status: wo.status,
      planQty,
      overallRate: Number(overallRate.toFixed(6)),
      needsApproval,
      overConsumeStatus: wo.overConsumeStatus,
      items,
    };
  }

  /** 超耗（超补）审批：超过 3‰ 的工单需审批后才能结案 */
  async approveOverConsume(workOrderNo: string, body: {
    approved: boolean;
    remark?: string;
    operatorId?: string;
    operatorName?: string;
  }) {
    const rows = await this.db.select().from(workOrder).where(eq(workOrder.workOrderNo, workOrderNo)).limit(1);
    if (rows.length === 0) throw new NotFoundException('工单不存在');
    const summary = await this.getWorkOrderConsumption(workOrderNo);
    if (!summary.needsApproval) throw new BadRequestException('该工单未超过 3‰，无需审批');

    await this.db.update(workOrder)
      .set({
        overConsumeStatus: body.approved ? 'approved' : 'rejected',
        overConsumeRate: String(summary.overallRate),
        overConsumeQty: String(summary.items.reduce((s, i) => s + Math.max(0, i.overQty), 0)),
        overConsumeApprovedBy: body.operatorId || null,
        overConsumeApprovedTime: new Date(),
        overConsumeRemark: body.remark || null,
        updatedAt: new Date(),
      })
      .where(eq(workOrder.id, rows[0].id));

    return { success: true, status: body.approved ? 'approved' : 'rejected' };
  }

  /**
   * 记一条 MES 发料回写事件（必须在发料事务内调用，与实发数量同提交）。
   * 只对 MES 来源、且拿得到 MES 领料单号的单入队；其余静默跳过。
   * 补料后再次发料时 ON CONFLICT 重置为 pending，用最新快照重推。
   */
  private async enqueueMesWriteback(tx: any, pickingId: string) {
    try {
      await tx.execute(sql`
        INSERT INTO mes_issue_writeback (picking_id, picking_no, event_type)
        SELECT id, picking_no, 'issued' FROM picking_order
         WHERE id = ${pickingId}::uuid AND source = 'mes' AND COALESCE(mes_issue_no, '') <> ''
        ON CONFLICT (picking_id, event_type) DO UPDATE
          SET status = 'pending', next_retry_at = now(), last_error = NULL, _updated_at = now()
      `);
    } catch (e: any) {
      // 回写表没建（迁移没跑）不能拖垮发料本身
      this.logger.warn(`MES 回写入队失败（不影响发料）：${e?.message || e}`);
    }
  }

  private async getPickingOrderById(id: string): Promise<PickingOrder> {
    const result = await this.db
      .select({
        id: pickingOrder.id,
        pickingNo: pickingOrder.pickingNo,
        workOrderId: pickingOrder.workOrderId,
        workOrderNo: workOrder.workOrderNo,
        // 领料单随工单带出产品编码，便于按产品归类管理
        productCode: workOrder.productCode,
        productName: workOrder.productName,
        reqId: pickingOrder.reqId,
        workSection: pickingOrder.workSection,
        isSupplement: pickingOrder.isSupplement,
        totalQty: pickingOrder.totalQty,
        status: pickingOrder.status,
        applicantId: sql<string>`(${pickingOrder.applicantId}).user_id`.as('applicant_id'),
        applicantName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.applicantId}).user_id)::uuid LIMIT 1)`.as('applicant_name'),
        approverId: sql<string>`(${pickingOrder.approverId}).user_id`.as('approver_id'),
        approverName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.approverId}).user_id)::uuid LIMIT 1)`.as('approver_name'),
        approvalTime: pickingOrder.approvalTime,
        approvalRemark: pickingOrder.approvalRemark,
        pickerId: sql<string>`(${pickingOrder.pickerId}).user_id`.as('picker_id'),
        pickerName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.pickerId}).user_id)::uuid LIMIT 1)`.as('picker_name'),
        pickTime: pickingOrder.pickTime,
        receivedById: sql<string>`(${pickingOrder.receivedBy}).user_id`.as('received_by_id'),
        receivedByName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.receivedBy}).user_id)::uuid LIMIT 1)`.as('received_by_name'),
        receivedTime: pickingOrder.receivedTime,
        receiveRemark: pickingOrder.receiveRemark,
        remark: pickingOrder.remark,
        source: pickingOrder.source,
        mesIssueNo: pickingOrder.mesIssueNo,
      })
      .from(pickingOrder)
      .innerJoin(workOrder, eq(pickingOrder.workOrderId, workOrder.id))
      .where(eq(pickingOrder.id, id))
      .limit(1);

    if (result.length === 0) throw new NotFoundException('领料单不存在');

    const row = result[0];

    const items = await this.db
      .select()
      .from(pickingOrderItem)
      .where(eq(pickingOrderItem.pickingId, id));

    return {
      id: row.id,
      pickingNo: row.pickingNo,
      workOrderId: row.workOrderId,
      workOrderNo: row.workOrderNo,
      productCode: row.productCode ?? undefined,
      productName: row.productName ?? undefined,
      reqId: row.reqId ?? undefined,
      workSection: row.workSection,
      isSupplement: row.isSupplement,
      totalQty: Number(row.totalQty),
      status: row.status,
      applicantId: row.applicantId ?? undefined,
      applicantName: row.applicantName ?? undefined,
      approverId: row.approverId ?? undefined,
      approverName: row.approverName ?? undefined,
      approvalTime: row.approvalTime ? row.approvalTime.toISOString() : undefined,
      approvalRemark: row.approvalRemark ?? undefined,
      pickerId: row.pickerId ?? undefined,
      pickerName: row.pickerName ?? undefined,
      pickTime: row.pickTime ? row.pickTime.toISOString() : undefined,
      receivedById: row.receivedById ?? undefined,
      receivedByName: row.receivedByName ?? undefined,
      receivedTime: row.receivedTime ? row.receivedTime.toISOString() : undefined,
      receiveRemark: row.receiveRemark ?? undefined,
      remark: row.remark ?? undefined,
      source: row.source ?? undefined,
      mesIssueNo: row.mesIssueNo ?? undefined,
      items: items.map((item) => ({
        id: item.id,
        pickingId: item.pickingId,
        materialId: item.materialId,
        materialCode: item.materialCode,
        materialName: item.materialName,
        unit: item.unit,
        pickQty: Number(item.pickQty),
        actualQty: Number(item.actualQty || 0),
        receivedQty: Number(item.receivedQty || 0),
        receiveRemark: item.receiveRemark ?? undefined,
      })),
    };
  }

  async getPickingOrderByNo(pickingNo: string): Promise<PickingOrder> {
    const result = await this.db
      .select({
        id: pickingOrder.id,
        pickingNo: pickingOrder.pickingNo,
        workOrderId: pickingOrder.workOrderId,
        workOrderNo: workOrder.workOrderNo,
        // 领料单随工单带出产品编码，便于按产品归类管理
        productCode: workOrder.productCode,
        productName: workOrder.productName,
        reqId: pickingOrder.reqId,
        workSection: pickingOrder.workSection,
        isSupplement: pickingOrder.isSupplement,
        totalQty: pickingOrder.totalQty,
        status: pickingOrder.status,
        applicantId: sql<string>`(${pickingOrder.applicantId}).user_id`.as('applicant_id'),
        applicantName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.applicantId}).user_id)::uuid LIMIT 1)`.as('applicant_name'),
        approverId: sql<string>`(${pickingOrder.approverId}).user_id`.as('approver_id'),
        approverName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.approverId}).user_id)::uuid LIMIT 1)`.as('approver_name'),
        approvalTime: pickingOrder.approvalTime,
        approvalRemark: pickingOrder.approvalRemark,
        pickerId: sql<string>`(${pickingOrder.pickerId}).user_id`.as('picker_id'),
        pickerName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.pickerId}).user_id)::uuid LIMIT 1)`.as('picker_name'),
        pickTime: pickingOrder.pickTime,
        receivedById: sql<string>`(${pickingOrder.receivedBy}).user_id`.as('received_by_id'),
        receivedByName: sql<string>`(SELECT a.name FROM sys_account a WHERE a.id = ((${pickingOrder.receivedBy}).user_id)::uuid LIMIT 1)`.as('received_by_name'),
        receivedTime: pickingOrder.receivedTime,
        receiveRemark: pickingOrder.receiveRemark,
        remark: pickingOrder.remark,
        source: pickingOrder.source,
        mesIssueNo: pickingOrder.mesIssueNo,
      })
      .from(pickingOrder)
      .innerJoin(workOrder, eq(pickingOrder.workOrderId, workOrder.id))
      // 扫码枪扫到/手输的是 MES 单号时也要能打开这张单：
      // MES 单据上印的是 LL261101001-SMT，WMS 内部号是 PK202611130014，
      // 现场只会拿 MES 那张纸，所以两个号都必须能定位。
      .where(or(
        eq(pickingOrder.pickingNo, pickingNo),
        eq(pickingOrder.mesIssueNo, pickingNo),
      ))
      .limit(1);

    if (result.length === 0) throw new NotFoundException('领料单不存在');

    const row = result[0];

    const items = await this.db
      .select()
      .from(pickingOrderItem)
      .where(eq(pickingOrderItem.pickingId, row.id));

    // 各物料「可用良品库存」所在库位（PDA 领料拣货页展示）。
    // 筛选条件与 pickMaterialIncremental 的取料逻辑完全一致（良品 + 未锁定 + 良品仓 + 未超期），
    // 排序也一致（生产日期 → 入库时间，FIFO）→ 这里列出的库位顺序就是发料时实际取料的顺序。
    const materialIds = Array.from(
      new Set(items.map((i) => i.materialId).filter(Boolean)),
    ) as string[];
    const locRows = materialIds.length
      ? await this.db
          .select({
            materialId: inventory.materialId,
            locationCode: warehouseLocation.locationCode,
            batchNo: inventory.batchNo,
            quantity: inventory.quantity,
          })
          .from(inventory)
          .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
          .innerJoin(material, eq(inventory.materialId, material.id))
          .where(and(
            inArray(inventory.materialId, materialIds),
            eq(inventory.stockStatus, 'good'),
            eq(inventory.locked, false),
            eq(warehouseLocation.locationType, 'good'),
            sql`(
              ${material.expiryDays} IS NULL
              OR COALESCE(
                (
                  SELECT me.new_expiry_date
                  FROM ${materialExpiryExtension} me
                  WHERE me.material_id = ${inventory.materialId}
                    AND me.batch_no = ${inventory.batchNo}
                    AND me.location_id = ${inventory.locationId}
                  ORDER BY me._created_at DESC
                  LIMIT 1
                ),
                ${inventory.productionDate} + (${material.expiryDays} || ' days')::interval
              ) > CURRENT_DATE
              OR (
                ${material.expiryDays} IS NOT NULL
                AND ${inventory.productionDate} IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM ${materialExpiryExtension} me2
                  WHERE me2.material_id = ${inventory.materialId}
                    AND me2.batch_no = ${inventory.batchNo}
                    AND me2.location_id = ${inventory.locationId}
                )
              )
            )`,
          ))
          .orderBy(inventory.productionDate, inventory.createdAt)
      : [];

    const locationsByMaterial = new Map<
      string,
      Array<{ locationCode: string; batchNo?: string; quantity: number }>
    >();
    for (const r of locRows) {
      const key = r.materialId || '';
      if (!locationsByMaterial.has(key)) locationsByMaterial.set(key, []);
      locationsByMaterial.get(key)!.push({
        locationCode: r.locationCode,
        batchNo: r.batchNo ?? undefined,
        quantity: Number(r.quantity),
      });
    }

    const reqItems = row.reqId ? await this.db
      .select()
      .from(materialRequirementItem)
      .where(eq(materialRequirementItem.reqId, row.reqId)) : [];

    const issuedMap = new Map<string, number>();
    for (const ri of reqItems) {
      issuedMap.set(ri.materialId || '', Number(ri.issuedQty || 0));
    }

    return {
      id: row.id,
      pickingNo: row.pickingNo,
      workOrderId: row.workOrderId,
      workOrderNo: row.workOrderNo,
      productCode: row.productCode ?? undefined,
      productName: row.productName ?? undefined,
      reqId: row.reqId ?? undefined,
      workSection: row.workSection,
      isSupplement: row.isSupplement,
      totalQty: Number(row.totalQty),
      status: row.status,
      applicantId: row.applicantId ?? undefined,
      applicantName: row.applicantName ?? undefined,
      approverId: row.approverId ?? undefined,
      approverName: row.approverName ?? undefined,
      approvalTime: row.approvalTime ? row.approvalTime.toISOString() : undefined,
      approvalRemark: row.approvalRemark ?? undefined,
      pickerId: row.pickerId ?? undefined,
      pickerName: row.pickerName ?? undefined,
      pickTime: row.pickTime ? row.pickTime.toISOString() : undefined,
      receivedById: row.receivedById ?? undefined,
      receivedByName: row.receivedByName ?? undefined,
      receivedTime: row.receivedTime ? row.receivedTime.toISOString() : undefined,
      receiveRemark: row.receiveRemark ?? undefined,
      remark: row.remark ?? undefined,
      source: row.source ?? undefined,
      mesIssueNo: row.mesIssueNo ?? undefined,
      items: items.map((item) => ({
        id: item.id,
        pickingId: item.pickingId,
        materialId: item.materialId,
        materialCode: item.materialCode,
        materialName: item.materialName,
        unit: item.unit,
        pickQty: Number(item.pickQty),
        actualQty: Number(item.actualQty || 0),
        receivedQty: Number(item.receivedQty || 0),
        receiveRemark: item.receiveRemark ?? undefined,
        cumulativeQty: issuedMap.get(item.materialId || '') ?? 0,
        diffQty: Number(item.pickQty) - (issuedMap.get(item.materialId || '') ?? 0),
        locations: locationsByMaterial.get(item.materialId || '') ?? [],
      })),
    };
  }

  async pickMaterialIncremental(id: string, body: {
    pickerId: string;
    pickerName: string;
    items: Array<{ id: string; actualQty: number; labelNo?: string; labelQty?: number }>;
    userRole?: string;
    userWorkSection?: string;
  }): Promise<PickMaterialResult> {
    const { pickerId, items: pickItems, userRole, userWorkSection } = body;

    const po = await this.db.select().from(pickingOrder).where(eq(pickingOrder.id, id)).limit(1);
    if (po.length === 0) throw new NotFoundException('领料单不存在');
    if (po[0].status !== 'approved') throw new BadRequestException('仅已审批的领料单可领料');

    const MATERIAL_ROLES = ['production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'];
    if (userRole && MATERIAL_ROLES.includes(userRole)) {
      if (userWorkSection && po[0].workSection !== userWorkSection) {
        throw new ForbiddenException('仅本工段物料员可确认该领料单');
      }
    }

    const reqId = po[0].reqId;
    const tailLabels: TailLabel[] = [];
    const txNo = po[0].pickingNo;

    await this.db.transaction(async (tx) => {
      // BUG-005 修复：并发发料幂等控制。
      // 原实现把 po[0].status 与 poItems 的读取全部放在事务外，
      // 并发请求会同时通过「已审批」校验并各自扣减库存，导致库存被重复扣减（实测放大 10 倍）。
      // 这里在事务内用行锁 + 明细重读，把「校验 + 扣减」收进同一临界区。
      const lockedPo = (await tx
        .select()
        .from(pickingOrder)
        .where(eq(pickingOrder.id, id))
        .for('update')
        .limit(1)) as Array<typeof pickingOrder.$inferSelect>;

      if (lockedPo.length === 0) throw new NotFoundException('领料单不存在');
      if (lockedPo[0].status !== 'approved') {
        throw new ConflictException('该领料单已被处理或状态已变更，请刷新后重试');
      }

      // 明细在锁内重读，避免使用事务外的陈旧快照
      const lockedItems = (await tx
        .select()
        .from(pickingOrderItem)
        .where(eq(pickingOrderItem.pickingId, id))) as Array<typeof pickingOrderItem.$inferSelect>;

      if (lockedItems.length === 0) throw new BadRequestException('领料单无明细');

      for (const pickItem of pickItems) {
        const item = lockedItems.find((i) => i.id === pickItem.id);
        if (!item) throw new BadRequestException(`明细项不存在: ${pickItem.id}`);
        if (pickItem.actualQty <= 0) continue;

        const pickQty = Number(item.pickQty);
        const currentActual = Number(item.actualQty || 0);
        const remaining = pickQty - currentActual;

        if (pickItem.actualQty > remaining) {
          throw new BadRequestException(`物料 ${item.materialCode} 本次领料数量超过剩余需求`);
        }

        let remainToPick = pickItem.actualQty;
        const goodStock = await tx
          .select({
            inventory,
            material: {
              materialCode: material.materialCode,
              materialName: material.materialName,
              specification: material.specification,
              unit: material.unit,
              expiryDays: material.expiryDays,
              packagingType: material.packagingType,
            },
            location: { locationCode: warehouseLocation.locationCode },
            supplier: {
              supplierCode: supplier.supplierCode,
              supplierName: supplier.supplierName,
            },
          })
          .from(inventory)
          .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
          .innerJoin(material, eq(inventory.materialId, material.id))
          .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
          .where(and(
            eq(inventory.materialId, item.materialId),
            eq(inventory.stockStatus, 'good'),
            eq(inventory.locked, false),
            eq(warehouseLocation.locationType, 'good'),
            sql`(
              ${material.expiryDays} IS NULL
              OR COALESCE(
                (
                  SELECT me.new_expiry_date
                  FROM ${materialExpiryExtension} me
                  WHERE me.material_id = ${inventory.materialId}
                    AND me.batch_no = ${inventory.batchNo}
                    AND me.location_id = ${inventory.locationId}
                  ORDER BY me._created_at DESC
                  LIMIT 1
                ),
                ${inventory.productionDate} + (${material.expiryDays} || ' days')::interval
              ) > CURRENT_DATE
              OR (
                ${material.expiryDays} IS NOT NULL
                AND ${inventory.productionDate} IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM ${materialExpiryExtension} me2
                  WHERE me2.material_id = ${inventory.materialId}
                    AND me2.batch_no = ${inventory.batchNo}
                    AND me2.location_id = ${inventory.locationId}
                )
              )
            )`,
          ))
          .orderBy(inventory.productionDate, inventory.createdAt)
          // 必须限定 `OF inventory`：本查询 leftJoin 了 supplier，
          // 而 PostgreSQL 禁止对 outer join 的可空侧加 FOR UPDATE
          // （否则报 0A000 / make_outerjoininfo，接口直接 500）。
          .for('update', { of: inventory });

        const totalAvailable = goodStock.reduce(
          (sum: number, row) => sum + Number(row.inventory.quantity),
          0,
        );

        if (totalAvailable < pickItem.actualQty) {
          const lockedStock = await tx
            .select({ qty: sql<number>`sum(${inventory.quantity})::numeric` })
            .from(inventory)
            .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
            .where(and(
              eq(inventory.materialId, item.materialId),
              eq(inventory.stockStatus, 'good'),
              eq(inventory.locked, true),
              eq(warehouseLocation.locationType, 'good'),
            ));
          const lockedQty = Number(lockedStock[0]?.qty || 0);
          if (lockedQty > 0) {
            throw new ConflictException(
              `物料 ${item.materialCode} 有 ${lockedQty} 库存尚未完成检验，处于锁定状态，不可发料；可用良品库存不足`,
            );
          }

          const totalGoodStock = await tx
            .select({ qty: sql<number>`sum(${inventory.quantity})::numeric` })
            .from(inventory)
            .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
            .where(and(
              eq(inventory.materialId, item.materialId),
              eq(inventory.stockStatus, 'good'),
              eq(inventory.locked, false),
              eq(warehouseLocation.locationType, 'good'),
            ));
          const totalGoodQty = Number(totalGoodStock[0]?.qty || 0);
          if (totalGoodQty > 0 && totalAvailable === 0) {
            throw new ConflictException(
              `物料 ${item.materialCode} 已超期，禁止发料，请先做超期复检`,
            );
          }

          // Check for active substitutes
          const subRows = await tx
            .select({
              substituteMaterialId: materialSubstitution.substituteMaterialId,
              substituteMaterialCode: materialSubstitution.substituteMaterialCode,
              substituteMaterialName: material.materialName,
            })
            .from(materialSubstitution)
            .innerJoin(material, eq(materialSubstitution.substituteMaterialId, material.id))
            .where(and(
              eq(materialSubstitution.materialId, item.materialId),
              eq(materialSubstitution.status, 'active'),
            ));

          if (subRows.length > 0) {
            const subDetails: Array<{ code: string; name: string; stock: number }> = [];
            for (const sub of subRows) {
              const subStockRows = await tx
                .select({ qty: sql<string>`COALESCE(SUM(${inventory.quantity}), 0)`.as('qty') })
                .from(inventory)
                .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
                .where(and(
                  eq(inventory.materialId, sub.substituteMaterialId),
                  eq(inventory.stockStatus, 'good'),
                  eq(inventory.locked, false),
                  eq(warehouseLocation.locationType, 'good'),
                ));
              subDetails.push({
                code: sub.substituteMaterialCode,
                name: sub.substituteMaterialName,
                stock: Number(subStockRows[0]?.qty || 0),
              });
            }

            const availableSubs = subDetails.filter((s) => s.stock >= pickItem.actualQty);
            if (availableSubs.length > 0) {
              const sub = availableSubs[0];
              throw new ConflictException(
                `物料 ${item.materialCode} 良品库存不足，可使用替代料：${sub.code}（库存 ${sub.stock}）`,
              );
            } else {
              const subList = subDetails.map((s) => `${s.code}（库存 ${s.stock}）`).join('，');
              throw new ConflictException(
                `物料 ${item.materialCode} 良品库存不足，替代料也不足：${subList}`,
              );
            }
          }

          throw new ConflictException(`物料 ${item.materialCode} ${po[0].workSection}工段良品库存不足`);
        }

        // 本次实际发出的总量：按「箱」扣减时可能小于请求量（一箱不够就停）
        let issuedTotal = 0;
        for (const stock of goodStock) {
          if (remainToPick <= 0) break;
          const stockQty = Number(stock.inventory.quantity);
          // 扫描标签代表「这一箱」：拆箱必须按箱算，不能按合并后的库存行算。
          // 同物料+库位+批次+状态在库存表里是一行（多箱合并），行数量可能远大于单箱。
          const labelQtyRaw = Number((pickItem as any).labelQty);
          const hasLabelQty = Number.isFinite(labelQtyRaw) && labelQtyRaw > 0;
          const boxQty = hasLabelQty ? labelQtyRaw : stockQty;
          // 盘装料（Reel）按物料主数据的 packagingType 自动关联盘台账，不再要求单独扫「盘号」。
          // 现场收料标签只有一个六段码（供应商*料号*生产日期*数量*批次*流水号），
          // 第 6 段流水号就是实物标签号，下方 sourceLabelNo 会直接拿它当 reel_no 记盘台账。
          // 2026-10-23 用户口径：删掉原「必须扫盘号发料」的硬拦截 —— 现场无盘号可扫。
          const isReel = (stock.material as any).packagingType === 'reel';
          if (boxQty > stockQty) {
            throw new ConflictException(
              `扫描标签数量 ${boxQty} 大于系统库存 ${stockQty}（${item.materialCode} 批次 ${stock.inventory.batchNo || '-'}），请先盘点核对后再发料`,
            );
          }
          // 一箱最多只发这一箱的量；不够时本次到此为止，由用户扫下一箱
          const deductQty = Math.min(remainToPick, boxQty);
          const remainQty = stockQty - deductQty;    // 库存行剩余（写流水/余额）
          const boxRemainQty = boxQty - deductQty;   // 这一箱剩余（打留库标签）
          const isSplit = boxRemainQty > 0;

          let remainLabelNo: string | null = null;
          let issueLabelNo: string | null = null;

          // 本次扫描到的实物标签流水号优先：拆箱后「留在仓库的那一箱」和「发出去的那一箱」
          // 都沿用箱子上原有的流水号，只改数量，保证可与实物标签一一对应。
          // 未传 labelNo（如人工录入/其他调用方）时回退到库存行上的标签号。
          const scannedLabelNo = (pickItem.labelNo || '').trim();
          const sourceLabelNo = scannedLabelNo || stock.inventory.labelNo || stock.inventory.batchNo || null;
          // 盘装料必须能追到「哪一盘」：标签号/批次都取不到时才拦（正常收料一定有六段码流水号）
          if (isReel && !sourceLabelNo) {
            throw new BadRequestException(
              `物料 ${item.materialCode} 是盘装料，但该库存没有标签号/批次，无法建立盘台账；请扫描物料标签（六段码）后发料`,
            );
          }

          if (isSplit) {
            remainLabelNo = sourceLabelNo;
            issueLabelNo = sourceLabelNo;
          }

          // 盘点冻结守卫：发料会改变库存，若该库位所属仓库正在盘点则拦截
          await assertLocationNotFrozen(tx, stock.inventory.locationId, '发料出库');

          if (stockQty === deductQty) {
            await tx.delete(inventory).where(eq(inventory.id, stock.inventory.id));
          } else {
            await tx.update(inventory)
              .set({
                quantity: sql`${inventory.quantity} - ${deductQty}`,
                labelNo: isSplit ? sourceLabelNo : stock.inventory.labelNo,
              })
              .where(eq(inventory.id, stock.inventory.id));
          }

          await tx.insert(inventoryTransaction).values({
            materialId: stock.inventory.materialId,
            locationId: stock.inventory.locationId,
            batchNo: stock.inventory.batchNo,
            labelNo: sourceLabelNo,
            stockStatus: 'good',
            txType: 'issue',
            txNo,
            qty: String(-deductQty),
            balanceAfter: String(remainQty),
            unit: stock.material.unit,
            referenceNo: po[0].pickingNo,
            remark: `领料出库 ${deductQty} ${stock.material.unit}`,
            createdBy: pickerId || null,
            updatedBy: pickerId || null,
          });

          if (isSplit && remainLabelNo && issueLabelNo) {
            await tx.insert(inventoryTransaction).values({
              materialId: stock.inventory.materialId,
              locationId: stock.inventory.locationId,
              batchNo: stock.inventory.batchNo,
              labelNo: sourceLabelNo,
              stockStatus: 'good',
              txType: 'split_remain',
              txNo,
              qty: String(remainQty),
              balanceAfter: String(remainQty),
              unit: stock.material.unit,
              referenceNo: po[0].pickingNo,
              remark: `拆箱留库 ${boxRemainQty} ${stock.material.unit}（本箱），库存行剩余 ${remainQty}，流水号沿用原标签 ${remainLabelNo}`,
              createdBy: pickerId || null,
              updatedBy: pickerId || null,
            });

            tailLabels.push({
              labelNo: sourceLabelNo,
              materialCode: stock.material.materialCode,
              materialName: stock.material.materialName,
              specification: stock.material.specification ?? undefined,
              unit: stock.material.unit,
              supplierCode: stock.supplier?.supplierCode || '',
              supplierName: stock.supplier?.supplierName ?? undefined,
              batchNo: stock.inventory.batchNo ?? undefined,
              productionDate: stock.inventory.productionDate
                ? String(stock.inventory.productionDate)
                : undefined,
              quantity: boxRemainQty,
              locationCode: stock.location.locationCode,
              direction: 'remain',
            });

            tailLabels.push({
              labelNo: issueLabelNo,
              materialCode: stock.material.materialCode,
              materialName: stock.material.materialName,
              specification: stock.material.specification ?? undefined,
              unit: stock.material.unit,
              supplierCode: stock.supplier?.supplierCode || '',
              supplierName: stock.supplier?.supplierName ?? undefined,
              batchNo: stock.inventory.batchNo ?? undefined,
              productionDate: stock.inventory.productionDate
                ? String(stock.inventory.productionDate)
                : undefined,
              quantity: deductQty,
              locationCode: stock.location.locationCode,
              direction: 'issue',
            });
          }

          // 盘台账：扫了盘号才记；整盘/拆盘都按本次实发数量累加
          if (sourceLabelNo) {
            await tx.execute(sql`
              INSERT INTO picking_reel
                (picking_id, picking_item_id, work_order_id, material_id, reel_no, batch_no, from_location_id, issued_qty, consumed_qty, status)
              VALUES
                (${id}::uuid, ${item.id}::uuid, ${po[0].workOrderId}::uuid, ${item.materialId}::uuid,
                 ${sourceLabelNo}, ${stock.inventory.batchNo}, ${stock.inventory.locationId}, ${deductQty}, ${deductQty}, 'issued')
              ON CONFLICT (picking_id, reel_no) DO UPDATE SET
                issued_qty = picking_reel.issued_qty + EXCLUDED.issued_qty,
                consumed_qty = (picking_reel.issued_qty + EXCLUDED.issued_qty) - picking_reel.returned_qty,
                _updated_at = CURRENT_TIMESTAMP
            `);
          }

          remainToPick -= deductQty;
          issuedTotal += deductQty;
          // 扫的这一箱发完还不够：停下，等用户扫下一箱，绝不能悄悄从别的箱扣
          if (hasLabelQty && remainToPick > 0) break;
        }

        await tx.update(pickingOrderItem)
          .set({ actualQty: sql`${pickingOrderItem.actualQty} + ${issuedTotal}` })
          .where(eq(pickingOrderItem.id, item.id));

        if (reqId) {
          await tx.update(materialRequirementItem)
            .set({ issuedQty: sql`${materialRequirementItem.issuedQty} + ${issuedTotal}` })
            .where(and(
              eq(materialRequirementItem.reqId, reqId),
              eq(materialRequirementItem.materialId, item.materialId),
            ));
        }
      }

      const updatedItems = await tx
        .select()
        .from(pickingOrderItem)
        .where(eq(pickingOrderItem.pickingId, id));

      const allFullyPicked = updatedItems.every((i) => Number(i.actualQty || 0) >= Number(i.pickQty));

      if (allFullyPicked) {
        await tx.update(pickingOrder)
          .set({
            status: 'issued',
            pickerId,
            pickTime: new Date(),
          })
          .where(eq(pickingOrder.id, id));
        // 发料完成 → 记一条待回写事件，与发料同事务，不会漏
        await this.enqueueMesWriteback(tx, id);
      } else {
        await tx.update(pickingOrder)
          .set({
            pickerId,
            pickTime: new Date(),
          })
          .where(eq(pickingOrder.id, id));
      }
    });

    const order = await this.getPickingOrderByNo(po[0].pickingNo);
    return { order, tailLabels };
  }

  async pickWithSubstitution(id: string, body: {
    pickerId: string;
    pickerName: string;
    items: Array<{ id: string; actualQty: number; labelNo?: string; labelQty?: number }>;
    substitutionMap: Record<string, string>;
    userRole?: string;
    userWorkSection?: string;
  }): Promise<PickMaterialResult> {
    const { pickerId, items: pickItems, substitutionMap, userRole, userWorkSection } = body;

    const po = await this.db.select().from(pickingOrder).where(eq(pickingOrder.id, id)).limit(1);
    if (po.length === 0) throw new NotFoundException('领料单不存在');
    if (po[0].status !== 'approved') throw new BadRequestException('仅已审批的领料单可领料');

    const MATERIAL_ROLES = ['production_material_smt', 'production_material_dip', 'production_material_assembly', 'production_material_packing'];
    if (userRole && MATERIAL_ROLES.includes(userRole)) {
      if (userWorkSection && po[0].workSection !== userWorkSection) {
        throw new ForbiddenException('仅本工段物料员可确认该领料单');
      }
    }

    const poItems = await this.db
      .select()
      .from(pickingOrderItem)
      .where(eq(pickingOrderItem.pickingId, id));

    if (poItems.length === 0) throw new BadRequestException('领料单无明细');

    const reqId = po[0].reqId;
    const tailLabels: TailLabel[] = [];
    const txNo = po[0].pickingNo;

    await this.db.transaction(async (tx) => {
      for (const pickItem of pickItems) {
        const item = poItems.find((i) => i.id === pickItem.id);
        if (!item) throw new BadRequestException(`明细项不存在: ${pickItem.id}`);
        if (pickItem.actualQty <= 0) continue;

        const pickQty = Number(item.pickQty);
        const currentActual = Number(item.actualQty || 0);
        const remaining = pickQty - currentActual;

        if (pickItem.actualQty > remaining) {
          throw new BadRequestException(`物料 ${item.materialCode} 本次领料数量超过剩余需求`);
        }

        // Determine which material to use for picking
        let effectiveMaterialId = item.materialId!;
        let effectiveMaterialCode = item.materialCode;
        let effectiveMaterialName = item.materialName;
        let isSubstitution = false;
        let originalMaterialCode = item.materialCode;

        const substituteMaterialId = substitutionMap[pickItem.id];
        if (substituteMaterialId) {
          // Validate substitution relationship exists and is active
          const subCheck = await tx
            .select({
              id: materialSubstitution.id,
              subCode: materialSubstitution.substituteMaterialCode,
              subName: material.materialName,
            })
            .from(materialSubstitution)
            .innerJoin(material, eq(materialSubstitution.substituteMaterialId, material.id))
            .where(and(
              eq(materialSubstitution.materialId, item.materialId!),
              eq(materialSubstitution.substituteMaterialId, substituteMaterialId),
              eq(materialSubstitution.status, 'active'),
            ))
            .limit(1);

          if (subCheck.length === 0) {
            throw new BadRequestException(
              `明细项 ${pickItem.id} 的替代关系不存在或未启用`,
            );
          }

          effectiveMaterialId = substituteMaterialId;
          effectiveMaterialCode = subCheck[0].subCode;
          effectiveMaterialName = subCheck[0].subName;
          isSubstitution = true;
          originalMaterialCode = item.materialCode;
        }

        let remainToPick = pickItem.actualQty;
        const goodStock = await tx
          .select({
            inventory,
            material: {
              materialCode: material.materialCode,
              materialName: material.materialName,
              specification: material.specification,
              unit: material.unit,
              expiryDays: material.expiryDays,
              packagingType: material.packagingType,
            },
            location: { locationCode: warehouseLocation.locationCode },
            supplier: {
              supplierCode: supplier.supplierCode,
              supplierName: supplier.supplierName,
            },
          })
          .from(inventory)
          .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
          .innerJoin(material, eq(inventory.materialId, material.id))
          .leftJoin(supplier, eq(inventory.supplierId, supplier.id))
          .where(and(
            eq(inventory.materialId, effectiveMaterialId),
            eq(inventory.stockStatus, 'good'),
            eq(inventory.locked, false),
            eq(warehouseLocation.locationType, 'good'),
            sql`(
              ${material.expiryDays} IS NULL
              OR COALESCE(
                (
                  SELECT me.new_expiry_date
                  FROM ${materialExpiryExtension} me
                  WHERE me.material_id = ${inventory.materialId}
                    AND me.batch_no = ${inventory.batchNo}
                    AND me.location_id = ${inventory.locationId}
                  ORDER BY me._created_at DESC
                  LIMIT 1
                ),
                ${inventory.productionDate} + (${material.expiryDays} || ' days')::interval
              ) > CURRENT_DATE
              OR (
                ${material.expiryDays} IS NOT NULL
                AND ${inventory.productionDate} IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM ${materialExpiryExtension} me2
                  WHERE me2.material_id = ${inventory.materialId}
                    AND me2.batch_no = ${inventory.batchNo}
                    AND me2.location_id = ${inventory.locationId}
                )
              )
            )`,
          ))
          .orderBy(inventory.productionDate, inventory.createdAt);

        const totalAvailable = goodStock.reduce(
          (sum: number, row) => sum + Number(row.inventory.quantity),
          0,
        );

        if (totalAvailable < pickItem.actualQty) {
          const lockedStock = await tx
            .select({ qty: sql<number>`sum(${inventory.quantity})::numeric` })
            .from(inventory)
            .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
            .where(and(
              eq(inventory.materialId, effectiveMaterialId),
              eq(inventory.stockStatus, 'good'),
              eq(inventory.locked, true),
              eq(warehouseLocation.locationType, 'good'),
            ));
          const lockedQty = Number(lockedStock[0]?.qty || 0);
          if (lockedQty > 0) {
            throw new ConflictException(
              `物料 ${effectiveMaterialCode} 有 ${lockedQty} 库存尚未完成检验，处于锁定状态，不可发料；可用良品库存不足`,
            );
          }

          const totalGoodStock = await tx
            .select({ qty: sql<number>`sum(${inventory.quantity})::numeric` })
            .from(inventory)
            .innerJoin(warehouseLocation, eq(inventory.locationId, warehouseLocation.id))
            .where(and(
              eq(inventory.materialId, effectiveMaterialId),
              eq(inventory.stockStatus, 'good'),
              eq(inventory.locked, false),
              eq(warehouseLocation.locationType, 'good'),
            ));
          const totalGoodQty = Number(totalGoodStock[0]?.qty || 0);
          if (totalGoodQty > 0 && totalAvailable === 0) {
            throw new ConflictException(
              `物料 ${effectiveMaterialCode} 已超期，禁止发料，请先做超期复检`,
            );
          }

          throw new ConflictException(`物料 ${effectiveMaterialCode} ${po[0].workSection}工段良品库存不足`);
        }

        // Build transaction remark
        const txRemarkBase = isSubstitution
          ? `替代发料：原物料 ${originalMaterialCode} → 替代料 ${effectiveMaterialCode}`
          : `领料出库`;

        // 本次实际发出的总量：按「箱」扣减时可能小于请求量（一箱不够就停）
        let issuedTotal = 0;
        for (const stock of goodStock) {
          if (remainToPick <= 0) break;
          const stockQty = Number(stock.inventory.quantity);
          // 扫描标签代表「这一箱」：拆箱必须按箱算，不能按合并后的库存行算。
          // 同物料+库位+批次+状态在库存表里是一行（多箱合并），行数量可能远大于单箱。
          const labelQtyRaw = Number((pickItem as any).labelQty);
          const hasLabelQty = Number.isFinite(labelQtyRaw) && labelQtyRaw > 0;
          const boxQty = hasLabelQty ? labelQtyRaw : stockQty;
          // 盘装料（Reel）按物料主数据的 packagingType 自动关联盘台账，不再要求单独扫「盘号」。
          // 现场收料标签只有一个六段码（供应商*料号*生产日期*数量*批次*流水号），
          // 第 6 段流水号就是实物标签号，下方 sourceLabelNo 会直接拿它当 reel_no 记盘台账。
          // 2026-10-23 用户口径：删掉原「必须扫盘号发料」的硬拦截 —— 现场无盘号可扫。
          const isReel = (stock.material as any).packagingType === 'reel';
          if (boxQty > stockQty) {
            throw new ConflictException(
              `扫描标签数量 ${boxQty} 大于系统库存 ${stockQty}（${item.materialCode} 批次 ${stock.inventory.batchNo || '-'}），请先盘点核对后再发料`,
            );
          }
          // 一箱最多只发这一箱的量；不够时本次到此为止，由用户扫下一箱
          const deductQty = Math.min(remainToPick, boxQty);
          const remainQty = stockQty - deductQty;    // 库存行剩余（写流水/余额）
          const boxRemainQty = boxQty - deductQty;   // 这一箱剩余（打留库标签）
          const isSplit = boxRemainQty > 0;

          let remainLabelNo: string | null = null;
          let issueLabelNo: string | null = null;

          // 本次扫描到的实物标签流水号优先：拆箱后「留在仓库的那一箱」和「发出去的那一箱」
          // 都沿用箱子上原有的流水号，只改数量，保证可与实物标签一一对应。
          // 未传 labelNo（如人工录入/其他调用方）时回退到库存行上的标签号。
          const scannedLabelNo = (pickItem.labelNo || '').trim();
          const sourceLabelNo = scannedLabelNo || stock.inventory.labelNo || stock.inventory.batchNo || null;
          // 盘装料必须能追到「哪一盘」：标签号/批次都取不到时才拦（正常收料一定有六段码流水号）
          if (isReel && !sourceLabelNo) {
            throw new BadRequestException(
              `物料 ${item.materialCode} 是盘装料，但该库存没有标签号/批次，无法建立盘台账；请扫描物料标签（六段码）后发料`,
            );
          }

          if (isSplit) {
            remainLabelNo = sourceLabelNo;
            issueLabelNo = sourceLabelNo;
          }

          // 盘点冻结守卫：发料会改变库存，若该库位所属仓库正在盘点则拦截
          await assertLocationNotFrozen(tx, stock.inventory.locationId, '发料出库');

          if (stockQty === deductQty) {
            await tx.delete(inventory).where(eq(inventory.id, stock.inventory.id));
          } else {
            await tx.update(inventory)
              .set({
                quantity: sql`${inventory.quantity} - ${deductQty}`,
                labelNo: isSplit ? sourceLabelNo : stock.inventory.labelNo,
              })
              .where(eq(inventory.id, stock.inventory.id));
          }

          await tx.insert(inventoryTransaction).values({
            materialId: stock.inventory.materialId,
            locationId: stock.inventory.locationId,
            batchNo: stock.inventory.batchNo,
            labelNo: sourceLabelNo,
            stockStatus: 'good',
            txType: 'issue',
            txNo,
            qty: String(-deductQty),
            balanceAfter: String(remainQty),
            unit: stock.material.unit,
            referenceNo: po[0].pickingNo,
            remark: `${txRemarkBase} ${deductQty} ${stock.material.unit}`,
            createdBy: pickerId || null,
            updatedBy: pickerId || null,
          });

          if (isSplit && remainLabelNo && issueLabelNo) {
            await tx.insert(inventoryTransaction).values({
              materialId: stock.inventory.materialId,
              locationId: stock.inventory.locationId,
              batchNo: stock.inventory.batchNo,
              labelNo: sourceLabelNo,
              stockStatus: 'good',
              txType: 'split_remain',
              txNo,
              qty: String(remainQty),
              balanceAfter: String(remainQty),
              unit: stock.material.unit,
              referenceNo: po[0].pickingNo,
              remark: `拆箱留库 ${boxRemainQty} ${stock.material.unit}（本箱），库存行剩余 ${remainQty}，流水号沿用原标签 ${remainLabelNo}`,
              createdBy: pickerId || null,
              updatedBy: pickerId || null,
            });

            tailLabels.push({
              labelNo: sourceLabelNo,
              materialCode: stock.material.materialCode,
              materialName: stock.material.materialName,
              specification: stock.material.specification ?? undefined,
              unit: stock.material.unit,
              supplierCode: stock.supplier?.supplierCode || '',
              supplierName: stock.supplier?.supplierName ?? undefined,
              batchNo: stock.inventory.batchNo ?? undefined,
              productionDate: stock.inventory.productionDate
                ? String(stock.inventory.productionDate)
                : undefined,
              quantity: boxRemainQty,
              locationCode: stock.location.locationCode,
              direction: 'remain',
            });

            tailLabels.push({
              labelNo: issueLabelNo,
              materialCode: stock.material.materialCode,
              materialName: stock.material.materialName,
              specification: stock.material.specification ?? undefined,
              unit: stock.material.unit,
              supplierCode: stock.supplier?.supplierCode || '',
              supplierName: stock.supplier?.supplierName ?? undefined,
              batchNo: stock.inventory.batchNo ?? undefined,
              productionDate: stock.inventory.productionDate
                ? String(stock.inventory.productionDate)
                : undefined,
              quantity: deductQty,
              locationCode: stock.location.locationCode,
              direction: 'issue',
            });
          }

          // 盘台账：扫了盘号才记；整盘/拆盘都按本次实发数量累加
          if (sourceLabelNo) {
            await tx.execute(sql`
              INSERT INTO picking_reel
                (picking_id, picking_item_id, work_order_id, material_id, reel_no, batch_no, from_location_id, issued_qty, consumed_qty, status)
              VALUES
                (${id}::uuid, ${item.id}::uuid, ${po[0].workOrderId}::uuid, ${item.materialId}::uuid,
                 ${sourceLabelNo}, ${stock.inventory.batchNo}, ${stock.inventory.locationId}, ${deductQty}, ${deductQty}, 'issued')
              ON CONFLICT (picking_id, reel_no) DO UPDATE SET
                issued_qty = picking_reel.issued_qty + EXCLUDED.issued_qty,
                consumed_qty = (picking_reel.issued_qty + EXCLUDED.issued_qty) - picking_reel.returned_qty,
                _updated_at = CURRENT_TIMESTAMP
            `);
          }

          remainToPick -= deductQty;
          issuedTotal += deductQty;
          // 扫的这一箱发完还不够：停下，等用户扫下一箱，绝不能悄悄从别的箱扣
          if (hasLabelQty && remainToPick > 0) break;
        }

        // Update picking order item: accumulate actualQty, set actual material info if substituted
        const itemUpdate: Record<string, unknown> = {
          actualQty: sql`${pickingOrderItem.actualQty} + ${issuedTotal}`,
        };
        if (isSubstitution) {
          itemUpdate.actualMaterialId = effectiveMaterialId;
          itemUpdate.actualMaterialCode = effectiveMaterialCode;
        }
        await tx.update(pickingOrderItem)
          .set(itemUpdate)
          .where(eq(pickingOrderItem.id, item.id));

        // Update requirement issuedQty against the ORIGINAL material
        if (reqId) {
          await tx.update(materialRequirementItem)
            .set({ issuedQty: sql`${materialRequirementItem.issuedQty} + ${issuedTotal}` })
            .where(and(
              eq(materialRequirementItem.reqId, reqId),
              eq(materialRequirementItem.materialId, item.materialId),
            ));
        }
      }

      const updatedItems = await tx
        .select()
        .from(pickingOrderItem)
        .where(eq(pickingOrderItem.pickingId, id));

      const allFullyPicked = updatedItems.every((i) => Number(i.actualQty || 0) >= Number(i.pickQty));

      if (allFullyPicked) {
        await tx.update(pickingOrder)
          .set({
            status: 'issued',
            pickerId,
            pickTime: new Date(),
          })
          .where(eq(pickingOrder.id, id));
        // 发料完成 → 记一条待回写事件，与发料同事务，不会漏
        await this.enqueueMesWriteback(tx, id);
      } else {
        await tx.update(pickingOrder)
          .set({
            pickerId,
            pickTime: new Date(),
          })
          .where(eq(pickingOrder.id, id));
      }
    });

    const order = await this.getPickingOrderByNo(po[0].pickingNo);
    return { order, tailLabels };
  }

  // ========== Supplement ==========

  async getSupplementList(params: {
    page: number;
    pageSize: number;
    parentOrderNo?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PaginatedResponse<WorkOrder>> {
    return this.getWorkOrderList({
      ...params,
      isSupplement: true,
    });
  }

  async createSupplement(body: {
    parentOrderNo: string;
    supplementItems: Array<{ materialId: string; materialCode?: string; materialName?: string; unit?: string; quantity: number; workSection: string }>;
    reason: string;
    applicantId: string;
    applicantName: string;
  }): Promise<{ workOrder: WorkOrder; pickingOrders: PickingOrder[] }> {
    const { parentOrderNo, supplementItems, reason, applicantId } = body;

    if (!supplementItems || supplementItems.length === 0) {
      throw new BadRequestException('超补物料不能为空');
    }

    const parent = await this.db.select().from(workOrder).where(eq(workOrder.workOrderNo, parentOrderNo)).limit(1);

    const workOrderNo = `${parentOrderNo}-CB`;
    const hasParent = parent.length > 0;
    const parentRec = parent[0];

    const result = await this.db.transaction(async (tx) => {
      // Create supplement work order
      const [supWo] = await tx.insert(workOrder).values({
        workOrderNo,
        bomId: hasParent ? parentRec.bomId : sql`null`,
        productCode: hasParent ? parentRec.productCode : '',
        productName: hasParent ? parentRec.productName : '',
        planQty: '0',
        workOrderDate: new Date().toISOString().split('T')[0],
        isSupplement: true,
        parentOrderId: hasParent ? parentRec.id : sql`null`,
        status: 'created',
        plannerId: applicantId,
        remark: reason,
      }).returning();

      // Group items by work section
      const itemsBySection = new Map<string, typeof supplementItems>();
      for (const item of supplementItems) {
        const section = normalizeWorkSection(item.workSection);
        if (!itemsBySection.has(section)) itemsBySection.set(section, []);
        itemsBySection.get(section)!.push(item);
      }

      const pickingOrderIds: string[] = [];

      for (const section of WORK_SECTIONS) {
        const sectionItems = itemsBySection.get(section);
        if (!sectionItems || sectionItems.length === 0) continue;

        const pickingNo = await this.generatePickingNo();
        const totalQty = sectionItems.reduce(
          (sum: number, item) => sum + item.quantity,
          0,
        );

        const [newPicking] = await tx.insert(pickingOrder).values({
          pickingNo,
          workOrderId: supWo.id,
          workSection: section,
          isSupplement: true,
          totalQty: String(totalQty),
          status: 'pending_approval',
          applicantId,
          remark: reason,
        }).returning();

        const pickItems = sectionItems.map((item) => ({
          pickingId: newPicking.id,
          materialId: item.materialId || '00000000-0000-0000-0000-000000000000',
          materialCode: item.materialCode || '',
          materialName: item.materialName || '',
          unit: item.unit || 'PCS',
          pickQty: String(item.quantity),
          actualQty: '0',
        }));

        await tx.insert(pickingOrderItem).values(pickItems);
        pickingOrderIds.push(newPicking.id);
      }

      return { workOrder: supWo, pickingOrderIds };
    });

    const pickingOrders = await Promise.all(
      result.pickingOrderIds.map((id: string) => this.getPickingOrderById(id)),
    );

    const wo = result.workOrder;
    const workOrderObj: WorkOrder = {
      id: wo.id,
      workOrderNo: wo.workOrderNo,
      bomId: wo.bomId ?? undefined,
      bomCode: undefined,
      productCode: wo.productCode || '',
      productName: wo.productName || '',
      planQty: Number(wo.planQty),
      actualQty: Number(wo.actualQty),
      workOrderDate: typeof wo.workOrderDate === 'string' ? wo.workOrderDate : (wo.workOrderDate as Date).toISOString().split('T')[0],
      isSupplement: wo.isSupplement ?? false,
      parentOrderId: wo.parentOrderId ?? undefined,
      status: wo.status,
      remark: wo.remark ?? undefined,
    };

    return { workOrder: workOrderObj, pickingOrders };
  }

  async getIssueRecords(params: any) {
    const { materialCode, batchNo, startDate, endDate } = params;
    const limit = Math.min(Number(params.pageSize) || 20, 200);
    const page = Number(params.page) || 1;
    const offset = (page - 1) * limit;

    // 日期入参格式校验：非法值直接 400，避免落库层 timestamptz 转换失败抛 500
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate && !DATE_RE.test(String(startDate))) {
      throw new BadRequestException('startDate 格式应为 YYYY-MM-DD');
    }
    if (endDate && !DATE_RE.test(String(endDate))) {
      throw new BadRequestException('endDate 格式应为 YYYY-MM-DD');
    }

    // 全部筛选条件走 Drizzle 参数化占位符。
    // 历史实现把用户输入字符串直接拼进 SQL 再交 sql.raw 执行，
    // 存在 SQL 注入（实测 ?materialCode=' OR 1=1 -- 可绕过 qty<0 过滤读取全表）。
    const conditions: any[] = [sql`it.qty < 0`];
    if (materialCode) conditions.push(sql`m.material_code ILIKE ${'%' + materialCode + '%'}`);
    if (batchNo) conditions.push(sql`it.batch_no ILIKE ${'%' + batchNo + '%'}`);
    if (startDate) conditions.push(sql`it._created_at >= ${startDate + ' 00:00:00+08'}::timestamptz`);
    if (endDate) conditions.push(sql`it._created_at <= ${endDate + ' 23:59:59+08'}::timestamptz`);

    const whereSql = sql` WHERE ${sql.join(conditions, sql` AND `)}`;
    // 查询主体（不含排序/分页），供列表与 count 复用
    const baseSql = sql`
      SELECT it.id, it._created_at as created_at, m.material_code as material_code, m.material_name as material_name,
             it.batch_no as batch_no, it.qty as qty, it.unit as unit, it.reference_no as reference_no,
             wo.work_order_no as work_order_no
      FROM inventory_transaction it
      INNER JOIN material m ON it.material_id = m.id
      LEFT JOIN picking_order po ON it.reference_no = po.picking_no
      LEFT JOIN work_order wo ON po.work_order_id = wo.id${whereSql}`;

    const rows: any[] = await this.db.execute(
      sql`${baseSql} ORDER BY it._created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    );
    const countRows: any[] = await this.db.execute(
      sql`SELECT count(*)::int AS total FROM (${baseSql}) t`,
    );

    return {
      total: countRows[0]?.total || 0,
      page,
      pageSize: limit,
      items: rows.map((r: any) => ({
        id: r.id,
        createdAt: r.created_at ? new Date(r.created_at).toLocaleString('zh-CN', { hour12: false }) : '',
        materialCode: r.material_code,
        materialName: r.material_name,
        batchNo: r.batch_no,
        qty: Number(r.qty),
        unit: r.unit,
        referenceNo: r.reference_no,
        workOrderNo: r.work_order_no || '-',
      })),
    };
  }

  // ========== 工单召回/结案/取消（2026-09-30 补齐，此前方法缺失导致接口必崩） ==========

  /**
   * 判定工单是否「由 MES 管控」——即 WMS 侧还能不能下发/撤回/结案/取消。
   *
   * 判定依据（2026-10-31 第二次修订：**以领料单来源为准**，不再只看工单来源）：
   * 1. 存在任意未取消、`source='mes'` 的领料单 → MES 管控。
   *    料是 MES 领的，结案自然也在 MES；这条同时覆盖「MES 工单号与手工工单撞车、
   *    工单仍是 manual 但领料单是 MES 同步进来的」这种例外。
   * 2. 有领料单但都不是 MES 的 → **WMS 自己触发**的领料单，保留原有 WMS 功能（下发/撤回/结案/取消）。
   * 3. 一张领料单都没有且工单本身来自 MES → MES 管控。
   *    否则 WMS 抢先按 BOM 开单，会和 MES 随后同步进来的领料单重复发料。
   */
  private async resolveMesControl(
    db: any,
    wo: { id: string; source?: string | null },
  ): Promise<{ controlled: boolean; reason: 'mesPicking' | 'mesWorkOrder' | null; mesIssueNos: string[] }> {
    const rows = await db
      .select({
        source: pickingOrder.source,
        status: pickingOrder.status,
        mesIssueNo: pickingOrder.mesIssueNo,
      })
      .from(pickingOrder)
      .where(eq(pickingOrder.workOrderId, wo.id));

    const active = rows.filter((r: any) => r.status !== 'cancelled');
    const mesRows = active.filter((r: any) => r.source === 'mes');
    if (mesRows.length > 0) {
      const nos = Array.from(
        new Set(mesRows.map((r: any) => r.mesIssueNo).filter(Boolean) as string[]),
      );
      return { controlled: true, reason: 'mesPicking', mesIssueNos: nos };
    }
    if (active.length > 0) return { controlled: false, reason: null, mesIssueNos: [] };
    if ((wo.source || 'manual') === 'mes') return { controlled: true, reason: 'mesWorkOrder', mesIssueNos: [] };
    return { controlled: false, reason: null, mesIssueNos: [] };
  }

  /**
   * MES 管控工单的写操作拦截：拒绝并给出「去 MES 操作」的可执行提示。
   * 提示里带上 MES 领料单号 / 工单号，现场能直接定位到 MES 的那张单。
   */
  private async assertWorkOrderOperable(
    db: any,
    wo: { id: string; source?: string | null; mesMoNo?: string | null },
    action: '下发' | '撤回' | '结案' | '取消',
  ): Promise<void> {
    const ctl = await this.resolveMesControl(db, wo);
    if (!ctl.controlled) return;

    const subject =
      ctl.reason === 'mesPicking'
        ? `该工单的领料单来自 MES 同步${
            ctl.mesIssueNos.length ? `（MES 领料单 ${ctl.mesIssueNos.join('、')}）` : ''
          }`
        : `该工单由 MES 同步${wo.mesMoNo ? `（MES 工单号 ${wo.mesMoNo}）` : ''}`;

    if (action === '下发') {
      throw new BadRequestException(
        `${subject}，领料单由 MES 下发，WMS 不再按 BOM 生成；如需发料请等 MES 的领料单同步进来`,
      );
    }
    throw new BadRequestException(
      `${subject}，${action}请在 MES 中操作；WMS 只负责按领料单发料并把发料结果回写 MES`,
    );
  }

  /**
   * 召回工单：工单已下发（提交），领料单未被批准前，允许下发工单的账户召回。
   * 召回 = 取消所有待审批领料单 + 工单退回草稿。
   */
  async recallWorkOrder(workOrderNo: string, operatorId?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [wo] = await tx
        .select({
          id: workOrder.id,
          status: workOrder.status,
          workOrderNo: workOrder.workOrderNo,
          source: workOrder.source,
          mesMoNo: workOrder.mesMoNo,
        })
        .from(workOrder)
        .where(eq(workOrder.workOrderNo, workOrderNo))
        .for('update');
      if (!wo) throw new NotFoundException('工单不存在');
      await this.assertWorkOrderOperable(tx, wo, '撤回');
      if (wo.status !== 'released') {
        throw new BadRequestException('仅已下发且待审批的工单可召回');
      }

      const picks = await tx
        .select({ id: pickingOrder.id, status: pickingOrder.status, applicantId: pickingOrder.applicantId })
        .from(pickingOrder)
        .where(eq(pickingOrder.workOrderId, wo.id))
        .for('update');

      // 历史已取消的领料单（此前轮次撤回/取消产生）不参与状态判断
      const activePicks = picks.filter((p) => p.status !== 'cancelled');

      // 规则：领料单未被批准前才可召回
      const notPending = activePicks.filter((p) => p.status !== 'pending_approval');
      if (notPending.length > 0) {
        throw new ConflictException('领料单已审批，工单不可召回');
      }

      // 规则：仅下发工单的账户可召回（下发人记录在领料单 applicantId 上）
      if (operatorId) {
        const issuers = new Set(activePicks.map((p) => p.applicantId).filter(Boolean) as string[]);
        if (issuers.size > 0 && !issuers.has(operatorId)) {
          throw new ForbiddenException('仅下发工单的账户可召回');
        }
      }

      // 取消所有待审批领料单
      if (activePicks.length > 0) {
        await tx
          .update(pickingOrder)
          .set({
            status: 'cancelled',
            remark: `工单召回，自动取消待审批领料单`,
            updatedAt: new Date(),
          })
          .where(and(eq(pickingOrder.workOrderId, wo.id), eq(pickingOrder.status, 'pending_approval')));
      }

      // 工单退回草稿，可重新下发
      await tx
        .update(workOrder)
        .set({ status: 'draft', updatedAt: new Date() })
        .where(eq(workOrder.id, wo.id));
    });
  }

  /**
   * 结案工单：所有领料已全部完成后，人工确认关闭结案。
   */
  async closeWorkOrder(workOrderNo: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [wo] = await tx
        .select({
          id: workOrder.id,
          status: workOrder.status,
          source: workOrder.source,
          mesMoNo: workOrder.mesMoNo,
        })
        .from(workOrder)
        .where(eq(workOrder.workOrderNo, workOrderNo))
        .for('update');
      if (!wo) throw new NotFoundException('工单不存在');
      // 领料单来自 MES 的，结案回 MES；WMS 自己开单的工单照旧在 WMS 结案
      await this.assertWorkOrderOperable(tx, wo, '结案');
      if (wo.status === 'closed') throw new BadRequestException('工单已结案，请勿重复操作');
      if (wo.status === 'cancelled') throw new BadRequestException('已取消的工单不可结案');
      if (wo.status === 'draft' || wo.status === 'created') {
        throw new BadRequestException('工单尚未下发，不可结案');
      }

      const picks = await tx
        .select({ id: pickingOrder.id, status: pickingOrder.status, pickingNo: pickingOrder.pickingNo })
        .from(pickingOrder)
        .where(eq(pickingOrder.workOrderId, wo.id))
        .for('update');

      // 领料单终态：completed（历史）/ received（已签收）/ cancelled；
      // issued 表示已发料但领料方还没签收，结案前必须先签收。
      const unfinished = picks.filter(
        (p) => !['completed', 'received', 'cancelled'].includes(p.status),
      );
      if (unfinished.length > 0) {
        const pending = unfinished.filter((p) => p.status === 'pending_approval').length;
        const issued = unfinished.filter((p) => p.status === 'issued').length;
        const inProgress = unfinished.length - pending - issued;
        throw new ConflictException(
          `尚有未完成的领料单（待审批 ${pending} 张，待签收 ${issued} 张，执行中 ${inProgress} 张），不可结案`,
        );
      }

      // 超耗（超补）审批：超过 BOM 标准用量 3‰ 且未审批，不允许结案
      const checks = await tx
        .select({
          overStatus: workOrder.overConsumeStatus,
          overRate: workOrder.overConsumeRate,
          bomId: workOrder.bomId,
          planQty: workOrder.planQty,
        })
        .from(workOrder)
        .where(eq(workOrder.id, wo.id))
        .limit(1);
      const bomRows = checks[0]?.bomId
        ? await tx.select({
            materialId: bomItem.materialId,
            quantity: bomItem.quantity,
          }).from(bomItem).where(eq(bomItem.bomId, checks[0].bomId))
        : [];
      const reelRows = await tx
        .select({
          materialId: pickingReel.materialId,
          consumedQty: pickingReel.consumedQty,
        })
        .from(pickingReel)
        .where(eq(pickingReel.workOrderId, wo.id));
      if (bomRows.length > 0 && reelRows.length > 0) {
        const consumed = new Map<string, number>();
        for (const r of reelRows) {
          consumed.set(r.materialId, (consumed.get(r.materialId) || 0) + Number(r.consumedQty || 0));
        }
        const planQty = Number(checks[0]?.planQty || 0);
        let overRate = 0;
        for (const b of bomRows) {
          const std = Number(b.quantity || 0) * planQty;
          const act = consumed.get(b.materialId || '') || 0;
          if (std > 0) overRate = Math.max(overRate, (act - std) / std);
        }
        if (overRate > 0.003 && checks[0]?.overStatus !== 'approved') {
          throw new ConflictException(
            `本工单超耗 ${(overRate * 100).toFixed(3)}%，超过千分之三，需审批通过后才能结案`,
          );
        }
      }

      await tx
        .update(workOrder)
        .set({ status: 'closed', updatedAt: new Date() })
        .where(eq(workOrder.id, wo.id));
    });
  }

  /**
   * 取消工单：没有开始领料的工单可以被取消，否则不能取消。
   * 已生成但仍在待审批的领料单一并取消；已审批/已领料的工单拒绝取消。
   */
  async cancelWorkOrder(workOrderNo: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [wo] = await tx
        .select({
          id: workOrder.id,
          status: workOrder.status,
          source: workOrder.source,
          mesMoNo: workOrder.mesMoNo,
        })
        .from(workOrder)
        .where(eq(workOrder.workOrderNo, workOrderNo))
        .for('update');
      if (!wo) throw new NotFoundException('工单不存在');
      await this.assertWorkOrderOperable(tx, wo, '取消');
      if (wo.status === 'cancelled') throw new BadRequestException('工单已取消，请勿重复操作');
      if (wo.status === 'closed') throw new BadRequestException('已结案的工单不可取消');
      if (wo.status === 'in_production' || wo.status === 'completed') {
        throw new BadRequestException('工单已开始生产，不可取消');
      }

      const picks = await tx
        .select({ id: pickingOrder.id, status: pickingOrder.status, pickingNo: pickingOrder.pickingNo })
        .from(pickingOrder)
        .where(eq(pickingOrder.workOrderId, wo.id))
        .for('update');

      // 规则：没有开始领料才可取消（已审批或已完成的领料单即视为已开始领料；历史已取消的不算）
      const started = picks.filter((p) => p.status === 'approved' || p.status === 'completed');
      if (started.length > 0) {
        throw new ConflictException(`已开始领料（${started.map((p) => p.pickingNo).join('、')}），工单不可取消`);
      }

      // 一并取消仍在待审批的领料单
      if (picks.some((p) => p.status === 'pending_approval')) {
        await tx
          .update(pickingOrder)
          .set({
            status: 'cancelled',
            remark: `工单取消，自动取消待审批领料单`,
            updatedAt: new Date(),
          })
          .where(and(eq(pickingOrder.workOrderId, wo.id), eq(pickingOrder.status, 'pending_approval')));
      }

      await tx
        .update(workOrder)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(workOrder.id, wo.id));
    });
  }

  /**
   * 物料追溯管理：覆盖仓库「全部主要业务异动」流水（inventory_transaction 表）。
   * 类型清单（tx_type → 中文标签）见 TRACE_TYPE_LABEL。
   * 筛选：日期范围、物料编码、批次号、生产日期、供应商名称或代码、异动类型（可选，逗号分隔多选）。
   * 全部使用参数化查询（sql 模板），不拼接字符串。
   */
  async getTraceRecords(params: any) {
    const {
      materialCode,
      batchNo,
      startDate,
      endDate,
      productionDate,
      supplier,
      txType,
      page = 1,
      pageSize = 20,
    } = params;
    const limit = Math.min(Number(pageSize) || 20, 200);
    const offset = ((Number(page) || 1) - 1) * limit;

    // 异动类型筛选：支持逗号分隔多选；未传/传空则返回全部已纳入追溯的类型
    const typeFilter: string[] = txType
      ? String(txType).split(',').map((s) => s.trim()).filter(Boolean)
      : TRACE_TYPE_LABEL.map((t) => t.txType);
    // 空数组（显式传了空串）=> 不返回任何记录
    if (typeFilter.length === 0) {
      return { total: 0, items: [] };
    }

    // 生产日期/供应商来自批次库存（inventory），通过 material+batch 关联最近一条
    const batchJoin = sql`
      LEFT JOIN LATERAL (
        SELECT i.production_date AS production_date, i.supplier_id AS supplier_id
        FROM inventory i
        WHERE i.material_id = x.material_id AND i.batch_no = x.batch_no
        ORDER BY i._created_at DESC
        LIMIT 1
      ) b ON true
      LEFT JOIN supplier s ON s.id = b.supplier_id`;

    // 过滤条件
    const conds: any[] = [sql`x.tx_type IN ${sql.raw('(' + typeFilter.map((t) => `'${t}'`).join(',') + ')')}`];
    if (materialCode) conds.push(sql`x.material_code ILIKE ${'%' + materialCode + '%'}`);
    if (batchNo) conds.push(sql`x.batch_no ILIKE ${'%' + batchNo + '%'}`);
    if (startDate) conds.push(sql`x.tx_time >= ${startDate + ' 00:00:00+08'}::timestamptz`);
    if (endDate) conds.push(sql`x.tx_time <= ${endDate + ' 23:59:59+08'}::timestamptz`);
    if (productionDate) conds.push(sql`b.production_date = ${productionDate}::date`);
    if (supplier) {
      conds.push(sql`(s.supplier_name ILIKE ${'%' + supplier + '%'} OR s.supplier_code ILIKE ${'%' + supplier + '%'})`);
    }
    const where = conds.length ? sql` WHERE ${sql.join(conds, sql` AND `)}` : sql``;

    // 统一基表：inventory_transaction 全量流水（含补齐的收货入库/放行入库等）
    const base = sql`
      SELECT x.tx_type, x.tx_time, x.material_code, x.material_name, x.batch_no,
             x.qty, x.unit, x.doc_no, x.remark, x.stock_status,
             b.production_date, s.supplier_name, s.supplier_code
      FROM (
        SELECT it.tx_type, it._created_at AS tx_time, it.material_id, it.batch_no, it.qty, it.unit,
               it.reference_no AS doc_no, it.remark, it.stock_status,
               m.material_code, m.material_name
        FROM inventory_transaction it
        INNER JOIN material m ON m.id = it.material_id
      ) x ${batchJoin}`;

    const finalSql = sql`SELECT * FROM (${base}${where}) t ORDER BY t.tx_time DESC LIMIT ${limit} OFFSET ${offset}`;
    const countSql = sql`SELECT count(*)::int AS total FROM (${base}${where}) t`;

    const rows: any[] = await this.db.execute(finalSql);
    const countRows: any[] = await this.db.execute(countSql);

    const labelMap = new Map(TRACE_TYPE_LABEL.map((t) => [t.txType, t.label]));

    return {
      total: countRows[0]?.total || 0,
      items: rows.map((r: any) => ({
        id: `${r.tx_type}-${r.doc_no || ''}-${r.tx_time}`,
        recordType: r.tx_type,
        recordTypeLabel: labelMap.get(r.tx_type) || r.tx_type,
        txTime: r.tx_time ? new Date(r.tx_time).toLocaleString('zh-CN', { hour12: false }) : '',
        materialCode: r.material_code,
        materialName: r.material_name,
        batchNo: r.batch_no,
        // 出库类异动为负值，追溯展示统一取绝对值；纯状态类（lock/unlock）qty=0 保持 0
        qty: r.qty == null ? 0 : Math.abs(Number(r.qty)),
        unit: r.unit,
        docNo: r.doc_no,
        remark: r.remark,
        stockStatus: r.stock_status,
        productionDate: r.production_date ? new Date(r.production_date).toISOString().slice(0, 10) : '',
        supplierName: r.supplier_name || '',
        supplierCode: r.supplier_code || '',
      })),
    };
  }
}

/** 追溯覆盖的仓库异动类型清单（单一权威来源：tx_type → 中文标签） */
const TRACE_TYPE_LABEL: { txType: string; label: string }[] = [
  // 入库
  { txType: 'receipt_in', label: '收货入库' },
  { txType: 'iqc_release_in', label: 'IQC放行入库' },
  { txType: 'production_return_in', label: '生产退料入库' },
  { txType: 'rework_in', label: '返工入库' },
  // 出库
  { txType: 'issue', label: '发料' },
  { txType: 'split_remain', label: '分拆余料' },
  { txType: 'mrb_return_out', label: '退货出库' },
  { txType: 'mrb_other_customer_out', label: '客供出库' },
  // 调拨/移库
  { txType: 'defective_transfer_out', label: '不良品调拨(出)' },
  { txType: 'defective_transfer_in', label: '不良品调拨(入)' },
  { txType: 'defective_move_out', label: '不良品移库(出)' },
  { txType: 'defective_move_in', label: '不良品移库(入)' },
  // 盘点
  { txType: 'adjust', label: '盘点调整' },
  { txType: 'manual_merge', label: '手动合并' },
  // MRB 处置
  { txType: 'mrb_special_admit', label: '让步接收' },
  { txType: 'mrb_rework', label: '返工' },
  { txType: 'mrb_scrap', label: '报废' },
  { txType: 'mrb_return_cancel', label: '退货取消' },
  { txType: 'rework_fail', label: '返工失败' },
];
