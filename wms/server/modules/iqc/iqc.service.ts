import { Inject, Injectable, Logger, NotFoundException, BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, or, like, gte, lte, desc, asc, sql, count, inArray, notInArray } from 'drizzle-orm';
import { casUpdate } from '../../common/utils/cas.util';
import { MrbService } from '../mrb/mrb.service';
import { StrictnessService, STRICTNESS_TYPE } from './strictness.service';
import { OaMrbService } from './oa-mrb.service';
import { SupplierDebtService } from '../supplier-debt/supplier-debt.service';
import { IQC_DEFECT_TYPES } from '../../common/constants/business-enums';
import { INVENTORY_STOCK_CONFLICT_TARGET } from '../../common/db/inventory-conflict';
import type {
  IqcLot,
  IqcInspectionItem,
  IqcInspectionRecord,
  IqcReport,
  PaginatedResponse,
  ReceiptOrder,
  IqcAnomalyItem,
  IqcAnomalyResult,
  IqcZeroRecordReportItem,
  IqcManualJudgmentItem,
} from '@shared/api.interface';

import {
  iqcLot,
  iqcLotReceipt,
  iqcInspectionItem,
  iqcInspectionRecord,
  iqcInspectionDraft,
  iqcReport,
  iqcInspectionStrictness,
  receiptOrder,
  supplier,
  material,
  materialExpiryExtension,
  inventory,
  warehouseLocation,
  sysParam,
  warehouse,
  sysAccount,
} from '@server/database/schema';

/** 非负数字兜底：空值 / 非数字 / 负数一律按 0 处理 */
function toNonNegativeNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/**
 * 单个检验小项的判定口径（2026-10-18 用户确认，全系统唯一实现）
 *
 * 1. 小项没有填写不良数 = 该小项没有发现不合格 → **自动判合格**（不再留空、不再依赖前端传 true）；
 * 2. 填了不良数 → 与 Ac 比较：不良数 ≤ Ac 判合格，否则判不合格；
 *    Ac 缺失时按 0 处理（即必须 0 个不良才算合格）；
 * 3. 判定结果一律由「不良数 + Ac」推导，**不采信前端传来的 isPass**，
 *    避免草稿/历史数据里 isPass 为空（或误传 false）把合格批次判成不合格。
 */
export function resolveRecordIsPass(rec: { defectQty?: unknown; ac?: unknown } | null | undefined): boolean {
  return toNonNegativeNumber(rec?.defectQty) <= toNonNegativeNumber(rec?.ac);
}

/**
 * 批量规范化小项判定并推导批次结论：
 * 每个小项都合格 → pass；只要有一个小项不合格 → fail。
 */
export function summarizeRecordVerdicts(
  records: Array<{ defectQty?: unknown; ac?: unknown }> | null | undefined,
): { results: boolean[]; finalResult: 'pass' | 'fail' } {
  const results = (records ?? []).map((r) => resolveRecordIsPass(r));
  return {
    results,
    finalResult: results.some((ok) => !ok) ? 'fail' : 'pass',
  };
}


export interface IqcInspectionRecordInput {
  itemId?: string;
  templateItemId?: string;
  sectionType?: string;
  itemName: string;
  standard?: string;
  specMin?: string;   // = LSL
  specMax?: string;   // = USL
  spec?: string;
  unit?: string;
  lsl?: string;       // 前端传 lsl/usl，需映射到 specMin/specMax
  usl?: string;
  measuredValue?: string;
  measuredValues?: string[];  // jsonb 存储
  defectDescription?: string;
  defectQty?: number;
  isPass?: boolean;
  sortOrder?: number;
  samplingPlanText?: string;
  aql?: string;       // GB/T 2828.1 抽样方案的 AQL 值
  sampleSize?: number;
  ac?: number;
  re?: number;
}

export interface IqcLotWithDetail extends IqcLot {
  receipts?: ReceiptOrder[];
}

/** 草稿时间戳转毫秒（非法值按 0 处理） */
function draftTimeMs(v?: string | null): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

@Injectable()
export class IqcService {
  private readonly logger = new Logger(IqcService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly mrbService: MrbService,
    private readonly strictnessService: StrictnessService,
    private readonly supplierDebtService: SupplierDebtService,
    // P2：MRB 建好后推 OA 评审（WMS 建单 → OA 审批 → 回填处置）
    private readonly oaMrb: OaMrbService,
  ) {}

  private async attachUserNames(
    items: any[],
    mapping: Record<string, string>,
  ): Promise<void> {
    const allIds = new Set<string>();
    for (const it of items) {
      for (const idField of Object.keys(mapping)) {
        if (it[idField]) allIds.add(it[idField]);
      }
    }
    if (allIds.size === 0) return;

    // 分成 UUID 格式和非 UUID 格式两组
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const uuidIds: string[] = [];
    const accountIds: string[] = [];
    for (const id of allIds) {
      if (typeof id === 'string' && uuidRegex.test(id)) {
        uuidIds.push(id);
      } else if (typeof id === 'string' && id) {
        accountIds.push(id);
      }
    }

    const nameMap = new Map<string, string>();

    // 通过 UUID id 查询
    if (uuidIds.length > 0) {
      const users = await this.db
        .select({ id: sysAccount.id, name: sysAccount.name })
        .from(sysAccount)
        .where(inArray(sysAccount.id, uuidIds));
      users.forEach((u) => {
        if (u.name) nameMap.set(u.id, u.name);
      });
    }

    // 通过 account 查询
    if (accountIds.length > 0) {
      const users = await this.db
        .select({ account: sysAccount.account, name: sysAccount.name })
        .from(sysAccount)
        .where(inArray(sysAccount.account, accountIds));
      users.forEach((u) => {
        if (u.name) nameMap.set(u.account, u.name);
      });
    }

    // 通过 platform_user_id 查询
    if (accountIds.length > 0) {
      const users = await this.db
        .select({ platformUserId: sysAccount.platformUserId, name: sysAccount.name })
        .from(sysAccount)
        .where(inArray(sysAccount.platformUserId, accountIds));
      users.forEach((u) => {
        if (u.name) nameMap.set(u.platformUserId, u.name);
      });
    }

    for (const it of items) {
      for (const [idField, nameField] of Object.entries(mapping)) {
        it[nameField] = it[idField] ? (nameMap.get(it[idField]) || it[idField]) : '';
      }
    }
  }

  /**
   * 写入前的用户标识清洗。
   *
   * user_profile 复合类型的 user_id 期望是 uuid 字符串，但前端某些路径可能传
   * 账号名（如 "admin"，例如本地缓存的登录信息里没有 id 时）。脏值一旦入库，
   * 后续任何 `(col).user_id::uuid` 的查询都会整条报错，因此这里统一收口：
   *   1. 合法 UUID → 原样返回
   *   2. 否则按 account / platform_user_id 反查 sys_account，命中则用其 id
   *   3. 都匹配不上 → 返回 null，宁可留空也不写脏值
   */
  /** 参数形态校验：非 uuid 时给出明确提示，而不是把原始数据库错误抛给前端 */
  private assertUuid(value: string, label: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!value || !uuidRegex.test(value)) {
      throw new BadRequestException(`${label}标识不合法`);
    }
  }

  /**
   * 审批/驳回写库成功后回传详情。
   *
   * 业务上「审批已经落库成功」就必须返回成功：此处若因详情的附加信息（关联查询、
   * 历史脏数据等）出错，不能让调用方误判成「审批失败」——此前单条审批就出现过
   * 「数据已审批、前端却提示失败，而批量审批因为吞掉异常看起来成功」的假象。
   */
  private async safeReportDetail(id: string, fallback: Record<string, any>): Promise<any> {
    try {
      return await this.getReportDetail(id);
    } catch (err) {
      this.logger.error(
        `审批后回读报告详情失败（审批本身已生效）: reportId=${id}, error=${JSON.stringify(err)}`,
      );
      return fallback;
    }
  }

  private async normalizeUserRef(value?: string | null): Promise<string | null> {
    const raw = (value ?? '').toString().trim();
    if (!raw) return null;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(raw)) return raw;

    const conditions: any[] = [eq(sysAccount.account, raw)];
    if (sysAccount.platformUserId) {
      conditions.push(eq(sysAccount.platformUserId, raw));
    }
    const rows = await this.db
      .select({ id: sysAccount.id })
      .from(sysAccount)
      .where(or(...conditions))
      .limit(1);
    return rows[0]?.id ?? null;
  }
  /**
   * 超期 / 预警物料自动推送待检清单（幂等）。
   *
   * 规则（用户口径）：
   * - 良品仓库存「已超期」（剩余天数 <= 0）：生成 IQC 待检批次并**锁定**库存（锁因「超期复检中」），避免带病物料被发料使用；
   * - 良品仓库存「超期预警」（0 < 剩余天数 <= 30）：只生成 IQC 待检批次，**不锁定**库存；
   * - 生成的批次物料来源统一为「超期复检」，批次号加 -R01 复检后缀。
   *
   * 幂等去重（避免每次打开待检清单都重复推送）：
   * - 同一物料 + 同一物理批次若已存在「进行中」的检验批次（待检/检验中/待审批/被驳回），不再推送
   *   —— 该物料属于「待检中同时又是超期物料」，按需求在其正常来料检验页面直接处置超期库存；
   * - 同一物料 + 同一物理批次若已推送过超期复检批次（任意状态），不再重复推送。
   */
  /**
   * 供 `ExpiryScanService` 每日 08:30 定时调用；页面「立即扫描」也走这里。
   * 注意：**不要**再在 getPendingList 里隐式调用 —— 那样触发时机取决于
   * 谁先打开页面，且会把查询接口变成写接口（GET 有副作用）。
   */
  async syncExpiryStockToPending(): Promise<number> {
    // 1. 找出良品仓中所有「超期 / 预警」库存（有效期按最新延期记录优先）
    const candidates = await this.db.execute<{
      id: string;
      material_id: string;
      supplier_id: string | null;
      batch_no: string | null;
      production_date: string | null;
      quantity: string;
      unit: string | null;
      location_id: string;
      location_code: string | null;
      locked: boolean;
      remaining_days: number;
      last_receipt_at: string | null;
    }>(sql`
      SELECT i.id, i.material_id, i.supplier_id, i.batch_no, i.production_date::text AS production_date,
             i.quantity, i.unit, i.location_id, wl.location_code, i.locked,
             (SELECT MAX(ro._created_at)::text FROM ${receiptOrder} ro
              WHERE ro.material_id = i.material_id AND ro.batch_no = i.batch_no) AS last_receipt_at,
             (CASE
                WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date
                WHEN m.expiry_days IS NOT NULL AND i.production_date IS NOT NULL
                  THEN (i.production_date + (m.expiry_days || ' days')::interval)::date
                ELSE NULL
              END - CURRENT_DATE)::integer AS remaining_days
      FROM ${inventory} i
      INNER JOIN ${material} m ON m.id = i.material_id
      LEFT JOIN ${warehouseLocation} wl ON wl.id = i.location_id
      LEFT JOIN (
        SELECT DISTINCT ON (material_id, batch_no, location_id)
          material_id, batch_no, location_id, new_expiry_date
        FROM ${materialExpiryExtension}
        ORDER BY material_id, batch_no, location_id, _created_at DESC
      ) ext ON ext.material_id = i.material_id
           AND ext.batch_no = i.batch_no
           AND ext.location_id = i.location_id
      WHERE i.stock_status = 'good'
        AND m.expiry_days IS NOT NULL
        AND i.production_date IS NOT NULL
    `);

    const expiring = candidates.filter((r) => Number(r.remaining_days) <= 30);
    if (expiring.length === 0) return 0;

    // 2. 幂等去重：按「物料 + 物理批次（去掉 -Rxx 复检后缀）」判断是否已推送/已在检
    const materialIds = Array.from(new Set(expiring.map((r) => r.material_id)));
    const existingLots = await this.db
      .select({
        materialId: iqcLot.materialId,
        batchNo: iqcLot.batchNo,
        lotNo: iqcLot.lotNo,
        status: iqcLot.status,
        materialSource: iqcLot.materialSource,
      })
      .from(iqcLot)
      .where(inArray(iqcLot.materialId, materialIds));

    const ACTIVE_STATUSES = new Set(['pending', 'inspecting', 'review_pending', 'rejected']);
    const normalizeBatch = (b?: string | null) => (b || '').replace(/-R\d+$/i, '');
    const pushedKeys = new Set<string>();   // 已推送过超期复检的批次
    const activeKeys = new Set<string>();   // 已有进行中检验批次的批次
    for (const lot of existingLots) {
      const key = `${lot.materialId}|${normalizeBatch(lot.batchNo)}`;
      // 超期推送生成的批次号固定 EXP 前缀（来源可能是「超期复检」或「来料检验」，不能用来源判断）
      if ((lot.lotNo || '').startsWith('EXP')) pushedKeys.add(key);
      if (ACTIVE_STATUSES.has(lot.status)) activeKeys.add(key);
    }

    const todo = expiring.filter((r) => {
      const key = `${r.material_id}|${normalizeBatch(r.batch_no)}`;
      return !pushedKeys.has(key) && !activeKeys.has(key);
    });
    if (todo.length === 0) return 0;

    // 3. 生成待检批次（编号走 SEQUENCE 原子取号）
    const created = await this.db.transaction(async (tx) => {
      const dateRow = await tx.execute<{ date_str: string; date_part: string }>(
        sql`SELECT CURRENT_DATE::text AS date_str, to_char(CURRENT_DATE, 'YYYYMMDD') AS date_part`,
      );
      const dateStr = dateRow[0]?.date_str ?? new Date().toISOString().slice(0, 10);
      const datePart = dateRow[0]?.date_part ?? dateStr.replace(/-/g, '');

      let count = 0;
      for (const inv of todo) {
        // 场景区分：近期（7天内）有收料记录的 = 正常来料到货时已超期 → 来源「来料检验」、备注「超期复检」；
        // 无近期收料的 = 仓库存放超期的库存 → 来源「超期复检」、备注「超期物料报检」（原逻辑）
        const RECENT_RECEIPT_MS = 7 * 24 * 60 * 60 * 1000;
        const isRecentReceipt = !!inv.last_receipt_at
          && Date.now() - new Date(inv.last_receipt_at).getTime() <= RECENT_RECEIPT_MS;
        const lotSeqRow = await tx.execute<{ seq: string }>(sql`SELECT nextval('seq_iqc_lot_no') AS seq`);
        const lotSeq = Number(lotSeqRow[0]?.seq ?? 1);
        const lotNo = `EXP${datePart}${lotSeq.toString().padStart(4, '0')}`;

        const inspSeqRow = await tx.execute<{ seq: string }>(sql`SELECT nextval('seq_iqc_inspection_no') AS seq`);
        const inspSeq = Number(inspSeqRow[0]?.seq ?? 1);
        const inspectionNo = `JY${datePart}${inspSeq.toString().padStart(4, '0')}`;

        const insertedExpLot = await tx.insert(iqcLot).values({
          lotNo,
          inspectionNo,
          receiptDate: dateStr,
          lastReceiptDate: dateStr,
          supplierId: inv.supplier_id ?? undefined,
          materialId: inv.material_id,
          productionDate: inv.production_date ? inv.production_date.slice(0, 10) : undefined,
          batchNo: inv.batch_no ? `${inv.batch_no}-R01` : undefined,
          totalQty: inv.quantity,
          unit: inv.unit || 'PCS',
          locationCodes: inv.location_code ?? '',
          materialSource: isRecentReceipt ? '来料检验' : '超期复检',
          inspectionResult: 'pending',
          status: 'pending',
          remark: isRecentReceipt ? '超期复检' : '超期物料报检',
        })
          // F-11：active 唯一索引（4 列 + NULLS NOT DISTINCT）下同批次重复推送必须幂等，
          // 否则 23505/500。冲突即跳过（该批次已有进行中检验批次）。
          .onConflictDoNothing({
            target: [iqcLot.supplierId, iqcLot.materialId, iqcLot.productionDate, iqcLot.batchNo],
            where: sql`${iqcLot.status} in ('pending','inspecting','review_pending','rejected')`,
          })
          .returning({ id: iqcLot.id });
        if (insertedExpLot.length === 0) {
          continue; // 已有进行中批次 → 跳过，不重复锁库存/不计数
        }

        // 已超期的库存需要锁住，预警期的不锁（用户口径）
        if (Number(inv.remaining_days) <= 0 && !inv.locked) {
          await tx
            .update(inventory)
            .set({ locked: true, lockReason: '超期复检中' })
            .where(eq(inventory.id, inv.id));
        }
        count += 1;
      }
      return count;
    });

    if (created > 0) {
      this.logger.log(`超期/预警物料自动推送到 IQC 待检清单：${created} 个批次`);
    }
    return created;
  }

  async getPendingList(params: {
    page: number;
    pageSize: number;
    materialCode?: string;
    supplierCode?: string;
    batchNo?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    /** 多状态筛选（逗号分隔），用于待检清单只取「待检验 + 被驳回」 */
    statuses?: string;
  }): Promise<PaginatedResponse<IqcLot>> {
    const { page, pageSize, materialCode, supplierCode, batchNo, startDate, endDate, status, statuses } = params;

    // 超期 / 预警物料的推送已改为「每天 08:30 由 ExpiryScanService 定时执行」，
    // 不再挂在待检清单查询上：一是没人打开页面就不推送（漏推），二是 GET 不应产生写副作用。
    // 需要临时补推请调用 POST /api/iqc/expiry/scan 或页面上的「立即扫描」。

    const conditions = [];
    if (materialCode) conditions.push(like(material.materialCode, `%${materialCode}%`));
    if (supplierCode) conditions.push(like(supplier.supplierCode, `%${supplierCode}%`));
    if (batchNo) conditions.push(like(iqcLot.batchNo, `%${batchNo}%`));
    if (startDate) conditions.push(gte(iqcLot.receiptDate, startDate));
    // 闭区间：结束日取到当天（原用 lt 会漏掉结束日当天入库的批次）
    if (endDate) conditions.push(lte(iqcLot.receiptDate, endDate));
    if (status) conditions.push(eq(iqcLot.status, status));
    if (!status && statuses) {
      const list = statuses.split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length > 0) conditions.push(inArray(iqcLot.status, list));
    }

    const baseQuery = this.db
      .select({
        id: iqcLot.id,
        lotNo: iqcLot.lotNo,
        inspectionNo: iqcLot.inspectionNo,
        receiptDate: iqcLot.receiptDate,
        // 报检时间 = 仓库提交待检清单的时间
        submittedAt: iqcLot.createdAt,
        supplierId: iqcLot.supplierId,
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        materialId: iqcLot.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        totalQty: iqcLot.totalQty,
        unit: iqcLot.unit,
        productionDate: iqcLot.productionDate,
        batchNo: iqcLot.batchNo,
        locationCodes: iqcLot.locationCodes,
        boxCount: iqcLot.boxCount,
        materialSource: iqcLot.materialSource,
        inspectorId: iqcLot.inspectorId,
        approverId: iqcLot.approverId,
        inspectionResult: iqcLot.inspectionResult,
        defectType: iqcLot.defectType,
        inspectionTime: iqcLot.inspectionTime,
        status: iqcLot.status,
        remark: iqcLot.remark,
        keeperId: sql<string>`(
          SELECT (ro.keeper_id).user_id
          FROM receipt_order ro
          WHERE ro.batch_no = ${iqcLot.batchNo}
            AND ro.material_id = ${iqcLot.materialId}
            AND ro.supplier_id = ${iqcLot.supplierId}
          LIMIT 1
        )`,
      })
      .from(iqcLot)
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .leftJoin(material, eq(iqcLot.materialId, material.id));

    const whereQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(iqcLot)
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    // 待检清单排序：按报检时间（仓库提交待检清单的时间）升序 —— 最早报检的排最前面
     const items = await whereQuery
       .orderBy(asc(iqcLot.createdAt), asc(iqcLot.inspectionNo))
       .limit(pageSize)
      .offset((page - 1) * pageSize);

    const rawItems = items.map((item: any) => ({
      ...item,
      totalQty: Number(item.totalQty),
       receiptDate: typeof item.receiptDate === 'string' ? item.receiptDate : item.receiptDate.toISOString().slice(0, 10),
       submittedAt: item.submittedAt
         ? (item.submittedAt instanceof Date ? item.submittedAt.toISOString() : item.submittedAt)
         : undefined,
      productionDate: item.productionDate
        ? (typeof item.productionDate === 'string' ? item.productionDate : item.productionDate.toISOString().slice(0, 10))
        : undefined,
      inspectionTime: item.inspectionTime
        ? (item.inspectionTime instanceof Date ? item.inspectionTime.toISOString() : item.inspectionTime)
        : undefined,
    }));
    // 附加「检验属性是否免检」标记：外观与尺寸功能**都为免检**时，
    // 该批次可走「免检确认」（只核对信息、维护合格，不做检验记录）
    const pendingMaterialIds = Array.from(
      new Set(rawItems.map((i: any) => i.materialId).filter(Boolean)),
    ) as string[];
    const exemptMaterialIds = await this.getFullyExemptMaterialIds(pendingMaterialIds);
    const itemsWithExempt = rawItems.map((i: any) => ({
      ...i,
      isExempt: exemptMaterialIds.has(i.materialId),
    }));
    // 暂时去掉用户名关联，避免类型报错
    return {
      items: itemsWithExempt,
      total,
      page,
      pageSize,
    };
  }

  // ===== 漏提报告异常检测 & 人工判定台账（2026-10-18 用户口径）=====

  /**
   * 检测「IQC 漏提报告」三类异常，供待检页顶部异常待办横幅使用。
   *
   * 阈值（可传参覆盖）：
   *  - pendingDays：报检后超过 N 天仍未检验（默认 3 天）
   *  - draftHours：检验草稿超过 N 小时未提交（默认 8 小时，约一个班次）
   *
   * 第三类「已出结论但零小项」在收紧判定路径后只可能来自主管人工判定，
   * 不算违规，但属高风险动作，需要复核，因此一并列出。
   */
  async getIqcAnomalies(params?: { pendingDays?: number; draftHours?: number }): Promise<IqcAnomalyResult> {
    const clamp = (v: unknown, def: number, min: number, max: number) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      return Math.min(Math.max(Math.floor(n), min), max);
    };
    const pendingDays = clamp(params?.pendingDays, 3, 1, 90);
    const draftHours = clamp(params?.draftHours, 8, 1, 720);

    const toIso = (v: unknown): string | undefined => {
      if (!v) return undefined;
      if (v instanceof Date) return v.toISOString();
      const s = String(v);
      return s && s !== 'null' ? s : undefined;
    };

    // 1) 有货没人检：报检后超过 N 天仍是待检验 / 检验中
    const pendingOverdue = ((await this.db.execute(sql`
      SELECT l.id AS "lotId",
             l.inspection_no AS "inspectionNo",
             l.batch_no AS "batchNo",
             m.material_code AS "materialCode",
             m.material_name AS "materialName",
             s.supplier_name AS "supplierName",
             l._created_at AS "submittedAt",
             FLOOR(EXTRACT(EPOCH FROM (now() - l._created_at)) / 86400)::int AS "days"
      FROM iqc_lot l
      LEFT JOIN material m ON m.id = l.material_id
      LEFT JOIN supplier s ON s.id = l.supplier_id
      WHERE l.status IN ('pending', 'inspecting')
        AND l._created_at < now() - make_interval(days => ${pendingDays}::int)
      ORDER BY l._created_at ASC
      LIMIT 200
    `)) as unknown) as IqcAnomalyItem[];

    const pendingOverdueCountRows = ((await this.db.execute(sql`
      SELECT count(*)::int AS c
      FROM iqc_lot l
      WHERE l.status IN ('pending', 'inspecting')
        AND l._created_at < now() - make_interval(days => ${pendingDays}::int)
    `)) as unknown) as Array<{ c: number }>;

    // 2) 填了没交：草稿超过 N 小时未提交，且批次仍未进入审批/终态
    const draftStale = ((await this.db.execute(sql`
      SELECT l.id AS "lotId",
             l.inspection_no AS "inspectionNo",
             l.batch_no AS "batchNo",
             m.material_code AS "materialCode",
             m.material_name AS "materialName",
             s.supplier_name AS "supplierName",
             l._created_at AS "submittedAt",
             d._updated_at AS "draftUpdatedAt",
             FLOOR(EXTRACT(EPOCH FROM (now() - d._updated_at)) / 3600)::int AS "hours"
      FROM iqc_inspection_draft d
      JOIN iqc_lot l ON l.id = d.lot_id
      LEFT JOIN material m ON m.id = l.material_id
      LEFT JOIN supplier s ON s.id = l.supplier_id
      WHERE l.status NOT IN ('pass', 'fail', 'review_pending')
        AND d._updated_at < now() - make_interval(hours => ${draftHours}::int)
      ORDER BY d._updated_at ASC
      LIMIT 200
    `)) as unknown) as IqcAnomalyItem[];

    const draftStaleCountRows = ((await this.db.execute(sql`
      SELECT count(*)::int AS c
      FROM iqc_inspection_draft d
      JOIN iqc_lot l ON l.id = d.lot_id
      WHERE l.status NOT IN ('pass', 'fail', 'review_pending')
        AND d._updated_at < now() - make_interval(hours => ${draftHours}::int)
    `)) as unknown) as Array<{ c: number }>;

    // 3) 判了没数据：报告已出结论但一条检验小项都没有
    const zeroRecordJudged = ((await this.db.execute(sql`
      SELECT r.id AS "reportId",
             r.report_no AS "reportNo",
             l.inspection_no AS "inspectionNo",
             m.material_code AS "materialCode",
             m.material_name AS "materialName",
             r.final_result AS "finalResult",
             r.judge_mode AS "judgeMode",
             r.judge_reason AS "judgeReason",
             COALESCE(r.judged_at, r.inspection_time) AS "judgedAt",
             r.review_status AS "reviewStatus"
      FROM iqc_report r
      JOIN iqc_lot l ON l.id = r.lot_id
      LEFT JOIN material m ON m.id = l.material_id
      WHERE NOT EXISTS (
        SELECT 1 FROM iqc_inspection_record q WHERE q.lot_id = r.lot_id
      )
      ORDER BY COALESCE(r.judged_at, r.inspection_time) DESC NULLS LAST
      LIMIT 200
    `)) as unknown) as IqcZeroRecordReportItem[];

    const normalizeItem = (x: IqcAnomalyItem): IqcAnomalyItem => ({
      ...x,
      submittedAt: toIso(x.submittedAt),
      draftUpdatedAt: toIso(x.draftUpdatedAt),
    });

    // 零小项报告单独取总数：列表截断到 200 条，计数不能跟着截断
    const zeroRecordCountRows = ((await this.db.execute(sql`
      SELECT count(*)::int AS c
      FROM iqc_report r
      WHERE NOT EXISTS (SELECT 1 FROM iqc_inspection_record q WHERE q.lot_id = r.lot_id)
    `)) as unknown) as Array<{ c: number }>;

    return {
      thresholds: { pendingDays, draftHours },
      counts: {
        pendingOverdue: Number(pendingOverdueCountRows[0]?.c ?? 0),
        draftStale: Number(draftStaleCountRows[0]?.c ?? 0),
        zeroRecordJudged: Number(zeroRecordCountRows[0]?.c ?? 0),
      },
      pendingOverdue: pendingOverdue.map(normalizeItem),
      draftStale: draftStale.map(normalizeItem),
      zeroRecordJudged: zeroRecordJudged.map((x) => ({ ...x, judgedAt: toIso(x.judgedAt) })),
    };
  }

  /**
   * 人工判定台账：只列 judge_mode='manual' 的报告，含原因、判定人、审批状态。
   * 质量体系审核（客户/第三方）必查项，支持按日期区间与关键字筛选。
   */
  async getManualJudgments(params: {
    startDate?: string;
    endDate?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResponse<IqcManualJudgmentItem>> {
    const page = Math.max(Number(params.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(params.pageSize) || 20, 1), 200);
    const kw = String(params.keyword ?? '').trim();

    const conds: any[] = [sql`r.judge_mode = 'manual'`];
    const judgeTimeExpr = sql`COALESCE(r.judged_at, r.inspection_time, r._created_at)`;
    if (params.startDate) conds.push(sql`${judgeTimeExpr} >= ${params.startDate}::date`);
    if (params.endDate) conds.push(sql`${judgeTimeExpr} < (${params.endDate}::date + interval '1 day')`);
    if (kw) {
      const like = `%${kw}%`;
      conds.push(sql`(
        r.report_no ILIKE ${like}
        OR l.inspection_no ILIKE ${like}
        OR m.material_code ILIKE ${like}
        OR m.material_name ILIKE ${like}
        OR r.judge_reason ILIKE ${like}
      )`);
    }
    const whereSql = sql.join(conds, sql` AND `);

    const fromSql = sql`
      FROM iqc_report r
      JOIN iqc_lot l ON l.id = r.lot_id
      LEFT JOIN material m ON m.id = l.material_id
      LEFT JOIN supplier s ON s.id = l.supplier_id
      LEFT JOIN sys_account ja ON ja.id = NULLIF(btrim((r.judged_by).user_id), '')::uuid
      LEFT JOIN sys_account ra ON ra.id = NULLIF(btrim((r.reviewer_id).user_id), '')::uuid
      WHERE ${whereSql}
    `;

    const countRows = ((await this.db.execute(sql`
      SELECT count(*)::int AS c ${fromSql}
    `)) as unknown) as Array<{ c: number }>;

    const rows = ((await this.db.execute(sql`
      SELECT r.id AS "reportId",
             r.report_no AS "reportNo",
             l.inspection_no AS "inspectionNo",
             m.material_code AS "materialCode",
             m.material_name AS "materialName",
             s.supplier_name AS "supplierName",
             r.final_result AS "finalResult",
             r.judge_reason AS "judgeReason",
             COALESCE(ja.name, (r.judged_by).user_id::text) AS "judgedByName",
             COALESCE(r.judged_at, r.inspection_time, r._created_at) AS "judgedAt",
             r.review_status AS "reviewStatus",
             ra.name AS "reviewName"
      ${fromSql}
      ORDER BY COALESCE(r.judged_at, r.inspection_time, r._created_at) DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `)) as unknown) as IqcManualJudgmentItem[];

    const toIso = (v: unknown): string | undefined => {
      if (!v) return undefined;
      if (v instanceof Date) return v.toISOString();
      return String(v) || undefined;
    };

    return {
      items: rows.map((x) => ({ ...x, judgedAt: toIso(x.judgedAt) })),
      total: Number(countRows[0]?.c ?? 0),
      page,
      pageSize,
    };
  }

  /**
   * 找出严格度为**免检**的物料ID集合（物料级一条账，不再分外观/尺寸）。
   * 只有这类物料才允许走免检确认（直接维护合格放行）。
   */
  private async getFullyExemptMaterialIds(materialIds: string[]): Promise<Set<string>> {
    if (materialIds.length === 0) return new Set();
    const rows = await this.db
      .select({
        materialId: iqcInspectionStrictness.materialId,
      })
      .from(iqcInspectionStrictness)
      .where(
        and(
          inArray(iqcInspectionStrictness.materialId, materialIds),
          eq(iqcInspectionStrictness.inspectionType, STRICTNESS_TYPE),
          eq(iqcInspectionStrictness.strictness, 'exempt'),
        ),
      );
    return new Set(rows.map((r) => r.materialId));
  }

  async getLotDetail(id: string): Promise<IqcLotWithDetail> {
    const lotResult = await this.db
      .select({
        id: iqcLot.id,
        lotNo: iqcLot.lotNo,
        inspectionNo: iqcLot.inspectionNo,
        receiptDate: iqcLot.receiptDate,
        supplierId: iqcLot.supplierId,
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        materialId: iqcLot.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        totalQty: iqcLot.totalQty,
        unit: iqcLot.unit,
        productionDate: iqcLot.productionDate,
        batchNo: iqcLot.batchNo,
        locationCodes: iqcLot.locationCodes,
        boxCount: iqcLot.boxCount,
        materialSource: iqcLot.materialSource,
        inspectorId: iqcLot.inspectorId,
        approverId: iqcLot.approverId,
        inspectionResult: iqcLot.inspectionResult,
        defectType: iqcLot.defectType,
        inspectionTime: iqcLot.inspectionTime,
        status: iqcLot.status,
        remark: iqcLot.remark,
        // 检验员重新进入填写页时要认回上次选定的模板（前端「选定模板退出来要重选」的问题）
        templateId: iqcLot.templateId,
        lastTemplateId: iqcLot.lastTemplateId,
      })
      .from(iqcLot)
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .where(eq(iqcLot.id, id))
      .limit(1);

    if (lotResult.length === 0) {
      throw new NotFoundException('检验批次不存在');
    }

    const lot = lotResult[0] as any;

    // 回填检验员 / 批准人姓名：检验填写页打印预览「检验员 / 批准」栏、
    // 审批后展示审批人都依赖这两个名字（只查 ID 不回填姓名会一直显示「待审批」）
    const lotNameCarrier: any = {
      inspectorId: lot.inspectorId,
      approverId: lot.approverId,
    };
    await this.attachUserNames([lotNameCarrier], {
      inspectorId: 'inspectorName',
      approverId: 'approverName',
    });
    lot.inspectorName = lotNameCarrier.inspectorName;
    lot.approverName = lotNameCarrier.approverName;

    const receiptIdsResult = await this.db
      .select({ receiptId: iqcLotReceipt.receiptId })
      .from(iqcLotReceipt)
      .where(eq(iqcLotReceipt.lotId, id));

    const receiptIds = receiptIdsResult.map((r: any) => r.receiptId);
    let receipts: ReceiptOrder[] = [];

    if (receiptIds.length > 0) {
      const receiptResult = await this.db
        .select({
          id: receiptOrder.id,
          receiptNo: receiptOrder.receiptNo,
          receiptDate: receiptOrder.receiptDate,
          supplierId: receiptOrder.supplierId,
          supplierCode: supplier.supplierCode,
          supplierName: supplier.supplierName,
          materialId: receiptOrder.materialId,
          materialCode: material.materialCode,
          materialName: material.materialName,
          quantity: receiptOrder.quantity,
          unit: receiptOrder.unit,
          productionDate: receiptOrder.productionDate,
          batchNo: receiptOrder.batchNo,
          serialNo: receiptOrder.serialNo,
          locationId: receiptOrder.locationId,
          locationCode: warehouseLocation.locationCode,
          keeperId: receiptOrder.keeperId,
          status: receiptOrder.status,
        })
        .from(receiptOrder)
        .leftJoin(supplier, eq(receiptOrder.supplierId, supplier.id))
        .leftJoin(material, eq(receiptOrder.materialId, material.id))
        .leftJoin(warehouseLocation, eq(receiptOrder.locationId, warehouseLocation.id))
        .where(inArray(receiptOrder.id, receiptIds));

      receipts = receiptResult.map((r: any) => ({
        ...r,
        quantity: Number(r.quantity),
        receiptDate: typeof r.receiptDate === 'string' ? r.receiptDate : r.receiptDate.toISOString().slice(0, 10),
        productionDate: r.productionDate
          ? (typeof r.productionDate === 'string' ? r.productionDate : r.productionDate.toISOString().slice(0, 10))
          : undefined,
      }));
    }

    // Query location details: group by location_id, sum quantity
    let locationDetails: Array<{ locationId: string; locationCode: string; quantity: number }> = [];
    if (receiptIds.length > 0) {
      const locationResult = await this.db
        .select({
          locationId: receiptOrder.locationId,
          locationCode: warehouseLocation.locationCode,
          quantity: sql<number>`SUM(${receiptOrder.quantity})`,
        })
        .from(iqcLotReceipt)
        .innerJoin(receiptOrder, eq(iqcLotReceipt.receiptId, receiptOrder.id))
        .leftJoin(warehouseLocation, eq(receiptOrder.locationId, warehouseLocation.id))
        .where(eq(iqcLotReceipt.lotId, id))
        .groupBy(receiptOrder.locationId, warehouseLocation.locationCode)
        .orderBy(warehouseLocation.locationCode);

      locationDetails = locationResult.map((r: any) => ({
        locationId: r.locationId,
        locationCode: r.locationCode || '',
        quantity: Number(r.quantity),
      }));
    }

    return {
      ...lot,
      totalQty: Number(lot.totalQty),
      receiptDate: typeof lot.receiptDate === 'string' ? lot.receiptDate : lot.receiptDate.toISOString().slice(0, 10),
      productionDate: lot.productionDate
        ? (typeof lot.productionDate === 'string' ? lot.productionDate : lot.productionDate.toISOString().slice(0, 10))
        : undefined,
      inspectionTime: lot.inspectionTime
        ? (lot.inspectionTime instanceof Date ? lot.inspectionTime.toISOString() : lot.inspectionTime)
        : undefined,
      receipts,
      locationDetails,
    };
  }

  async getInspectionItems(materialId: string): Promise<IqcInspectionItem[]> {
    const items = await this.db
      .select()
      .from(iqcInspectionItem)
      .where(
        and(
          eq(iqcInspectionItem.materialId, materialId),
          eq(iqcInspectionItem.status, 'active'),
        ),
      )
      .orderBy(iqcInspectionItem.sortOrder);

    return items as unknown as IqcInspectionItem[];
  }

  /**
   * 根据物料编码查询最近一次检验各项目的SPC/LSL/USL，用于自动带出
   */
  async getLastSpecsByMaterialCode(materialCode: string): Promise<Array<{ itemName: string; spec: string | null; lsl: string | null; usl: string | null }>> {
    // 1. 根据物料编码找到物料ID
    const matResult = await this.db
      .select({ id: material.id })
      .from(material)
      .where(eq(material.materialCode, materialCode))
      .limit(1);
    if (matResult.length === 0) return [];
    const materialId = matResult[0].id;

    // 2. 找到该物料最近一次已完成检验的lot
    const lotResult = await this.db
      .select({ id: iqcLot.id })
      .from(iqcLot)
      .where(and(eq(iqcLot.materialId, materialId), eq(iqcLot.status, 'completed')))
      .orderBy(desc(iqcLot.inspectionTime))
      .limit(1);
    if (lotResult.length === 0) return [];
    const lotId = lotResult[0].id;

    // 3. 查询该lot的检验记录，返回各项目规格
    const records = await this.db
      .select({
        itemName: iqcInspectionRecord.itemName,
        spec: iqcInspectionRecord.spec,
        lsl: iqcInspectionRecord.specMin,
        usl: iqcInspectionRecord.specMax,
      })
      .from(iqcInspectionRecord)
      .where(eq(iqcInspectionRecord.lotId, lotId))
      .orderBy(iqcInspectionRecord.sortOrder);

    return records as Array<{ itemName: string; spec: string | null; lsl: string | null; usl: string | null }>;
  }

  private async generateReportNo(): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `BG${datePart}`;

    const result = await this.db.execute<{ seq: string }>(
      sql`SELECT nextval('seq_report_no') AS seq`,
    );
    const seq = Number(result[0]?.seq ?? 1);

    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  /**
   * 按系统参数查找仓库；参数未配置时按仓库类型兜底（good→normal / defective→defective）
   */
  private async findWarehouseIdByParamOrType(
    paramKey: string,
    fallbackWhType: 'normal' | 'defective',
    label: string,
  ): Promise<string> {
    const paramResult = await this.db
      .select({ paramValue: sysParam.paramValue })
      .from(sysParam)
      .where(eq(sysParam.paramKey, paramKey))
      .limit(1);

    if (paramResult.length > 0 && paramResult[0].paramValue) {
      const whCode = paramResult[0].paramValue;
      const whResult = await this.db
        .select({ id: warehouse.id })
        .from(warehouse)
        .where(eq(warehouse.whCode, whCode))
        .limit(1);
      if (whResult.length > 0) return whResult[0].id;
      // 参数值与仓库表不一致时不再硬失败：记录告警并回落到类型兜底，
      // 避免「IQC 判不合格」因一条配置错误而完全无法流转库存。
      this.logger.warn(
        `${label}参数 ${paramKey}=${whCode} 在仓库表中不存在，已按类型 ${fallbackWhType} 兜底`,
      );
    }

    const fallbackResult = await this.db
      .select({ id: warehouse.id })
      .from(warehouse)
      .where(and(eq(warehouse.whType, fallbackWhType), eq(warehouse.status, 'active')))
      .orderBy(warehouse.whCode)
      .limit(1);
    if (fallbackResult.length === 0) {
      throw new NotFoundException(`系统参数 ${paramKey} 未配置且无 ${fallbackWhType} 类型仓库可用`);
    }
    return fallbackResult[0].id;
  }

  private async getDefectiveWarehouseLocation(): Promise<{ id: string; locationCode: string }> {
    const whId = await this.findWarehouseIdByParamOrType('defective_warehouse_code', 'defective', '不良品仓库');

    const locResult = await this.db
      .select({ id: warehouseLocation.id, locationCode: warehouseLocation.locationCode })
      .from(warehouseLocation)
      .where(
        and(
          eq(warehouseLocation.warehouseId, whId),
          eq(warehouseLocation.status, 'active'),
        ),
      )
      .orderBy(warehouseLocation.locationCode)
      .limit(1);

    if (locResult.length === 0) {
      throw new NotFoundException('不良品仓库下无可用库位');
    }

    return locResult[0];
  }

  private async getGoodWarehouseLocation(): Promise<{ id: string; locationCode: string }> {
    const whId = await this.findWarehouseIdByParamOrType('good_warehouse_code', 'normal', '良品仓库');

    const locResult = await this.db
      .select({ id: warehouseLocation.id, locationCode: warehouseLocation.locationCode })
      .from(warehouseLocation)
      .where(
        and(
          eq(warehouseLocation.warehouseId, whId),
          eq(warehouseLocation.status, 'active'),
        ),
      )
      .orderBy(warehouseLocation.locationCode)
      .limit(1);

    if (locResult.length === 0) {
      throw new NotFoundException('良品仓库下无可用库位');
    }

    return locResult[0];
  }

  /**
   * 判定合格前置校验：**超期物料必须先维护新有效期（延期），才允许判合格**。
   *
   * 背景：超期/预警物料由定时任务自动推到待检清单，页面上不再有独立的「有效期管理」入口，
   * 延期动作收敛到 IQC 待检清单。若不复检前延期，会出现「质量判定合格但账上有效期仍过期」
   * 的放行，发料侧照样能把过期物料发出去。
   *
   * 口径（与「维护有效期」入口一致）：
   * - 只看良品仓 `stock_status='good'` 的库存行（待检桶 pending_qc 不在此拦，
   *   它会在判合格入良品仓后由次日扫描再推送）；
   * - 有效期按 `material_expiry_extension` 最新延期记录计算；
   * - 剩余天数 <= 0（已超期）即视为「未维护」，拒绝判合格。
   */
  private async assertExpiryExtendedBeforePass(
    executor: any,
    lot: { materialId: string; batchNo: string | null },
  ): Promise<void> {
    const physicalBatch = String(lot.batchNo || '').replace(/-R\d+$/i, '');
    if (!physicalBatch) return;

    const rows = await executor.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM ${inventory} i
      INNER JOIN ${material} m ON m.id = i.material_id
      LEFT JOIN (
        SELECT DISTINCT ON (material_id, batch_no, location_id)
          material_id, batch_no, location_id, new_expiry_date
        FROM ${materialExpiryExtension}
        ORDER BY material_id, batch_no, location_id, _created_at DESC
      ) ext ON ext.material_id = i.material_id
           AND ext.batch_no = i.batch_no
           AND ext.location_id = i.location_id
      WHERE i.material_id = ${lot.materialId}
        AND i.batch_no = ${physicalBatch}
        AND i.stock_status = 'good'
        AND m.expiry_days IS NOT NULL
        AND i.production_date IS NOT NULL
        AND (
          CASE
            WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date
            ELSE (i.production_date + (m.expiry_days || ' days')::interval)::date
          END - CURRENT_DATE
        ) <= 0
    `);

    const overdueRows = Number((rows as any[])[0]?.n ?? 0);
    if (overdueRows > 0) {
      throw new BadRequestException(
        `该批次物料在良品仓仍有 ${overdueRows} 行已超期。请先在「IQC 待检」清单维护新有效期（延期），再判定合格`,
      );
    }
  }

  /**
   * Finalize inventory for a lot after IQC review（F-11 重写：按数量守恒迁移）。
   *
   * 库存状态模型：待检库存放在独立桶 `stock_status='pending_qc'`，与 `good` 靠状态维度天然隔离。
   * 放行/不合格 = 把 `lot.total_qty` 的**数量**从 pending_qc 桶迁到目标桶（good / defective），
   * 全程不 UPDATE 键列（material/location/batch/stock_status 只在 INSERT 时写），所以不会撞唯一索引。
   *
   *  - L1 来料待检：存在 pending_qc 行 → 按 total_qty 守恒迁移（Σpending ≥ total_qty，否则 409）。
   *    多余部分（放行并发期间新到货）保留 pending_qc，留待下次报检。
   *  - L2 超期复检：无 pending_qc 行（库存本来就在 good，仅被锁）→ 按 lock_reason='超期复检中' 精确解锁/迁移，
   *    绝不碰 手工锁定 / 返工 / 退货 / 其它库位 的行。
   *
   * **MRB v3 改动（只改不合格分支）**：判不合格时**不再把货搬到不良品仓**，库位保持原收货库位，
   * 只在账上把状态改成 `defective` + `locked=true` + `lock_reason='IQC不合格待MRB(<批次>)'`。
   * 理由：MRB 评审要按「收货箱二维码」分摊数量，货一旦搬走、二维码（`label_no`）一旦清空，
   * SQE 就再也说不清「退哪一箱」。物理不动 + 账上锁死，发料侧一律过滤 `locked=false`，不会被误发。
   */
  private async finalizeLotInventory(
    tx: any,
    lot: { id: string; materialId: string; supplierId: string | null; batchNo: string | null; totalQty?: string | number | null },
    finalResult: 'pass' | 'fail',
  ): Promise<void> {
    const rawBatch = lot.batchNo || '';
    const physicalBatch = rawBatch.replace(/-R\d+$/, ''); // 超期/返工批次的物理批次（去 -Rxx 后缀）
    const lotQty = Number(lot.totalQty ?? 0);
    const targetStatus = finalResult === 'pass' ? 'good' : 'defective';
    /**
     * MRB 据此把「本批次哪些货在等我评审」筛出来（`reviewableDefectiveCond` 只看
     * `stock_status='defective'` 且 `lock_reason NOT LIKE 'MRB-OTHER:%'`，不认库位），
     * 所以带批次号的 lock_reason 既能被 MRB 找到，也能让人在库存列表上一眼看出是谁锁的。
     */
    const failLockReason = `IQC不合格待MRB(${physicalBatch || lot.batchNo || ''})`;

    // ---- L1：待检桶 pending_qc 按数量守恒迁移 ----
    const pendingRows = (await tx
      .select()
      .from(inventory)
      .where(and(
        eq(inventory.materialId, lot.materialId),
        eq(inventory.batchNo, physicalBatch),
        eq(inventory.stockStatus, 'pending_qc'),
      ))
      .orderBy(asc(inventory.locationId), asc(inventory.id))
      .for('update')) as any[];

    if (pendingRows.length > 0) {
      const sumPending = pendingRows.reduce((s, r) => s + Number(r.quantity || 0), 0);
      // INV-4 守恒：迁移量必须等于 lot.total_qty；账面待检不足则拒绝（避免放行凭空造数）
      if (sumPending + 1e-6 < lotQty) {
        throw new ConflictException(`待检库存不足，禁止放行（账面待检 ${sumPending} < 报检 ${lotQty}）`);
      }
      let remaining = lotQty;
      for (const row of pendingRows) {
        if (remaining <= 1e-6) break;
        const rowQty = Number(row.quantity || 0);
        const take = Math.min(rowQty, remaining);
        const left = rowQty - take;
        if (left <= 1e-6) {
          await tx.delete(inventory).where(eq(inventory.id, row.id));
        } else {
          await tx.update(inventory).set({ quantity: String(left) }).where(eq(inventory.id, row.id));
        }
        // MRB v3：**库位不变**。判不合格也留在原收货库位（只改 stock_status + locked），
        // 这样二维码/箱号信息不会因为「货已经搬走」而失去对应关系。
        const destLocationId = row.locationId;
        // 迁入目标桶（原子 upsert）；冲突只累加数量，不覆盖既有行的 locked/lock_reason
        await tx.insert(inventory).values({
          materialId: row.materialId,
          locationId: destLocationId,
          batchNo: row.batchNo ?? '',
          supplierId: row.supplierId ?? null,
          quantity: String(take),
          unit: row.unit || 'PCS',
          stockStatus: targetStatus,
          productionDate: row.productionDate ?? null,
          // QR/label 必须留着：SQE 制定方案时要按收货箱分摊数量
          labelNo: row.labelNo ?? null,
          locked: finalResult === 'fail',
          lockReason: finalResult === 'fail' ? failLockReason : null,
        }).onConflictDoUpdate({
          // 冲突目标 = 库上唯一索引 (material_id, location_id, batch_no, stock_status)
          target: INVENTORY_STOCK_CONFLICT_TARGET,
          set: { quantity: sql`${inventory.quantity} + ${String(take)}::numeric` },
        });
        remaining -= take;
      }
    } else {
      // ---- L2：超期复检（库存本来就在 good，仅被锁）----
      if (finalResult === 'pass') {
        await tx.update(inventory).set({ locked: false, lockReason: null }).where(and(
          eq(inventory.materialId, lot.materialId),
          eq(inventory.batchNo, physicalBatch),
          eq(inventory.stockStatus, 'good'),
          eq(inventory.locked, true),
          eq(inventory.lockReason, '超期复检中'),
        ));
      } else {
        const expRows = (await tx.select().from(inventory).where(and(
          eq(inventory.materialId, lot.materialId),
          eq(inventory.batchNo, physicalBatch),
          eq(inventory.stockStatus, 'good'),
          eq(inventory.locked, true),
          eq(inventory.lockReason, '超期复检中'),
        )).orderBy(asc(inventory.locationId), asc(inventory.id)).for('update')) as any[];
        for (const row of expRows) {
          const rowQty = Number(row.quantity || 0);
          if (rowQty <= 0) continue;
          // MRB v3：同样不搬库位，原地 good → defective + 锁定
          await tx.insert(inventory).values({
            materialId: row.materialId,
            locationId: row.locationId,
            batchNo: row.batchNo ?? '',
            supplierId: row.supplierId ?? null,
            quantity: String(rowQty),
            unit: row.unit || 'PCS',
            stockStatus: 'defective',
            productionDate: row.productionDate ?? null,
            labelNo: row.labelNo ?? null,
            locked: true,
            lockReason: failLockReason,
          }).onConflictDoUpdate({
            target: INVENTORY_STOCK_CONFLICT_TARGET,
            set: { quantity: sql`${inventory.quantity} + ${String(rowQty)}::numeric` },
          });
          await tx.delete(inventory).where(eq(inventory.id, row.id));
        }
      }
    }

    // ---- 收货单状态：pass → iqc_pass；fail → iqc_fail（范围精确到本批次关联收货单）----
    const receiptIdsResult = await tx
      .select({ receiptId: iqcLotReceipt.receiptId })
      .from(iqcLotReceipt)
      .where(eq(iqcLotReceipt.lotId, lot.id));
    const receiptIds = receiptIdsResult.map((r: any) => r.receiptId);
    if (receiptIds.length > 0) {
      await tx
        .update(receiptOrder)
        .set({ status: finalResult === 'pass' ? 'iqc_pass' : 'iqc_fail' })
        .where(inArray(receiptOrder.id, receiptIds));
    }
  }

  /**
   * Find the most recent completed inspection lot for a material and return
   * its template_id (or null if none).
   */
  async getLastUsedTemplateId(materialId: string): Promise<string | null> {
    const rows = await this.db
      .select({ templateId: iqcLot.templateId })
      .from(iqcLot)
      .where(
        and(
          eq(iqcLot.materialId, materialId),
        ),
      )
      .orderBy(desc(iqcLot.inspectionTime), desc(iqcLot.createdAt))
      .limit(1);

    return rows.length > 0 && rows[0].templateId ? rows[0].templateId : null;
  }

  /**
   * 校验并规范化「不合格类型」。
   * - 判定 fail：必填，且必须是 IQC_DEFECT_TYPES 八项之一，否则 400（前端下拉已限死，这里是兜底）。
   * - 判定 pass：一律清空（避免上一轮 fail 留下的类型残留到合格批次上）。
   * @returns 规范化后的值；pass 时返回 null
   */
  private resolveDefectType(defectType: string | undefined, finalResult: 'pass' | 'fail'): string | null {
    if (finalResult !== 'fail') return null;

    const value = (defectType ?? '').trim();
    if (!value) {
      throw new BadRequestException(
        `检验判定为不合格时必须选择不合格类型（可选：${IQC_DEFECT_TYPES.join('、')}）`,
      );
    }
    if (!(IQC_DEFECT_TYPES as readonly string[]).includes(value)) {
      throw new BadRequestException(
        `不合格类型「${value}」不在允许范围内，可选：${IQC_DEFECT_TYPES.join('、')}`,
      );
    }
    return value;
  }

  async submitInspection(
    lotId: string,
    records: IqcInspectionRecordInput[],
    finalResult: 'pass' | 'fail',
    inspectorId: string,
    inspectorName: string,
    remark?: string,
    defectType?: string,
  ): Promise<any> {
    try {
      // 暂停检验硬校验（复核 P2 缺口：此前只有前端把检验员挡回待检列表，
      // 直接调接口仍能提交并出报告）。严格度按物料一条账，暂停即整批停检，
      // 须由品质主管确认供方改进后走「暂停 → 加严」恢复。
      const lotForStrictness = await this.db
        .select({ id: iqcLot.id, materialId: iqcLot.materialId, batchNo: iqcLot.batchNo })
        .from(iqcLot)
        .where(eq(iqcLot.id, lotId))
        .limit(1);
      if (lotForStrictness.length === 0) {
        throw new NotFoundException('检验批次不存在');
      }
      if (lotForStrictness[0].materialId) {
        const state = await this.strictnessService.getCurrentStrictness(
          lotForStrictness[0].materialId,
        );
        if (state?.strictness === 'suspended') {
          throw new BadRequestException(
            '该物料检验已暂停，不能提交检验。请品质主管确认供应方改进后恢复加严检验。',
          );
        }
      }

      // 清洗检验员标识（账号名换成 uuid），避免脏值入库后让报告查询 ::uuid 报错
      const safeInspectorId = (await this.normalizeUserRef(inspectorId)) || null;
      // 最终判定以「检验记录的实际判定」为准，前端传值仅作参考：
      // 每个小项的判定统一由「不良数 + Ac」推导（**没填不良数 = 该项合格**），
      // 批次结论再由全部小项汇聚：每个小项都合格 → pass；只要有一个小项 NG → fail。
      // 修复：此前仅看前端传来的 isPass，草稿/历史记录里 isPass 缺失时
      // 会被当成 false，出现「全部没填却判 fail」或「有 NG 却判 pass」的自相矛盾。
      const normalizedRecords: IqcInspectionRecordInput[] = (Array.isArray(records) ? records : []).map(
        (r) => ({
          ...r,
          defectQty: toNonNegativeNumber(r?.defectQty),
          isPass: resolveRecordIsPass(r),
        }),
      );
      const verdicts = summarizeRecordVerdicts(normalizedRecords);

      // 有效小项数为 0 → 拒绝提交。
      // 否则会产出「零小项报告」：报告上没有任何检验数据，却给出了合格/不合格结论。
      // 这类报告在质量体系审核里属硬伤，也会让合格率统计混入无数据支撑的批次
      // （库里 5 份历史数据就是这么来的）。确实无需检验的批次应走主管「人工判定」。
      const effectiveRecordCount = normalizedRecords.filter(
        (r) => String((r as any)?.itemName ?? '').trim() !== '',
      ).length;
      if (effectiveRecordCount === 0) {
        throw new BadRequestException(
          '检验记录为空，不能提交。若该批次确实无需检验小项，请由 IQC 主管使用「人工判定」并填写原因',
        );
      }

      const derivedResult: 'pass' | 'fail' = verdicts.finalResult;
      if (finalResult !== derivedResult) {
        console.warn(
          `[IQC] 提交判定与记录不一致：前端传 ${finalResult}，按各小项推导为 ${derivedResult}（批次 ${lotId}）`,
        );
      }
      const finalResultResolved = derivedResult;
      console.log('=== 开始提交检验 ===', lotId, finalResultResolved);

      // 判合格前必须已维护新有效期：超期物料先延期再提交合格结论，
      // 否则检验员提交完、审批时才发现被拦，白跑一趟。
      if (finalResultResolved === 'pass') {
        await this.assertExpiryExtendedBeforePass(this.db, lotForStrictness[0] as any);
      }

      // 不合格类型：判定为 fail 时必填，且只能取预设八项（用户口径 2026-10-18）。
      // 校验放在写库之前——此前前端采集了 defectType 却没有随提交报文上报，
      // 后端也没有必填校验，导致不合格批次的 iqc_lot.defect_type 恒为空，
      // 「不合格按不良类型分布」等统计因此永远缺维。
      const safeDefectType = this.resolveDefectType(defectType, finalResultResolved);

      const now = new Date();

      // 1. 更新批次（顺带落检验员，报告表头「检验员」栏才有名字）
      //
      // F-02 修复（P0）：补上终态守卫，且用 CAS（条件更新）而非「先查后改」。
      //   原实现无条件 UPDATE，已放行(pass)的批次可被再次提交检验 → 批次状态回退成 review_pending、
      //   检验结论被改写（pass→fail）、报告的审批人/审批时间被清空（审计留痕被抹）。
      //   此处把「状态守卫」下沉到 UPDATE 的 WHERE，由数据库在行锁内原子判定：
      //   影响行数=0 即说明该批次已不可再提交，从而避免「先 SELECT 再 UPDATE」在并发下
      //   两个请求都通过检查（经典 TOCTOU）。
      const casRows = await casUpdate(this.db, {
        table: iqcLot,
        idColumn: iqcLot.id,
        id: lotId,
        set: {
          inspectionResult: finalResultResolved,
          status: 'review_pending',
          inspectionTime: now,
          inspectorId: safeInspectorId as any,
          defectType: safeDefectType,
        },
        // 守卫：仅当批次处于「可检验」状态时才允许提交。
        //  - 排除 pass/fail（终态，不可回退）——与 judgeLot 同口径的终态守卫；
        //  - 额外排除 review_pending（检验已提交、正等待审批）——否则并发两次提交会都通过
        //    （review_pending 不属于 pass/fail），无法满足「并发重复提交只能成功一次」；
        //  - 保留 pending/inspecting 与 rejected：保证「驳回(rejected) 后重检再提交」流程可用。
        guard: [notInArray(iqcLot.status, ['pass', 'fail', 'review_pending'])],
        // 影响行数=0 时不在此抛异常，改为下面按「批次不存在 / 状态不允许」分类抛 404/400
        conflictMessage: null,
      });
      if (casRows.length === 0) {
        const exists = await this.db
          .select({ status: iqcLot.status })
          .from(iqcLot)
          .where(eq(iqcLot.id, lotId))
          .limit(1);
        if (exists.length === 0) {
          throw new NotFoundException('检验批次不存在');
        }
        throw new BadRequestException('该批次已完成检验，不可重复提交');
      }
      console.log('1.批次更新成功（CAS 守卫通过）');

      // 2/3. 报告落库：iqc_report.lot_id 有唯一约束（一批次一份报告），
      //      驳回重检后再次提交时必须原位更新原报告，否则插入直接撞唯一键 500。
      const existingReportRows = await this.db
        .select({ id: iqcReport.id })
        .from(iqcReport)
        .where(eq(iqcReport.lotId, lotId))
        .limit(1);
      // 报告编号 = 仓库报检时生成的检验编号（缺失时兜底自动取号）
      const lotForNo = await this.db
        .select({ inspectionNo: iqcLot.inspectionNo })
        .from(iqcLot)
        .where(eq(iqcLot.id, lotId))
        .limit(1);
      const reportNo = lotForNo[0]?.inspectionNo || await this.generateReportNo();
      if (existingReportRows.length > 0) {
        await this.db.update(iqcReport).set({
          reportNo,
          finalResult: finalResultResolved,
          inspectionTime: now,
          reviewStatus: 'pending',
          remark: remark || '',
          // 重新提交视为新一轮审批，清空上一轮审批/驳回痕迹
          reviewerId: null,
          reviewTime: null,
          reviewRemark: null,
          rejectReason: null,
          rejectTime: null,
          rejectorId: null,
        }).where(eq(iqcReport.id, existingReportRows[0].id));
        console.log('3.报告已原位更新（重检提交）:', reportNo);
      } else {
        await this.db.insert(iqcReport).values({
          lotId,
          reportNo,
          finalResult: finalResultResolved,
          inspectionTime: now,
          reviewStatus: 'pending',
          remark: remark || '',
        });
        console.log('3.报告插入成功:', reportNo);
      }

      // 4. 插入检验记录（先清掉该批次旧记录：驳回重检后再次提交时避免记录翻倍，
      //    否则新旧记录混在一起，也会干扰「按记录推导最终判定」）
      await this.db.delete(iqcInspectionRecord).where(eq(iqcInspectionRecord.lotId, lotId));
      if (normalizedRecords.length > 0) {
        for (const [idx, rec] of normalizedRecords.entries()) {
          try {
            await this.db.insert(iqcInspectionRecord).values({
              lotId,
              itemName: rec.itemName || `项目${idx+1}`,
              standard: rec.standard ?? null,
              spec: rec.spec ?? null,
              unit: rec.unit ?? null,
              measuredValue: rec.measuredValue ?? null,
              measuredValues: rec.measuredValues ?? null,
              defectDescription: rec.defectDescription ?? null,
              defectQty: rec.defectQty || 0,
              isPass: rec.isPass ?? true,
              sortOrder: idx + 1,
              sectionType: rec.sectionType || '',
              samplingPlanText: rec.samplingPlanText ?? null,
              aql: rec.aql ?? null,
              sampleSize: rec.sampleSize ?? null,
              ac: rec.ac ?? null,
              re: rec.re ?? null,
              templateItemId: rec.templateItemId,
            } as any);
          } catch (e) {
            console.log(`记录${idx}插入失败：`, e.message);
          }
        }
        console.log('4.检验记录插入完成，共', records.length, '条');
      }

      console.log('=== 提交成功 ===');
      return { success: true, lotId, reportNo };
    } catch (e) {
      console.error('提交失败：', e);
      // 原本是 `throw new Error('提交失败：' + e.message)`，会把底层错误对象整个丢掉：
      // 全局异常过滤器沿 cause 链找 Postgres 错误码，链一断就认不出
      // 23503（关联数据不存在）/ 22P02（非法 UUID）等调用方问题，一律误报 500。
      // 这里保留 cause 链；HttpException（业务校验失败）原样抛出，不包壳。
      if (e instanceof HttpException) throw e;
      throw new Error('提交失败：' + (e as Error).message, { cause: e });
    }
  }

  // ===== 检验草稿（填写过程中的临时存档，独立于报告/记录表）=====

  /** 读取某批次的检验草稿，没有则返回 null */
  async getInspectionDraft(lotId: string): Promise<any | null> {
    const rows = await this.db
      .select()
      .from(iqcInspectionDraft)
      .where(eq(iqcInspectionDraft.lotId, lotId))
      .limit(1);
    if (rows.length === 0) return null;
    const row: any = rows[0];
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    return { ...payload, updatedAt: payload.updatedAt || row.updatedAt };
  }

  /** 覆盖保存某批次的检验草稿（upsert，不产生任何业务副作用） */
  async saveInspectionDraft(
    lotId: string,
    payload: Record<string, any>,
    inspectorId?: string,
  ): Promise<{ updatedAt: string }> {
    const now = new Date();
    const safePayload = {
      ...(payload || {}),
      lotId,
      updatedAt: payload?.updatedAt || now.toISOString(),
    };

    // 乱序保护：前端可能并发推送，旧快照不能把新草稿覆盖回去
    const prevRows = await this.db
      .select({ payload: iqcInspectionDraft.payload })
      .from(iqcInspectionDraft)
      .where(eq(iqcInspectionDraft.lotId, lotId))
      .limit(1);
    const prevUpdatedAt = (prevRows[0]?.payload as any)?.updatedAt;
    if (
      prevUpdatedAt &&
      draftTimeMs(safePayload.updatedAt) < draftTimeMs(prevUpdatedAt)
    ) {
      return { updatedAt: prevUpdatedAt };
    }

    await this.db
      .insert(iqcInspectionDraft)
      .values({
        lotId,
        payload: safePayload,
        inspectorId: inspectorId || null,
        updatedAt: now,
      } as any)
      .onConflictDoUpdate({
        target: iqcInspectionDraft.lotId,
        set: {
          payload: safePayload,
          inspectorId: inspectorId || null,
          updatedAt: now,
        } as any,
      });

    return { updatedAt: safePayload.updatedAt };
  }

  /** 清除草稿（提交成功后调用） */
  async clearInspectionDraft(lotId: string): Promise<{ cleared: boolean }> {
    await this.db.delete(iqcInspectionDraft).where(eq(iqcInspectionDraft.lotId, lotId));
    return { cleared: true };
  }

  /**
   * 读取某批次已落库的检验记录（驳回重检再进入时用于回填上次填写内容）
   */
  async getLotRecords(lotId: string): Promise<any[]> {
    const rows = await this.db
      .select()
      .from(iqcInspectionRecord)
      .where(eq(iqcInspectionRecord.lotId, lotId))
      .orderBy(asc(iqcInspectionRecord.sortOrder));
    return rows.map((r: any) => ({
      templateItemId: r.templateItemId,
      sectionType: r.sectionType,
      itemName: r.itemName,
      standard: r.standard,
      spec: r.spec,
      specMin: r.specMin,
      specMax: r.specMax,
      unit: r.unit,
      measuredValue: r.measuredValue,
      measuredValues: Array.isArray(r.measuredValues) ? r.measuredValues : [],
      defectDescription: r.defectDescription,
      defectQty: Number(r.defectQty ?? 0),
      // 历史记录 is_pass 可能为空：按「不良数 + Ac」补算，空不良数视为合格
      isPass: r.isPass ?? resolveRecordIsPass(r),
      sortOrder: r.sortOrder,
      samplingPlanText: r.samplingPlanText,
      aql: r.aql,
      sampleSize: r.sampleSize,
      ac: r.ac,
      re: r.re,
    }));
  }

  /**
   * Save inspection records as draft.
   * - Deletes existing records for this lot, inserts new ones
   * - Creates a pending report placeholder if none exists yet
   * - Lot status stays as-is (pending / rejected / etc.)
   * - No inventory change, no final result
   */
  async saveInspectionRecords(
    lotId: string,
    records: IqcInspectionRecordInput[],
    inspectorId: string,
    inspectorName: string,
    remark?: string,
  ): Promise<IqcLotWithDetail> {
    // 清洗检验员标识（账号名换成 uuid），避免脏值入库
    const safeInspectorId = (await this.normalizeUserRef(inspectorId)) || null;
    const lotResult = await this.db
      .select()
      .from(iqcLot)
      .where(eq(iqcLot.id, lotId))
      .limit(1);

    if (lotResult.length === 0) {
      throw new NotFoundException('检验批次不存在');
    }

    const lot = lotResult[0];

    await this.db.transaction(async (tx) => {
      // 删除该批次已有检验记录
      await tx.delete(iqcInspectionRecord).where(eq(iqcInspectionRecord.lotId, lotId));

      // 插入新的检验记录
      if (records && records.length > 0) {
        const recordValues = records.map((rec: IqcInspectionRecordInput, idx: number) => ({
          lotId,
                    templateItemId: rec.templateItemId,
          sectionType: rec.sectionType,
          itemName: rec.itemName,
          standard: rec.standard,
          spec: (rec as any).spec ?? null,
          specMin: rec.specMin ?? rec.lsl ?? null,
          specMax: rec.specMax ?? rec.usl ?? null,
          unit: rec.unit,
          measuredValue: rec.measuredValue,
          measuredValues: rec.measuredValues ?? null,
          defectDescription: rec.defectDescription,
          defectQty: String(toNonNegativeNumber(rec.defectQty)),
          // 小项判定统一由「不良数 + Ac」推导：没填不良数 = 合格
          isPass: resolveRecordIsPass(rec),
          sortOrder: rec.sortOrder ?? idx,
          samplingPlanText: rec.samplingPlanText ?? null,
          aql: rec.aql ?? null,
          sampleSize: rec.sampleSize ?? null,
          ac: rec.ac ?? null,
          re: rec.re ?? null,
        }));
        await tx.insert(iqcInspectionRecord).values(recordValues);
      }

      // 更新批次的检验员信息（不改变状态和结果）
      // 修复：原代码 .set({}) 空对象导致 drizzle "No values to set" 500
      await tx
        .update(iqcLot)
        .set({
          inspectorId: safeInspectorId as any,
        })
        .where(eq(iqcLot.id, lotId));

      // 如果还没有报告，创建一个 pending 状态的占位报告
      const existingReport = await tx
        .select()
        .from(iqcReport)
        .where(eq(iqcReport.lotId, lotId))
        .limit(1);

      if (existingReport.length === 0) {
        // 报告编号沿用仓库报检时生成的检验编号
        const reportNo = lot.inspectionNo || await this.generateReportNo();
        await tx.insert(iqcReport).values({
          lotId,
          reportNo,
          finalResult: 'pass',
                    reviewStatus: 'pending',
          remark,
        });
      } else {
        // 更新已有报告的检验员和备注
        await tx
          .update(iqcReport)
          .set({
                        remark,
          })
          .where(eq(iqcReport.lotId, lotId));
      }
    });

    return this.getLotDetail(lotId);
  }

  /**
   * Judge a lot: set final result, move lot status to review_pending.
   * Records are expected to have been saved already via saveInspectionRecords.
   */
  /**
   * 人工判定：仅用于「完全没有检验小项」的批次，由 IQC 主管/质量经理操作。
   *
   * 权限由 controller 的 @NeedRoles 限制，此处再做业务约束：
   *  - 原因必填（质量体系审核必查项）；
   *  - 批次已录入任何小项 → 直接拒绝：结论必须由小项推导，不允许人工覆盖事实；
   *  - 落库留痕：判定人、判定时间、原因写入报告，批次 remark 同步追加。
   */
  async judgeLot(
    lotId: string,
    finalResult: 'pass' | 'fail',
    defectType?: string,
    options?: { reason?: string; operatorId?: string; operatorName?: string },
  ): Promise<IqcLotWithDetail> {
    // F-03 修复（P1）：入口做运行时枚举校验。
    // TS 联合类型 'pass' | 'fail' 只在编译期存在，运行时没有任何约束：
    // 直接 POST {"finalResult":"xyz"} 会被原样写进 iqc_lot.inspection_result 与 iqc_report.final_result，
    // 形成脏数据。必须在任何写库之前拦下非法取值。
    if (finalResult !== 'pass' && finalResult !== 'fail') {
      throw new BadRequestException('判定结果非法，仅支持 pass 或 fail');
    }

    // 人工判定原因必填：此前不记录任何原因与判定人，出现「零小项却判合格」的报告
    // 事后无法追溯是谁放的、依据是什么（库里 5 份历史数据即为此类）。
    const judgeReason = String(options?.reason ?? '').trim();
    if (judgeReason.length < 2) {
      throw new BadRequestException('人工判定必须填写原因');
    }
    if (judgeReason.length > 500) {
      throw new BadRequestException('人工判定原因不能超过 500 字');
    }
    const operatorName = String(options?.operatorName ?? '').trim();
    // user_profile 是复合类型，必须先归一成合法用户 id，否则 ::user_profile 会报错
    const safeJudgedBy = options?.operatorId
      ? await this.normalizeUserRef(options.operatorId)
      : '';

    // 批次结论必须由检验小项推导，人工判定只能用于「完全没有小项」的批次。
    // 此前这里是用小项结果静默覆盖手工选择——既让人以为改判成功（实际被改回去），
    // 也挡不住「有检验数据却绕过报告」的路径。改为明确拒绝，并告知正确做法。
    const judgeRecordRows = await this.db
      .select({ id: iqcInspectionRecord.id })
      .from(iqcInspectionRecord)
      .where(eq(iqcInspectionRecord.lotId, lotId));
    if (judgeRecordRows.length > 0) {
      throw new BadRequestException(
        `该批次已录入 ${judgeRecordRows.length} 条检验小项，批次结论必须由小项推导，不能人工判定；如需改判请驳回后重新检验`,
      );
    }
    // 与 submitInspection 同口径：不合格必须维护不合格类型
    const safeDefectType = this.resolveDefectType(defectType, finalResult);

    const lotResult = await this.db
      .select()
      .from(iqcLot)
      .where(eq(iqcLot.id, lotId))
      .limit(1);

    if (lotResult.length === 0) {
      throw new NotFoundException('检验批次不存在');
    }

    const lot = lotResult[0];
    if (lot.status === 'pass' || lot.status === 'fail') {
      throw new BadRequestException('该批次已完成检验，不可重复判定');
    }

    // 人工判定合格（急料放行）与正常检验、免检确认走同一道闸：
    // 超期物料必须先维护延期天数，否则会绕过「判合格前校验」直接放行过期库存。
    // 此前确实存在这条路径：系统管理员人工判定合格 → 账上有效期仍过期 → 发料侧照样能发。
    if (finalResult === 'pass') {
      await this.assertExpiryExtendedBeforePass(this.db, lot);
    }

    const reportResult = await this.db
      .select()
      .from(iqcReport)
      .where(eq(iqcReport.lotId, lotId))
      .limit(1);

    // 修复：now 需在首次使用前声明（原代码在插入报告之后才声明，导致 ReferenceError）
    const now = new Date();

    // 人工判定留痕（质量体系审核必查项）：判定方式 + 原因 + 判定人 + 时间。
    // 报告号保持与检验编号一致（仓库/客户按检验编号对账），靠 judge_mode 标记区分，
    // 不额外加后缀，避免破坏对账口径。
    const judgeTrace = `[人工判定] 判定人:${operatorName || '-'}｜原因:${judgeReason}`;
    const mergedLotRemark = lot.remark ? `${lot.remark}｜${judgeTrace}` : judgeTrace;
    const prevReportRemark = reportResult[0]?.remark || '';
    const mergedReportRemark = prevReportRemark
      ? `${prevReportRemark}｜${judgeTrace}`
      : judgeTrace;

    if (reportResult.length === 0) { // 直接判定，没有报告就创建一个
        await this.db.insert(iqcReport).values({
          lotId,
          // 报告编号沿用仓库报检时生成的检验编号
          reportNo: (lot as any).inspectionNo || await this.generateReportNo(),
          finalResult,
          inspectionTime: now,
          reviewStatus: 'pending',
          judgeMode: 'manual',
          judgeReason,
          judgedBy: (safeJudgedBy || null) as any,
          judgedAt: now,
          inspectorId: (safeJudgedBy || null) as any,
          remark: mergedReportRemark,
        });
      }

    // 修复：新建报告时 reportResult 为空数组，直接取 [0].reviewStatus 会崩溃
    const currentReviewStatus = reportResult[0]?.reviewStatus ?? 'pending';
    if (currentReviewStatus === 'approved') {
      throw new BadRequestException('该报告已审批，不可重复判定');
    }

    await this.db.transaction(async (tx) => {
      // 更新批次：设置结果和待审核状态（CAS：仅 pending/inspecting/rejected 可判定，防并发重复判定）
      const judgeCasRows = (await tx
        .update(iqcLot)
        .set({
          inspectionResult: finalResult,
          status: 'review_pending',
          inspectionTime: now,
          defectType: safeDefectType,
          // 人工判定同样要记「操作人」：已完成检验清单/报告打印的「检验员」列读的是
          // iqc_lot.inspector_id，此前只写了报告的 inspector_id / judged_by，
          // 导致这类单据在列表里检验员一栏全是「-」（2026-10-26 反馈）。
          inspectorId: (safeJudgedBy || null) as any,
          remark: mergedLotRemark,
        })
        .where(and(eq(iqcLot.id, lotId), inArray(iqcLot.status, ['pending', 'inspecting', 'rejected'])))
        .returning({ id: iqcLot.id })) as Array<{ id: string }>;
      if (judgeCasRows.length === 0) {
        throw new ConflictException('该批次状态已变更，不可重复判定');
      }

      // 更新报告：设置最终结果和检验时间，并打上人工判定标记
      await tx
        .update(iqcReport)
        .set({
          finalResult,
          inspectionTime: now,
          reviewStatus: 'pending',
          judgeMode: 'manual',
          judgeReason,
          judgedBy: (safeJudgedBy || null) as any,
          judgedAt: now,
          inspectorId: (safeJudgedBy || null) as any,
          remark: mergedReportRemark,
        })
        .where(eq(iqcReport.lotId, lotId));
    });

    return this.getLotDetail(lotId);
  }

  /**
   * 免检确认：检验属性（外观 + 尺寸功能）均为免检的批次，
   * IQC 核对物料编号、供应商等报检信息后直接维护为合格并放行。
   *
   * 与正常检验放行的区别：
   * - 不生成 iqc_report、不生成 iqc_inspection_record（不做检验记录）；
   * - 无需主管审批，确认即生效；
   * - 在批次上留痕：确认人（inspectorId）、确认时间（inspectionTime）、备注。
   */
  async exemptConfirmLot(
    lotId: string,
    operatorId: string,
    operatorName: string,
    remark?: string,
  ): Promise<IqcLotWithDetail> {
    this.assertUuid(lotId, '检验批次');
    const lotResult = await this.db
      .select()
      .from(iqcLot)
      .where(eq(iqcLot.id, lotId))
      .limit(1);

    if (lotResult.length === 0) {
      throw new NotFoundException('检验批次不存在');
    }
    const lot = lotResult[0];
    if (lot.status === 'pass' || lot.status === 'fail') {
      throw new BadRequestException('该批次已完成检验，不可重复确认');
    }

    // 前置校验：物料严格度必须为免检（物料级一条账）
    const strictnessState = await this.strictnessService.getCurrentStrictness(lot.materialId);
    if (strictnessState?.strictness !== 'exempt') {
      throw new BadRequestException('该物料检验属性不是免检，不能做免检确认');
    }

    const safeOperatorId = await this.normalizeUserRef(operatorId);
    const now = new Date();
    const trace = `[免检确认] 确认人:${operatorName || '-'}${remark ? ' 备注:' + remark : ''}`;
    const mergedRemark = lot.remark ? `${lot.remark}｜${trace}` : trace;

    // 免检确认 = 直接合格放行，同样要求超期物料先维护新有效期
    await this.assertExpiryExtendedBeforePass(this.db, lot);

    await this.db.transaction(async (tx) => {
      // 免检确认 = 合格放行。必须 CAS：仅 active 状态可确认，否则与 reviewReport 并发会双放行/双冲减欠料。
      const exemptCasRows = (await tx
        .update(iqcLot)
        .set({
          // 免检确认等价于合格放行
          status: 'pass',
          inspectionResult: 'pass',
          inspectionTime: now,
          inspectorId: (safeOperatorId || null) as any,
          remark: mergedRemark,
        })
        .where(and(eq(iqcLot.id, lotId), inArray(iqcLot.status, ['pending', 'inspecting', 'review_pending', 'rejected'])))
        .returning({ id: iqcLot.id })) as Array<{ id: string }>;
      if (exemptCasRows.length === 0) {
        throw new ConflictException('该批次已完成检验或状态已变更，不可免检确认');
      }

      // 复用合格分支：解锁库存 + 收货单置 iqc_pass
      await this.finalizeLotInventory(tx, lot, 'pass');
    });

    // 与正常 PASS 一致：冲减供应商欠料（容错，不影响确认结果）
    if (lot.supplierId && lot.materialId) {
      try {
        await this.supplierDebtService.settleDebtOnReceipt({
          supplierId: lot.supplierId,
          materialId: lot.materialId,
          qty: Number(lot.totalQty),
          receiptId: lot.id,
          receiptNo: lot.lotNo,
          userId: (safeOperatorId || operatorId) as string,
        });
      } catch (err: unknown) {
        this.logger.error(`免检确认自动冲减欠料失败: lotId=${lotId}, error=${JSON.stringify(err)}`);
      }
    }

    this.logger.log(`免检确认合格: lotId=${lotId}, material=${lot.materialId}, by=${operatorName}`);
    return this.getLotDetail(lotId);
  }

  async setLotTemplate(lotId: string, templateId: string): Promise<any> {
    const lotResult = await this.db
      .select()
      .from(iqcLot)
      .where(eq(iqcLot.id, lotId))
      .limit(1);

    if (lotResult.length === 0) {
      throw new NotFoundException('检验批次不存在');
    }

    await this.db
      .update(iqcLot)
      .set({ templateId })
      .where(eq(iqcLot.id, lotId));

    const updated = await this.db
      .select()
      .from(iqcLot)
      .where(eq(iqcLot.id, lotId))
      .limit(1);

    return updated[0];
  }

  /**
   * 检验报告列表。
   * 支持服务端筛选（此前前端只取 100 条再本地过滤，超过 100 条的报告会被漏掉）。
   */
  async getRecordList(params: any): Promise<any> {
    const {
      page = 1,
      pageSize = 20,
      reviewStatus,
      finalResult,
      reportNo,
      materialCode,
      supplierCode,
      batchNo,
    } = params || {};

    const conditions: any[] = [];
    if (reviewStatus) conditions.push(eq(iqcReport.reviewStatus, String(reviewStatus)));
    if (finalResult) conditions.push(eq(iqcReport.finalResult, String(finalResult)));
    if (reportNo) conditions.push(like(iqcReport.reportNo, `%${reportNo}%`));
    if (materialCode) conditions.push(like(material.materialCode, `%${materialCode}%`));
    if (supplierCode) conditions.push(like(supplier.supplierCode, `%${supplierCode}%`));
    if (batchNo) conditions.push(like(iqcLot.batchNo, `%${batchNo}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await this.db
      .select()
      .from(iqcReport)
      .leftJoin(iqcLot, eq(iqcReport.lotId, iqcLot.id))
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .where(where)
      .orderBy(desc(iqcReport.inspectionTime))
      .limit(Number(pageSize))
      .offset((Number(page) - 1) * Number(pageSize));

    // 真实总数（按同样的筛选条件统计）
    const totalResult = await this.db
      .select({ c: count() })
      .from(iqcReport)
      .leftJoin(iqcLot, eq(iqcReport.lotId, iqcLot.id))
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .where(where);
    const total = Number(totalResult[0]?.c ?? 0);

    // 判定一致性兜底：批量查出本页中「存在不合格记录」的批次，用于纠正报告判定
    const pageLotIds = items
      .map((row: any) => row.iqc_report?.lotId)
      .filter((v: any): v is string => !!v);
    const ngLotIds = new Set<string>();
    if (pageLotIds.length > 0) {
      const ngRows = await this.db
        .selectDistinct({ lotId: iqcInspectionRecord.lotId })
        .from(iqcInspectionRecord)
        .where(
          and(
            inArray(iqcInspectionRecord.lotId, pageLotIds),
            eq(iqcInspectionRecord.isPass, false),
          ),
        );
      ngRows.forEach((r: any) => r.lotId && ngLotIds.add(r.lotId));
    }

    const formatted = items.map((row: any) => ({
      ...row.iqc_report,
      // 判定一致性兜底：本页中任一报告只要存在不合格记录，列表也要显示 fail，
      // 避免出现「列表显示 Pass、进去详情是 Fail」的错位。
      finalResult: ngLotIds.has(row.iqc_report?.lotId) ? 'fail' : row.iqc_report?.finalResult,
      inspectionTime: row.iqc_report?.inspectionTime instanceof Date
        ? row.iqc_report.inspectionTime.toISOString()
        : row.iqc_report?.inspectionTime,
      lot: {
        ...row.iqc_lot,
        materialCode: row.material?.materialCode || row.material?.material_code,
        materialName: row.material?.materialName || row.material?.material_name,
        supplierCode: row.supplier?.supplierCode || row.supplier?.supplier_code,
        supplierName: row.supplier?.supplierName || row.supplier?.supplier_name,
      },
    }));

    // 回填检验员姓名：报告审批 / 已完成检验列表新增「检验员」列，
    // 显示实际执行检验的账号姓名（inspectorId 在提交检验时写入批次）
    //
    // 兜底链（2026-10-26）：历史数据里人工判定/急料放行的单据只写了报告上的
    // inspector_id（甚至只有 judged_by），批次的 inspector_id 是空的，
    // 列表因此整列显示「-」。这里按「批次检验员 → 报告检验员 → 人工判定人」
    // 依次取值，谁操作的就显示谁，不需要回写历史数据。
    const nameCarriers: any[] = formatted.map((f: any, i: number) => {
      const report: any = (items[i] as any)?.iqc_report || {};
      return {
        inspectorId: f.lot?.inspectorId || report.inspectorId || report.judgedBy || null,
      };
    });
    if (nameCarriers.length > 0) {
      await this.attachUserNames(nameCarriers, { inspectorId: 'inspectorName' });
      nameCarriers.forEach((c: any, i: number) => {
        if (formatted[i].lot) formatted[i].lot.inspectorName = c.inspectorName;
      });
    }

    return { items: formatted, total, page: Number(page), pageSize: Number(pageSize) };
  }

  async getReportDetail(id: string): Promise<IqcReport & { lot?: IqcLot; records?: IqcInspectionRecord[] }> {
    const reportResult = await this.db
      .select({
        report: {
          id: iqcReport.id,
          lotId: iqcReport.lotId,
          reportNo: iqcReport.reportNo,
          finalResult: iqcReport.finalResult,
          inspectorId: iqcReport.inspectorId,
          inspectionTime: iqcReport.inspectionTime,
          reviewerId: iqcReport.reviewerId,
          reviewTime: iqcReport.reviewTime,
          reviewRemark: iqcReport.reviewRemark,
          reviewStatus: iqcReport.reviewStatus,
          rejectReason: iqcReport.rejectReason,
          rejectTime: iqcReport.rejectTime,
          rejectorId: iqcReport.rejectorId,
          remark: iqcReport.remark,
          // 人工判定留痕（2026-10-18）：报告页要标红「人工判定」并展示原因
          judgeMode: iqcReport.judgeMode,
          judgeReason: iqcReport.judgeReason,
          judgedBy: iqcReport.judgedBy,
          judgedAt: iqcReport.judgedAt,
          // 审核人姓名（报告打印表头「批准」栏用）在下方用 attachUserNames 安全回填：
          // 历史数据里 user_id 可能存的是账号名（如 "admin"）而非 uuid，
          // 直接 ::uuid 强转会让整条查询报 500（单个审批失败的根因），故不再在 SQL 里强转。
        },
        lot: {
          id: iqcLot.id,
          lotNo: iqcLot.lotNo,
          receiptDate: iqcLot.receiptDate,
          supplierId: iqcLot.supplierId,
          supplierCode: supplier.supplierCode,
          supplierName: supplier.supplierName,
          materialId: iqcLot.materialId,
          materialCode: material.materialCode,
          materialName: material.materialName,
          totalQty: iqcLot.totalQty,
          unit: iqcLot.unit,
          productionDate: iqcLot.productionDate,
          batchNo: iqcLot.batchNo,
          status: iqcLot.status,
          inspectionResult: iqcLot.inspectionResult,
          defectType: iqcLot.defectType,
          // 检验员 / 批准人 ID 必须查出来：下方 attachUserNames 靠它们回填姓名，
          // 此前漏查导致报告详情/打印表头「检验员」「批准」栏永远空白
          inspectorId: iqcLot.inspectorId,
          approverId: iqcLot.approverId,
          // 以下字段此前漏查，导致报告表头「箱数 / 仓库地址码 / 物料来源」打印空白
          locationCodes: iqcLot.locationCodes,
          boxCount: iqcLot.boxCount,
          materialSource: iqcLot.materialSource,
          inspectionTime: iqcLot.inspectionTime,
          remark: iqcLot.remark,
          // 检验员 / 批准人姓名同样在下方安全回填（原因同上，避免脏值导致查询 500）
        },
      })
      .from(iqcReport)
      .leftJoin(iqcLot, eq(iqcReport.lotId, iqcLot.id))
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .where(eq(iqcReport.id, id))
      .limit(1);

    if (reportResult.length === 0) {
      throw new NotFoundException('检验报告不存在');
    }

    const row = reportResult[0] as any;

    // 安全回填审核人 / 检验员 / 批准人姓名（兼容历史脏值：uuid 或账号名都能识别）
    // 检验员兜底链同列表：批次 → 报告 → 人工判定人，避免历史人工判定单据打印空白
    const nameCarrier: any = {
      reviewerId: row.report.reviewerId,
      inspectorId: row.lot?.inspectorId || row.report.inspectorId || row.report.judgedBy,
      approverId: row.lot?.approverId,
    };
    await this.attachUserNames([nameCarrier], {
      reviewerId: 'reviewerName',
      inspectorId: 'inspectorName',
      approverId: 'approverName',
    });
    row.report.reviewerName = nameCarrier.reviewerName;
    if (row.lot) {
      row.lot.inspectorName = nameCarrier.inspectorName;
      row.lot.approverName = nameCarrier.approverName;
    }

    const recordsResult = await this.db
      .select()
      .from(iqcInspectionRecord)
      .where(eq(iqcInspectionRecord.lotId, row.report.lotId))
      .orderBy(iqcInspectionRecord.sortOrder);

    const records: IqcInspectionRecord[] = recordsResult.map((r: any) => ({
      ...r,
      defectQty: Number(r.defectQty || 0),
      // 历史记录 is_pass 可能为空：按「不良数 + Ac」补算，空不良数视为合格
      isPass: r.isPass ?? resolveRecordIsPass(r),
      // 规格表达式列名已统一为 spec（2026-10-22 由 spc 更名）
      spec: r.spec ?? undefined,
      lsl: r.specMin ?? undefined,
      usl: r.specMax ?? undefined,
    }));

    // 判定一致性兜底：只要存在任一「不合格」记录，报告最终判定就必须是 fail。
    // 反向不成立（全部合格也可以是 fail，例如其他原因驳回），所以此处只做单向纠正。
    const storedFinalResult = (row.report.finalResult as string) || 'pass';
    const hasNgRecord = records.some((r) => r.isPass === false);
    const finalResult = hasNgRecord ? 'fail' : storedFinalResult;
    if (hasNgRecord && storedFinalResult !== 'fail') {
      console.warn(
        `[IQC] 报告 ${row.report.reportNo} 判定不一致：库中为 ${storedFinalResult}，因存在不合格记录按 fail 输出`,
      );
    }

    const detail = {
      ...row.report,
      finalResult,
      inspectionTime: row.report.inspectionTime
        ? (row.report.inspectionTime instanceof Date ? row.report.inspectionTime.toISOString() : row.report.inspectionTime)
        : undefined,
      reviewTime: row.report.reviewTime
        ? (row.report.reviewTime instanceof Date ? row.report.reviewTime.toISOString() : row.report.reviewTime)
        : undefined,
      rejectTime: row.report.rejectTime
        ? (row.report.rejectTime instanceof Date ? row.report.rejectTime.toISOString() : row.report.rejectTime)
        : undefined,
      lot: row.lot ? {
        ...row.lot,
        totalQty: Number(row.lot.totalQty),
        boxCount: row.lot.boxCount === null || row.lot.boxCount === undefined
          ? undefined
          : Number(row.lot.boxCount),
        receiptDate: row.lot.receiptDate
          ? (typeof row.lot.receiptDate === 'string' ? row.lot.receiptDate : row.lot.receiptDate.toISOString().slice(0, 10))
          : undefined,
        productionDate: row.lot.productionDate
          ? (typeof row.lot.productionDate === 'string' ? row.lot.productionDate : row.lot.productionDate.toISOString().slice(0, 10))
          : undefined,
        inspectionTime: row.lot.inspectionTime
          ? (row.lot.inspectionTime instanceof Date ? row.lot.inspectionTime.toISOString() : row.lot.inspectionTime)
          : undefined,
      } : undefined,
      records,
    };
    return detail;
  }

  /**
   * Approve a report: set review status to approved, update lot status to match
   * final result, set approver, and finalize inventory movement.
   */
  async reviewReport(
    id: string,
    reviewerId: string,
    reviewerName: string,
    reviewRemark?: string,
  ): Promise<IqcReport & { lot?: IqcLot; records?: IqcInspectionRecord[] }> {
    this.assertUuid(id, '检验报告');
    const reportResult = await this.db
      .select()
      .from(iqcReport)
      .where(eq(iqcReport.id, id))
      .limit(1);

    if (reportResult.length === 0) {
      throw new NotFoundException('检验报告不存在');
    }

    const report = reportResult[0];

    const lotResult = await this.db
      .select()
      .from(iqcLot)
      .where(eq(iqcLot.id, report.lotId))
      .limit(1);

    if (lotResult.length === 0) {
      throw new NotFoundException('关联批次不存在');
    }

    const lot = lotResult[0];
    const finalResult = report.finalResult as 'pass' | 'fail';

    // 判合格前必须已维护新有效期：超期物料没延期就放行，等于把过期物料放进可用库存。
    // 放在事务外先拦，避免白跑一遍库存迁移才发现不合格。
    if (finalResult === 'pass') {
      await this.assertExpiryExtendedBeforePass(this.db, lot);
    }

    const now = new Date();

    // 清洗审批人标识：账号名（如 "admin"）会被换成对应 uuid，避免写入脏值
    // 导致后续报告查询 ::uuid 强转报错（此前「单个审批失败」的根因之一）
    const safeReviewerId = (await this.normalizeUserRef(reviewerId)) || null;
    const safeReviewerName = reviewerName || null;

    // BUG-002 修复：审批必须幂等。
    // 原实现（注释「去掉重复审批校验，直接允许审批」）在事务内无条件更新，
    // 并发/重复点击时会多次执行库存流转与欠料冲减，导致债务被重复扣减。
    // 现改为 CAS：仅当 review_status 仍不是 approved 时才生效，影响行数为 0 即判定重复审批。
    await this.db.transaction(async (tx) => {
      // 1) CAS 抢占审批权：只有把 review_status 从「非 approved」改为 approved 的那一次请求才继续
      const casRows = (await tx
        .update(iqcReport)
        .set({
          reviewerId: safeReviewerId as any,
          reviewTime: now,
          reviewRemark,
          reviewStatus: 'approved',
        })
        .where(and(eq(iqcReport.id, id), sql`${iqcReport.reviewStatus} IS DISTINCT FROM 'approved'`))
        .returning({ id: iqcReport.id })) as Array<{ id: string }>;

      if (casRows.length === 0) {
        throw new ConflictException('该检验报告已审批，请勿重复审批');
      }

      // 2) 批次状态同步：同样加状态守卫，避免把已经是终态的批次反复改写
      const lotCasRows = (await tx
        .update(iqcLot)
        .set({
          status: finalResult,
          approverId: safeReviewerId as any,
        })
        .where(and(eq(iqcLot.id, report.lotId), inArray(iqcLot.status, ['pending', 'inspecting', 'review_pending', 'rejected'])))
        .returning({ id: iqcLot.id })) as Array<{ id: string }>;

      if (lotCasRows.length === 0) {
        throw new ConflictException('关联批次状态已变更，请刷新后重试');
      }

      // 3) 库存流转：与审批同事务执行。
      // 原实现用 try/catch 静默吞掉异常，会留下「审批已通过但不良品未隔离」的脏数据
      // （库存长期停留在良品仓 locked=true），因此改为失败即整体回滚并抛出。
      await this.finalizeLotInventory(tx, lot, finalResult);

      // 4) BUG-002：欠料冲减必须在「审批 CAS 成功」的同事务内完成，
      //    否则审批与冲减之间存在窗口，重复审批会重复扣减。原实现在事务外且 catch 吞异常。
      if (finalResult === 'pass' && lot.supplierId && lot.materialId) {
        await this.supplierDebtService.settleDebtOnReceipt({
          supplierId: lot.supplierId,
          materialId: lot.materialId,
          qty: Number(lot.totalQty),
          receiptId: lot.id,
          receiptNo: lot.lotNo,
          userId: (safeReviewerId || reviewerId) as string,
          tx,
        });
        this.logger.log(`IQC PASS自动冲减欠料: supplierId=${lot.supplierId}, materialId=${lot.materialId}, qty=${lot.totalQty}`);
      }
    });

    // 以下副作用在事务外执行，且各自具备幂等性；失败不影响审批结果（保持原有容错语义）
    if (finalResult === 'fail') {
      try {
        const mrb = await this.mrbService.initiateMrb({
          iqcLotId: report.lotId,
          // 操作人取本次审批的评审人；系统自动触发不做角色判定（roleCode 留空）
          operator: {
            userId: (safeReviewerId || reviewerId) as string,
            roleCode: '',
            name: reviewerName,
          },
          reason: 'IQC检验不合格主管审批通过，自动触发MRB评审',
        });
        // P2：MRB 建好后入队推 OA 评审（推送失败只记日志，不影响审批结果）
        try {
          if ((mrb as any)?.mrbNo) await this.oaMrb.enqueueCreated((mrb as any).mrbNo);
        } catch (e: unknown) {
          this.logger.warn(`MRB 推送 OA 入队失败: ${e instanceof Error ? e.message : e}`);
        }
      } catch (err: unknown) {
        this.logger.error(`自动创建MRB失败: lotId=${report.lotId}, error=${JSON.stringify(err)}`);
      }
    }

    // 更新检验严格度状态机（物料级一条账）
    // 计数口径：只取**整份报告的最终判定**，不按 NG 工段拆分；一份报告只计一次。
    // 接收批数以「提交到 IQC 后合并成的批次」为单位（传 lotNo 供服务端判定计数范围），
    // 该状态机依赖 iqc_lot_strictness_count 唯一键，天然幂等。
    try {
      const accepted = finalResult === 'pass';
      await this.strictnessService.onInspectionResult(
        lot.materialId,
        accepted,
        id,
        report.lotId,
        lot.lotNo,
      );
    } catch (err: unknown) {
      this.logger.error(`更新严格度状态失败: materialId=${lot.materialId}, error=${JSON.stringify(err)}`);
    }

    return this.safeReportDetail(id, {
      ...report,
      reviewStatus: 'approved',
      reviewerId: safeReviewerId,
      reviewerName: safeReviewerName,
      reviewTime: now,
      reviewRemark: reviewRemark ?? null,
    });
  }

  /**
   * Reject a report: set review status to rejected, update lot status to rejected,
   * and set lot remark to include the reject reason.
   */
  async rejectReport(
    id: string,
    rejectorId: string,
    rejectorName: string,
    rejectReason: string,
  ): Promise<IqcReport & { lot?: IqcLot; records?: IqcInspectionRecord[] }> {
    this.assertUuid(id, '检验报告');
    const reportResult = await this.db
      .select()
      .from(iqcReport)
      .where(eq(iqcReport.id, id))
      .limit(1);

    if (reportResult.length === 0) {
      throw new NotFoundException('检验报告不存在');
    }

    const report = reportResult[0];
    // 去掉重复审批校验，直接允许审批

    const lotResult = await this.db
      .select()
      .from(iqcLot)
      .where(eq(iqcLot.id, report.lotId))
      .limit(1);

    if (lotResult.length === 0) {
      throw new NotFoundException('关联批次不存在');
    }

    const lot = lotResult[0];
    const now = new Date();
    const lotRemark = `驳回原因：${rejectReason}`;

    // 同样清洗驳回人标识（账号名统一换成 uuid），避免脏值让报告查询报错
    const safeRejectorId = (await this.normalizeUserRef(rejectorId)) || null;

    await this.db.transaction(async (tx) => {
      // 更新报告驳回信息
      await tx
        .update(iqcReport)
        .set({
          reviewStatus: 'rejected',
          rejectReason,
          rejectTime: now,
          rejectorId: safeRejectorId as any,
        })
        .where(eq(iqcReport.id, id));

      // 更新批次状态为已驳回，备注写入驳回原因
      await tx
        .update(iqcLot)
        .set({
          status: 'rejected',
          remark: lotRemark,
        })
        .where(eq(iqcLot.id, report.lotId));
    });

    return this.safeReportDetail(id, {
      ...report,
      reviewStatus: 'rejected',
      rejectReason,
      rejectTime: now,
      rejectorId: safeRejectorId,
    });
  }

  /**
   * Batch approve reports. Each approved report also finalizes its lot and
   * triggers inventory movement.
   */
  async batchApproveReports(
    ids: string[],
    reviewerId: string,
    reviewerName: string,
  ): Promise<{ success: number; failed: number; failedDetails: { id: string; reason: string }[] }> {
    if (!ids || ids.length === 0) {
      throw new BadRequestException('请选择要审批的报告');
    }

    const failedDetails: { id: string; reason: string; reportNo?: string }[] = [];
    let success = 0;

    for (const id of ids) {
      try {
        await this.reviewReport(id, reviewerId, reviewerName);
        success += 1;
      } catch (error) {
        failedDetails.push({ id, reason: error instanceof Error ? error.message : '未知错误' });
      }
    }

    // 补上报告编号，前端提示「哪几份没批成功」时更直观
    if (failedDetails.length > 0) {
      try {
        const noRows = await this.db
          .select({ id: iqcReport.id, reportNo: iqcReport.reportNo })
          .from(iqcReport)
          .where(inArray(iqcReport.id, failedDetails.map((f) => f.id)));
        const noMap = new Map(noRows.map((r: any) => [r.id, r.reportNo]));
        failedDetails.forEach((f) => {
          f.reportNo = noMap.get(f.id) || undefined;
        });
      } catch {
        /* 取编号失败不影响主流程 */
      }
    }

    return {
      success,
      failed: failedDetails.length,
      failedDetails,
    };
  }

  /**
   * IQC 检验 LOT 合格率统计
   * 仅统计 inspection_result IN ('pass','fail') 的批次（排除 pending）
   *
   * 注：本接口已被 `/api/dashboard/iqc-stats`（单一口径的聚合接口）取代，
   * 前端不再调用；保留仅为兼容旧调用方，口径与聚合接口保持一致：
   * 时间闭区间、驳回批次计入总批数但不计合格。
   */
  async getPassRateStats(params: {
    startDate?: string;
    endDate?: string;
    materialCode?: string;
    materialType?: string;
    supplierCode?: string;
    groupBy?: 'day' | 'week' | 'month';
  }): Promise<{
    summary: { totalLots: number; passedLots: number; failedLots: number; passRate: number };
    trend: Array<{ period: string; totalLots: number; passedLots: number; passRate: number }>;
    topMaterials: Array<{ materialCode: string; materialName: string; totalLots: number; passedLots: number; passRate: number }>;
    topSuppliers: Array<{ supplierCode: string; supplierName: string; totalLots: number; passedLots: number; passRate: number }>;
  }> {
    const { startDate, endDate, materialCode, materialType, supplierCode, groupBy = 'day' } = params;

    // 基础过滤条件：只统计已出结果（pass/fail）的批次
    const conditions = [inArray(iqcLot.inspectionResult, ['pass', 'fail'])];
    if (startDate) conditions.push(gte(iqcLot.receiptDate, startDate));
    // 闭区间：结束日取到当天（原用 lt 导致结束日选当天时整段查不到数据）
    if (endDate) conditions.push(lte(iqcLot.receiptDate, endDate));
    if (materialCode) conditions.push(like(material.materialCode, `%${materialCode}%`));
    if (materialType) conditions.push(eq(material.materialType, materialType));
    if (supplierCode) conditions.push(like(supplier.supplierCode, `%${supplierCode}%`));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const passedFilter = sql<number>`count(*) filter (where ${iqcLot.inspectionResult} = 'pass' and ${iqcLot.status} <> 'rejected')`;

    // 1. 汇总
    const summaryRows = await this.db
      .select({
        totalLots: count(),
        passedLots: passedFilter,
      })
      .from(iqcLot)
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .where(whereClause);

    const totalLots = Number(summaryRows[0]?.totalLots ?? 0);
    const passedLots = Number(summaryRows[0]?.passedLots ?? 0);
    const failedLots = totalLots - passedLots;
    const passRate = totalLots > 0 ? Math.round((passedLots / totalLots) * 10000) / 100 : 0;

    // 2. 趋势（按 day/week/month 分组）
    // 按周时显示为 YYWW（如 2632 = 26年第32周，ISO 周数）
    const periodExpr = groupBy === 'week'
      ? sql`substr(to_char(${iqcLot.receiptDate}, 'IYYY'), 3, 2) || lpad(to_char(${iqcLot.receiptDate}, 'IW'), 2, '0')`
      : groupBy === 'month'
        ? sql`date_trunc('month', ${iqcLot.receiptDate})`
        : sql`date(${iqcLot.receiptDate})`;

    const trendRows = await this.db
      .select({
        period: periodExpr.as('period'),
        totalLots: count(),
        passedLots: passedFilter,
      })
      .from(iqcLot)
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .where(whereClause)
      .groupBy(periodExpr)
      .orderBy(periodExpr);

    const trend = trendRows.map((row) => {
      const total = Number(row.totalLots ?? 0);
      const passed = Number(row.passedLots ?? 0);
      const periodVal = row.period;
      const periodStr = periodVal instanceof Date
        ? periodVal.toISOString().slice(0, 10)
        : String(periodVal ?? '');
      return {
        period: periodStr,
        totalLots: total,
        passedLots: passed,
        passRate: total > 0 ? Math.round((passed / total) * 10000) / 100 : 0,
      };
    });

    // 3. 物料 TOP10
    const topMaterialRows = await this.db
      .select({
        materialCode: material.materialCode,
        materialName: material.materialName,
        totalLots: count(),
        passedLots: passedFilter,
      })
      .from(iqcLot)
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .where(whereClause)
      .groupBy(material.materialCode, material.materialName)
      .orderBy(desc(count()))
      .limit(10);

    const topMaterials = topMaterialRows.map((row) => {
      const total = Number(row.totalLots ?? 0);
      const passed = Number(row.passedLots ?? 0);
      return {
        materialCode: row.materialCode ?? '',
        materialName: row.materialName ?? '',
        totalLots: total,
        passedLots: passed,
        passRate: total > 0 ? Math.round((passed / total) * 10000) / 100 : 0,
      };
    });

    // 4. 供应商 TOP10
    const topSupplierRows = await this.db
      .select({
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        totalLots: count(),
        passedLots: passedFilter,
      })
      .from(iqcLot)
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .where(whereClause)
      .groupBy(supplier.supplierCode, supplier.supplierName)
      .orderBy(desc(count()))
      .limit(10);

    const topSuppliers = topSupplierRows.map((row) => {
      const total = Number(row.totalLots ?? 0);
      const passed = Number(row.passedLots ?? 0);
      return {
        supplierCode: row.supplierCode ?? '',
        supplierName: row.supplierName ?? '',
        totalLots: total,
        passedLots: passed,
        passRate: total > 0 ? Math.round((passed / total) * 10000) / 100 : 0,
      };
    });

    return {
      summary: { totalLots, passedLots, failedLots, passRate },
      trend,
      topMaterials,
      topSuppliers,
    };
  }
}




