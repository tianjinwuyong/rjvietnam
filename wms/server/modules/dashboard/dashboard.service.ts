import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { count, eq, inArray, and, sql, desc, or, type SQL } from 'drizzle-orm';
import * as crypto from 'crypto';
import {
  MATERIAL_TYPES,
  isStandardMaterialType,
  materialTypeAliasValues,
  normalizeMaterialType,
} from '../../common/constants/material-types';
import { IQC_DEFECT_TYPE_LEGACY } from '../../common/constants/business-enums';

import {
  warehouse,
  material,
  supplier,
  iqcLot,
  iqcReport,
  iqcInspectionRecord,
  inventory,
  receiptOrder,
  pickingOrder,
  mrbReview,
  sysParam,
  sysAccount,
  workOrder,
  materialRequirementItem,
} from '@server/database/schema';
import type {
  DashboardStats,
  DashboardOverview,
  IqcSummary,
  IqcTrendPoint,
  IqcRankItem,
  IqcStatsBundle,
  IqcDefectTypeItem,
  IqcDefectMaterialTypeItem,
  IqcDefectDetailItem,
  IqcDefectDetailResult,
  IqcOverdueStats,
  PendingStats,
  SupplementSummary,
} from '@shared/api.interface';

export interface PdaTasksStats {
  pendingReceipt: number;
  pendingIqc: number;
  pendingPicking: number;
  pendingMrb: number;
  expiryWarning: number;
  expiryExpired: number;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getStats(): Promise<DashboardStats> {
    const [whResult, matResult, supResult, iqcResult] = await Promise.all([
      this.db.select({ count: count() }).from(warehouse),
      this.db.select({ count: count() }).from(material),
      this.db.select({ count: count() }).from(supplier),
      this.db.select({ count: count() }).from(iqcLot).where(inArray(iqcLot.status, ['pending', 'report_approval'])),
    ]);

    return {
      warehouseCount: Number(whResult[0]?.count ?? 0),
      materialCount: Number(matResult[0]?.count ?? 0),
      supplierCount: Number(supResult[0]?.count ?? 0),
      pendingIqcCount: Number(iqcResult[0]?.count ?? 0),
    };
  }

  async getPdaTasks(): Promise<PdaTasksStats> {
    // 计算实际效期：优先取延期记录 new_expiry_date，否则按 生产日期 + expiryDays 计算
    const expiryDateExpr = sql<string>`
      CASE
        WHEN ext.new_expiry_date IS NOT NULL THEN ext.new_expiry_date
        WHEN ${material.expiryDays} IS NOT NULL AND ${inventory.productionDate} IS NOT NULL
          THEN (${inventory.productionDate} + (${material.expiryDays} || ' days')::interval)::date
        ELSE NULL
      END
    `;
    const remainingDaysSql = sql<number>`(${expiryDateExpr} - CURRENT_DATE)::integer`;

    const [
      receiptResult,
      iqcResult,
      pickingResult,
      mrbResult,
      expiryResult,
    ] = await Promise.all([
      // 待检收货单：status = pending 或 received
      this.db
        .select({ count: count() })
        .from(receiptOrder)
        .where(inArray(receiptOrder.status, ['pending', 'received'])),
      // 待检验批次：status = pending
      this.db
        .select({ count: count() })
        .from(iqcLot)
        .where(eq(iqcLot.status, 'pending')),
      // 待拣货领料单：status = approved
      this.db
        .select({ count: count() })
        .from(pickingOrder)
        .where(eq(pickingOrder.status, 'approved')),
      // 待 MRB 评审：status = pending 或 reviewing
      this.db
        .select({ count: count() })
        .from(mrbReview)
        .where(inArray(mrbReview.status, ['pending_review', 'reviewing', 'pending_final'])),
      // 近效期 / 已过期库存数（仅良品，考虑延期记录）
      this.db
        .select({
          expiryWarning: sql<number>`COUNT(*) FILTER (WHERE ${remainingDaysSql} > 0 AND ${remainingDaysSql} <= 30)`,
          expiryExpired: sql<number>`COUNT(*) FILTER (WHERE ${remainingDaysSql} <= 0)`,
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
          // F-11：待检库存(pending_qc)也计入效期预警/超期统计（物理在库口径）
          inArray(inventory.stockStatus, ['good', 'pending_qc']),
          sql`${expiryDateExpr} IS NOT NULL`,
        )),
    ]);

    return {
      pendingReceipt: Number(receiptResult[0]?.count ?? 0),
      pendingIqc: Number(iqcResult[0]?.count ?? 0),
      pendingPicking: Number(pickingResult[0]?.count ?? 0),
      pendingMrb: Number(mrbResult[0]?.count ?? 0),
      expiryWarning: Number(expiryResult[0]?.expiryWarning ?? 0),
      expiryExpired: Number(expiryResult[0]?.expiryExpired ?? 0),
    };
  }

  // ========== 通用辅助 ==========

  /** 读取 sys_param 中的数值型参数，不存在或非法时返回默认值 */
  private async getParamNumber(paramKey: string, defaultValue: number): Promise<number> {
    const rows = await this.db
      .select({ value: sysParam.paramValue })
      .from(sysParam)
      .where(eq(sysParam.paramKey, paramKey))
      .limit(1);
    const raw = rows[0]?.value;
    if (raw == null) return defaultValue;
    const num = Number(raw);
    return Number.isFinite(num) ? num : defaultValue;
  }

  // ========== 1. 核心运营概览 ==========

  async getOverview(): Promise<DashboardOverview> {
    const [
      receiptResult,
      issueResult,
      pickingTodayResult,
      pickedResult,
      skuResult,
      stockQtyResult,
      pendingResult,
    ] = await Promise.all([
      // 今日入库批数：以「今日提报到 IQC 的检验批次」为准（2026-10-18 用户口径）。
      //
      // 为什么改口径：收货单（receipt_order）是「扫码暂收」的粒度，一箱一条，
      // 同批多箱会被算成多个批；而仓管口径的「批」是按检验批（iqc_lot）算的——
      // 报检时同供应商+物料+生产日期+批次号会并成一张检验单，那才是业务上说的「一批」。
      // 数量（qty）同步改用 iqc_lot.total_qty，避免「批数按批次算、数量按收货单算」的自相矛盾。
      this.db
        .select({
          lots: count(),
          qty: sql<string>`COALESCE(SUM(${iqcLot.totalQty}), '0')`,
        })
        .from(iqcLot)
        .where(sql`${iqcLot.createdAt}::date = CURRENT_DATE`),
      // 今日出库：已拣货/完成 且 pickTime 或 createdAt 为今天
      this.db
        .select({
          lots: count(),
          qty: sql<string>`COALESCE(SUM(${pickingOrder.totalQty}), '0')`,
        })
        .from(pickingOrder)
        .where(and(
          inArray(pickingOrder.status, ['picked', 'completed']),
          sql`COALESCE(${pickingOrder.pickTime}, ${pickingOrder.createdAt})::date = CURRENT_DATE`,
        )),
      // 今日创建领料单
      this.db
        .select({ count: count() })
        .from(pickingOrder)
        .where(sql`${pickingOrder.createdAt}::date = CURRENT_DATE`),
      // 今日已拣货发料数量
      this.db
        .select({
          qty: sql<string>`COALESCE(SUM(${pickingOrder.totalQty}), '0')`,
        })
        .from(pickingOrder)
        .where(and(
          inArray(pickingOrder.status, ['picked', 'completed']),
          sql`${pickingOrder.pickTime}::date = CURRENT_DATE`,
        )),
      // 库存 SKU 数（distinct material_id）
      this.db
        .select({ c: sql<number>`COUNT(DISTINCT ${inventory.materialId})` })
        .from(inventory),
      // 库存总数量（良品 + 待检；均为物理在库，避免账面少货）
      this.db
        .select({ q: sql<string>`COALESCE(SUM(${inventory.quantity}), '0')` })
        .from(inventory)
        .where(inArray(inventory.stockStatus, ['good', 'pending_qc'])),
      // 待检批数 / 待检超24h批数
      this.db
        .select({
          pending: count(),
          over24h: sql<number>`COUNT(*) FILTER (WHERE ${iqcLot.createdAt} < NOW() - INTERVAL '24 hours')`,
        })
        .from(iqcLot)
        .where(eq(iqcLot.status, 'pending')),
    ]);

    return {
      todayReceiptLots: Number(receiptResult[0]?.lots ?? 0),
      todayReceiptQty: Number(receiptResult[0]?.qty ?? 0),
      todayIssueLots: Number(issueResult[0]?.lots ?? 0),
      todayIssueQty: Number(issueResult[0]?.qty ?? 0),
      stockSkuCount: Number(skuResult[0]?.c ?? 0),
      stockTotalQty: Number(stockQtyResult[0]?.q ?? 0),
      pendingIqcCount: Number(pendingResult[0]?.pending ?? 0),
      pendingIqcOver24hCount: Number(pendingResult[0]?.over24h ?? 0),
      todayPickingOrders: Number(pickingTodayResult[0]?.count ?? 0),
      todayPickedQty: Number(pickedResult[0]?.qty ?? 0),
    };
  }

  // ========== 2. IQC 汇总 ==========

  async getIqcSummary(startDate?: string, endDate?: string): Promise<IqcSummary> {
    // 未传日期时默认近30天，避免 undefined 生成非法 SQL（>= ::date）
    const end = endDate || new Date().toISOString().slice(0, 10);
    const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const rows = await this.db
      .select({
        totalLots: count(),
        passedLots: sql<number>`COUNT(*) FILTER (WHERE ${iqcLot.inspectionResult} = 'pass' OR ${iqcReport.finalResult} = 'pass')`,
      })
      .from(iqcLot)
      .leftJoin(iqcReport, eq(iqcReport.lotId, iqcLot.id))
      .where(and(
        sql`${iqcLot.receiptDate} >= ${start}::date`,
        sql`${iqcLot.receiptDate} <= ${end}::date`,
        or(
          eq(iqcLot.status, 'completed'),
          inArray(iqcLot.inspectionResult, ['pass', 'fail']),
        ),
      ));

    const totalLots = Number(rows[0]?.totalLots ?? 0);
    const passedLots = Number(rows[0]?.passedLots ?? 0);
    const passRate = totalLots > 0
      ? Math.round((passedLots / totalLots) * 1000) / 10
      : 0;
    const targetPassRate = await this.getParamNumber('iqc_target_pass_rate', 95);

    return { totalLots, passedLots, passRate, targetPassRate };
  }

  // ========== 3. IQC 合格率趋势 ==========

  async getIqcTrend(opts: {
    startDate: string;
    endDate: string;
    granularity: 'month' | 'week' | 'day';
    groupBy: 'overall' | 'supplier' | 'materialType';
    supplier?: string;
    materialType?: string;
  }): Promise<IqcTrendPoint[]> {
    const endD = opts.endDate || new Date().toISOString().slice(0, 10);
    const startD = opts.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const { granularity, groupBy, supplier, materialType } = opts;
    const startDate = startD;
    const endDate = endD;

    // 白名单，防止 SQL 注入
    const gran = granularity === 'week' || granularity === 'day' ? granularity : 'month';
    const group = groupBy === 'supplier' || groupBy === 'materialType' ? groupBy : 'overall';

    // 时间截断与日期输出格式
    const truncExpr =
      gran === 'week' ? sql`date_trunc('week', l.receipt_date)`
      : gran === 'day' ? sql`date_trunc('day', l.receipt_date)`
      : sql`date_trunc('month', l.receipt_date)`;
    // 按周时显示为 YYWW（如 2632 = 26年第32周，ISO 周数）；固定4位字符串，可直接按字典序排序
    const dateExpr =
      gran === 'month'
        ? sql`to_char(date_trunc('month', l.receipt_date), 'YYYY-MM')`
        : gran === 'week'
          ? sql`substr(to_char(l.receipt_date, 'IYYY'), 3, 2) || lpad(to_char(l.receipt_date, 'IW'), 2, '0')`
          : sql`to_char(${truncExpr}, 'YYYY-MM-DD')`;

    // 关联表与分组键
    const joins: SQL[] = [];
    let groupKeyExpr = sql`'整体'`;
    if (group === 'supplier') {
      joins.push(sql`LEFT JOIN supplier s ON l.supplier_id = s.id`);
      groupKeyExpr = sql`s.supplier_name`;
    } else if (group === 'materialType') {
      joins.push(sql`LEFT JOIN material m ON l.material_id = m.id`);
      groupKeyExpr = sql`COALESCE(m.material_type, '未分类')`;
    }
    // 按物料类型过滤时也需要 material 表
    if (group !== 'materialType' && materialType) {
      joins.push(sql`LEFT JOIN material m ON l.material_id = m.id`);
    }
    // 按供应商模糊搜索时也需要 supplier 表
    if (group !== 'supplier' && supplier) {
      joins.push(sql`LEFT JOIN supplier s ON l.supplier_id = s.id`);
    }

    const whereParts: SQL[] = [
      sql`l.receipt_date >= ${startDate}::date`,
      sql`l.receipt_date <= ${endDate}::date`,
      sql`(l.status = 'completed' OR l.inspection_result IN ('pass','fail'))`,
    ];
    if (supplier) {
      whereParts.push(sql`s.supplier_name ILIKE ${'%' + supplier + '%'}`);
    }
    if (materialType) {
      whereParts.push(sql`m.material_type = ${materialType}`);
    }

    // 空数组时不使用 sql.join，避免 Drizzle 对空数组生成无效 SQL
    const joinsSql: SQL = joins.length > 0 ? sql.join(joins, sql` `) : sql``;
    const whereSql: SQL = whereParts.length > 0 ? sql.join(whereParts, sql` AND `) : sql``;

    const sqlQuery = sql`
      SELECT
        ${dateExpr} AS date,
        COUNT(*)::int AS "totalLots",
        COUNT(*) FILTER (WHERE l.inspection_result = 'pass' OR r.final_result = 'pass')::int AS "passedLots",
        ${groupKeyExpr} AS "groupKey"
      FROM iqc_lot l
      LEFT JOIN iqc_report r ON r.lot_id = l.id
      ${joinsSql}
      WHERE ${whereSql}
      GROUP BY 1, 4
      ORDER BY 1 ASC
    `;

    try {
      const result = await this.db.execute(sqlQuery);
      const rows = (result as unknown) as Array<{
        date: string;
        totalLots: number | string;
        passedLots: number | string;
        groupKey: string | null;
      }>;

      return rows.map((row) => {
        const totalLots = Number(row.totalLots ?? 0);
        const passedLots = Number(row.passedLots ?? 0);
        const passRate = totalLots > 0
          ? Math.round((passedLots / totalLots) * 1000) / 10
          : 0;
        return {
          date: row.date,
          totalLots,
          passedLots,
          passRate,
          groupKey: row.groupKey ?? undefined,
        };
      });
    } catch (err) {
      console.error('[DashboardService.getIqcTrend] 查询失败:', err);
      throw err;
    }
  }

  // ========== 3b. IQC 统计聚合（汇总 + 趋势 + 排行，单一口径） ==========

  /**
   * IQC 合格率统计聚合（合并原 `/api/iqc/stats/pass-rate` 的能力）。
   *
   * 此前看板上方（本服务 getIqcSummary/getIqcTrend）与下方（iqc.service.getPassRateStats）
   * 各有一套口径，导致同一时间段两个区块的数字对不上。此处统一为：
   *   1. 时间：按 iqc_lot.receipt_date，**闭区间** [startDate, endDate]
   *      （原下方实现用 `receipt_date < endDate`，结束日选到当天会整段漏数据）
   *   2. 范围：仅统计已出检验结果的批次 `inspection_result IN ('pass','fail')`
   *      （去掉恒不成立的 `status='completed'`）
   *   3. 合格：`inspection_result='pass' AND status <> 'rejected'`
   *      —— 被驳回的批次仍计入总批数，但不再算作合格，避免合格率虚高
   *   4. 不用 LEFT JOIN iqc_report 参与计数，避免一个 lot 多份报告时重复计数
   *   5. summary 由 trend 各点累加得出，保证"卡片数字"与"曲线"永远自洽
   */
  async getIqcStats(opts: {
    startDate?: string;
    endDate?: string;
    granularity: 'month' | 'week' | 'day';
    groupBy: 'overall' | 'supplier' | 'materialType';
    dimensionValue?: string;
    materialCode?: string;
  }): Promise<IqcStatsBundle> {
    const startDate =
      opts.startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const endDate = opts.endDate || new Date().toISOString().slice(0, 10);

    // 白名单，防注入
    const gran =
      opts.granularity === 'week' || opts.granularity === 'day' ? opts.granularity : 'month';
    const group =
      opts.groupBy === 'supplier' || opts.groupBy === 'materialType' ? opts.groupBy : 'overall';
    const dim = (opts.dimensionValue || '').trim();
    const materialCode = (opts.materialCode || '').trim();

    // 时间截断与标签：月=YYYY-MM，周=YYWW，日=YYYY-MM-DD
    const dateExpr =
      gran === 'month'
        ? sql`to_char(date_trunc('month', l.receipt_date), 'YYYY-MM')`
        : gran === 'week'
          ? sql`substr(to_char(l.receipt_date, 'IYYY'), 3, 2) || lpad(to_char(l.receipt_date, 'IW'), 2, '0')`
          : sql`to_char(date_trunc('day', l.receipt_date), 'YYYY-MM-DD')`;

    const groupKeyExpr =
      group === 'supplier'
        ? // 供应商名可能为空，回落到编码，避免多个不同供应商被合并成同一条「未命名供应商」线
          sql`COALESCE(NULLIF(trim(s.supplier_name), ''), NULLIF(trim(s.supplier_code), ''), '未知供应商')`
        : group === 'materialType'
          ? sql`COALESCE(NULLIF(trim(m.material_type), ''), '未分类')`
          : sql`'整体'`;

    // 合格数：pass 且非驳回
    const passExpr = sql`COUNT(*) FILTER (WHERE l.inspection_result = 'pass' AND l.status <> 'rejected')::int`;

    const whereParts: SQL[] = [
      sql`l.receipt_date >= ${startDate}::date`,
      sql`l.receipt_date <= ${endDate}::date`,
      sql`l.inspection_result IN ('pass','fail')`,
    ];
    if (dim && group === 'supplier') {
      whereParts.push(
        sql`(COALESCE(s.supplier_name, '') ILIKE ${'%' + dim + '%'} OR COALESCE(s.supplier_code, '') ILIKE ${'%' + dim + '%'})`,
      );
    }
    if (dim && group === 'materialType') {
      // 选中「其他」时，库里各种非标准写法也要算进来
      const vals = materialTypeAliasValues(dim);
      whereParts.push(
        sql`lower(btrim(COALESCE(m.material_type, ''))) IN (${sql.join(
          vals.map((v) => sql`${v}`),
          sql`, `,
        )})`,
      );
    }
    if (materialCode) {
      whereParts.push(sql`COALESCE(m.material_code, '') ILIKE ${'%' + materialCode + '%'}`);
    }
    const whereSql: SQL = sql.join(whereParts, sql` AND `);

    const fromSql = sql`
      FROM iqc_lot l
      LEFT JOIN material m ON l.material_id = m.id
      LEFT JOIN supplier s ON l.supplier_id = s.id
      WHERE ${whereSql}
    `;

    // 1) 趋势
    const trendRes = await this.db.execute(sql`
      SELECT
        ${dateExpr} AS date,
        COUNT(*)::int AS "totalLots",
        ${passExpr} AS "passedLots",
        ${groupKeyExpr} AS "groupKey"
      ${fromSql}
      GROUP BY 1, 4
      ORDER BY 1 ASC
    `);
    const trendRows = (trendRes as unknown) as Array<{
      date: string | Date;
      totalLots: number | string;
      passedLots: number | string;
      groupKey: string | null;
    }>;

    const trendRaw: IqcTrendPoint[] = trendRows.map((row) => {
      const totalLots = Number(row.totalLots ?? 0);
      const passedLots = Number(row.passedLots ?? 0);
      // 按物料类型分组时，组名也走归一：脏值并进「其他」，避免出现第二条叫 other 的线
      let groupKey = row.groupKey ?? undefined;
      if (group === 'materialType') {
        const normalized = normalizeMaterialType(groupKey);
        groupKey = normalized && isStandardMaterialType(normalized) ? normalized : '其他';
      }
      return {
        date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date ?? ''),
        totalLots,
        passedLots,
        passRate: totalLots > 0 ? Math.round((passedLots / totalLots) * 1000) / 10 : 0,
        groupKey,
      };
    });

    // 归并后同一「日期 + 物料类型」可能出现多行，需要把批次加回去
    let trend: IqcTrendPoint[] = trendRaw;
    if (group === 'materialType') {
      const merged = new Map<string, IqcTrendPoint>();
      for (const p of trendRaw) {
        const key = `${p.date}|${p.groupKey ?? ''}`;
        const cur = merged.get(key);
        if (cur) {
          cur.totalLots += p.totalLots;
          cur.passedLots += p.passedLots;
          cur.passRate = cur.totalLots > 0 ? Math.round((cur.passedLots / cur.totalLots) * 1000) / 10 : 0;
        } else {
          merged.set(key, { ...p });
        }
      }
      trend = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
    }

    // 2) 汇总（由趋势累加，保证与曲线一致）
    const totalLots = trend.reduce((s, p) => s + p.totalLots, 0);
    const passedLots = trend.reduce((s, p) => s + p.passedLots, 0);
    const targetPassRate = await this.getParamNumber('iqc_target_pass_rate', 95);

    // 3) 物料 / 供应商 TOP10（与趋势同口径）
    const rankSql = (keyExpr: SQL, nameExpr: SQL) => sql`
      SELECT
        COALESCE(${keyExpr}, '-') AS key,
        COALESCE(${nameExpr}, '-') AS name,
        COUNT(*)::int AS "totalLots",
        ${passExpr} AS "passedLots"
      ${fromSql}
      GROUP BY 1, 2
      ORDER BY 3 DESC, 1 ASC
      LIMIT 10
    `;

    const materialRankRes = await this.db.execute(rankSql(sql`m.material_code`, sql`m.material_name`));
    const supplierRankRes = await this.db.execute(
      // 供应商名缺失时用编码兜底显示
      rankSql(
        sql`s.supplier_code`,
        sql`COALESCE(NULLIF(trim(s.supplier_name), ''), s.supplier_code)`,
      ),
    );

    const toRank = (res: unknown): IqcRankItem[] =>
      ((res as unknown) as Array<{
        key: string | null;
        name: string | null;
        totalLots: number | string;
        passedLots: number | string;
      }>).map((row) => {
        const total = Number(row.totalLots ?? 0);
        const passed = Number(row.passedLots ?? 0);
        return {
          key: row.key ?? '-',
          name: row.name ?? '-',
          totalLots: total,
          passedLots: passed,
          passRate: total > 0 ? Math.round((passed / total) * 1000) / 10 : 0,
        };
      });

    // 4) 物料类型选项：固定用「定义好的 9 类」，不再取库里的 DISTINCT 值。
    //    2026-10-18 用户反馈：下拉框里冒出 other / electronic / 蜂窝板 之类没定义过的类型，
    //    根本原因是原来直接把库里的脏值当选项。现在统一以 constants/material-types 为准。
    const materialTypes = [...MATERIAL_TYPES];

    return {
      summary: {
        totalLots,
        passedLots,
        failedLots: totalLots - passedLots,
        passRate: totalLots > 0 ? Math.round((passedLots / totalLots) * 1000) / 10 : 0,
        targetPassRate,
      },
      trend,
      topMaterials: toRank(materialRankRes),
      topSuppliers: toRank(supplierRankRes),
      materialTypes,
    };
  }

  /** 日期兜底：默认最近 30 天（闭区间），与 statistics 卡片同口径 */
  private normalizeRange(startDate?: string, endDate?: string): { start: string; end: string } {
    return {
      start: startDate || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
      end: endDate || new Date().toISOString().slice(0, 10),
    };
  }

  /**
   * 「不合格批次」统一口径（2026-10-18 用户拍板：一律按合并后的 IQC 检验批数）。
   *
   * 与 getIqcStats 的 summary 完全一致，保证「统计卡不合格批数」=「两个饼图合计」：
   *   范围：inspection_result IN ('pass','fail')  —— 已出检验结论的批次
   *   不合格：inspection_result='fail'
   *          或 (inspection_result='pass' AND status='rejected')  —— 被驳回仍计入不合格
   *
   * 历史问题：旧实现用 `l.inspection_result='fail' OR r.final_result='fail'`，
   * 会把「报告已判 fail、但批次结果还没回写」的脏数据算进来（实测多算 2 个批次），
   * 且一个 lot 有多份报告时 COUNT(*) 会重复计数，故彻底改为以批次结果为准。
   */

  // ========== 4. 不良类型分布（按批数） ==========

  /**
   * 不合格按「不良类型」分布 —— 单位是**批数**，取值来自**检验报告**。
   *
   * 口径（2026-10-19 用户拍板）：取 `iqc_lot.defect_type`，即检验员在报告底部
   * 「不良类型（不合格必填）」下拉里选的那一项（包装/外观/尺寸/功能/安规/可靠性/环保/无检验资料）。
   *
   * 旧实现按 `iqc_inspection_record.defect_description` 出图，等于把「逐项不良描述」
   * 当成了类型：同一批次登记几条不良就进几个扇区，扇区相加会大于不合格批数，
   * 而且描述的写法因人而异（「毛刺」「披锋」「有毛刺」会被拆成三类）。
   *
   * 现在一个批次只对应一个类型（报告判定时必填），因此：
   *   各扇区之和 = 不合格批数 = 上方统计卡 / 物料类型饼图合计，可逐块对账。
   * 历史批次该字段为空（或早期写成英文键）时归一到八项中文口径，仍无法识别的落「未分类」。
   *
   * 范围仍严格限定在已出检验结论的不合格批次（含被驳回），与统计卡同源。
   */
  async getIqcDefectByType(startDate?: string, endDate?: string): Promise<IqcDefectTypeItem[]> {
    const { start, end } = this.normalizeRange(startDate, endDate);

    const result = await this.db.execute(sql`
      SELECT
        ${this.defectTypeExpr()} AS type,
        COUNT(*)::int AS count
      FROM iqc_lot l
      WHERE l.receipt_date >= ${start}::date
        AND l.receipt_date <= ${end}::date
        AND l.inspection_result IN ('pass','fail')
        AND (l.inspection_result = 'fail' OR l.status = 'rejected')
      GROUP BY 1
      ORDER BY count DESC, type ASC
    `);

    const rows = (result as unknown) as Array<{ type: string | null; count: number | string }>;
    return rows.map((row) => ({
      type: row.type || '未分类',
      count: Number(row.count ?? 0),
    }));
  }

  /**
   * 把 `iqc_lot.defect_type` 归一成八项中文口径的 SQL 表达式。
   *
   * 别名固定为 `l`（两处统计都从 `iqc_lot l` 出发），历史英文键按
   * IQC_DEFECT_TYPE_LEGACY 映射，空值 → 「未分类」，未知值原样保留（便于暴露脏数据）。
   */
  private defectTypeExpr(): SQL<unknown> {
    const legacyWhen = Object.entries(IQC_DEFECT_TYPE_LEGACY)
      .map(([code, label]) => `WHEN trim(l.defect_type) = '${code}' THEN '${label}'`)
      .join(' ');
    return sql.raw(
      `CASE
        WHEN NULLIF(trim(l.defect_type), '') IS NULL THEN '未分类'
        ${legacyWhen}
        ELSE trim(l.defect_type)
      END`,
    );
  }

  // ========== 5. 不良按物料类型分布（按批数） ==========

  async getIqcDefectByMaterialType(startDate?: string, endDate?: string): Promise<IqcDefectMaterialTypeItem[]> {
    const { start, end } = this.normalizeRange(startDate, endDate);

    const result = await this.db.execute(sql`
      SELECT
        COALESCE(NULLIF(trim(m.material_type), ''), '未分类') AS "materialType",
        COUNT(DISTINCT l.id)::int AS count
      FROM iqc_lot l
      LEFT JOIN material m ON l.material_id = m.id
      WHERE l.receipt_date >= ${start}::date
        AND l.receipt_date <= ${end}::date
        AND l.inspection_result IN ('pass','fail')
        AND (l.inspection_result = 'fail' OR l.status = 'rejected')
      GROUP BY 1
      ORDER BY count DESC, 1 ASC
    `);

    const rows = (result as unknown) as Array<{ materialType: string; count: number | string }>;
    // 非标准写法（other / electronic / 蜂窝板 …）统一并进「其他」，保证扇区名与下拉框一致
    const merged = new Map<string, number>();
    for (const row of rows) {
      const normalized = normalizeMaterialType(row.materialType);
      const key = normalized && isStandardMaterialType(normalized) ? normalized : '其他';
      merged.set(key, (merged.get(key) ?? 0) + Number(row.count ?? 0));
    }
    return [...merged.entries()]
      .map(([materialType, count2]) => ({ materialType, count: count2 }))
      .sort((a, b) => b.count - a.count || a.materialType.localeCompare(b.materialType));
  }

  // ========== 5b. 不合格明细下钻（饼图点击后的台账） ==========

  /**
   * 饼图下钻明细：一行 = 一个批次，行数恰等于饼图扇区数值（COUNT DISTINCT lot）。
   *
   * dimension='type'：该不良类型「涉及」的批次，同时聚合该类型下的检验项数与不良数量；
   * dimension='materialType'：该物料类型下的不合格批次。
   * 口径与对应饼图严格一致，避免「点进去数字对不上」。
   */
  async getIqcDefectDetail(opts: {
    startDate?: string;
    endDate?: string;
    dimension?: 'type' | 'materialType';
    value?: string;
    page?: number;
    pageSize?: number;
  }): Promise<IqcDefectDetailResult> {
    const { start, end } = this.normalizeRange(opts.startDate, opts.endDate);
    const dimension: 'type' | 'materialType' = opts.dimension === 'materialType' ? 'materialType' : 'type';
    const value = (opts.value || '').trim();
    const page = Math.max(1, Number(opts.page) || 1);
    const pageSize = Math.min(1000, Math.max(1, Number(opts.pageSize) || 20));
    const offset = (page - 1) * pageSize;

    const baseCols = sql`
      l.id AS "lotId",
      l.lot_no AS "lotNo",
      l.receipt_date AS "receiptDate",
      l.batch_no AS "batchNo",
      m.material_code AS "materialCode",
      m.material_name AS "materialName",
      COALESCE(NULLIF(trim(m.material_type), ''), '未分类') AS "materialType",
      s.supplier_code AS "supplierCode",
      s.supplier_name AS "supplierName",
      l.total_qty AS "totalQty",
      l.unit AS "unit",
      l.inspection_result AS "inspectionResult",
      l.status AS "status",
      rep.id AS "reportId",
      rep.report_no AS "reportNo"
    `;

    // 一个批次可能有多份报告（复检），取最新一份，避免明细行被放大
    const reportJoin = sql`
      LEFT JOIN LATERAL (
        SELECT r2.id, r2.report_no
        FROM iqc_report r2
        WHERE r2.lot_id = l.id
        ORDER BY r2.inspection_time DESC NULLS LAST, r2.id
        LIMIT 1
      ) rep ON true
    `;

    let itemsSql: SQL<unknown>;
    let totalSql: SQL<unknown>;

    if (dimension === 'type') {
      // 按检验报告的不良类型筛选批次（与饼图同一表达式，保证点进去的批次数对得上）。
      // 检验记录只用于补充「不良项数 / 不良数量 / 不良描述」参考列，不再参与分类。
      const cte = sql`
        eligible AS (
          SELECT l.id AS lot_id, ${this.defectTypeExpr()} AS type
          FROM iqc_lot l
          WHERE l.receipt_date >= ${start}::date
            AND l.receipt_date <= ${end}::date
            AND l.inspection_result IN ('pass','fail')
            AND (l.inspection_result = 'fail' OR l.status = 'rejected')
        ),
        picked AS (SELECT lot_id FROM eligible WHERE type = ${value}),
        agg AS (
          SELECT
            r.lot_id,
            COUNT(*)::int AS item_count,
            SUM(COALESCE(r.defect_qty, 0)) AS qty_total,
            array_agg(DISTINCT NULLIF(trim(r.item_name), ''))
              FILTER (WHERE NULLIF(trim(r.item_name), '') IS NOT NULL) AS items
          FROM picked p
          INNER JOIN iqc_inspection_record r ON r.lot_id = p.lot_id
          WHERE r.is_pass = false
             OR (r.defect_description IS NOT NULL AND trim(r.defect_description) <> '')
          GROUP BY r.lot_id
        )
      `;
      const fromSql = sql`
        FROM picked p
        JOIN iqc_lot l ON l.id = p.lot_id
        LEFT JOIN material m ON l.material_id = m.id
        LEFT JOIN supplier s ON l.supplier_id = s.id
        ${reportJoin}
        LEFT JOIN agg a ON a.lot_id = l.id
      `;
      const extraCols = sql`
        ${value}::text AS "mainDefectType",
        a.item_count AS "defectItemCount",
        a.qty_total AS "defectQtyTotal",
        a.items AS "defectDescriptions"
      `;

      itemsSql = sql`
        WITH ${cte}
        SELECT ${baseCols}, ${extraCols}
        ${fromSql}
        ORDER BY l.receipt_date DESC, l.lot_no DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      totalSql = sql`
        WITH ${cte}
        SELECT COUNT(DISTINCT p.lot_id)::int AS c
        ${fromSql}
      `;
    } else {
      const cte = sql`
        eligible AS (
          SELECT l.id
          FROM iqc_lot l
          WHERE l.receipt_date >= ${start}::date
            AND l.receipt_date <= ${end}::date
            AND l.inspection_result IN ('pass','fail')
            AND (l.inspection_result = 'fail' OR l.status = 'rejected')
        )
      `;
      const detailTypeVals = materialTypeAliasValues(value);
      const fromSql = sql`
        FROM eligible e
        JOIN iqc_lot l ON l.id = e.id
        LEFT JOIN material m ON l.material_id = m.id
        LEFT JOIN supplier s ON l.supplier_id = s.id
        ${reportJoin}
        WHERE lower(btrim(COALESCE(m.material_type, ''))) IN (${sql.join(
          detailTypeVals.map((v) => sql`${v}`),
          sql`, `,
        )})
      `;
      const extraCols = sql`
        NULL::text AS "mainDefectType",
        NULL::int AS "defectItemCount",
        NULL::numeric AS "defectQtyTotal",
        NULL::text[] AS "defectDescriptions"
      `;

      itemsSql = sql`
        WITH ${cte}
        SELECT ${baseCols}, ${extraCols}
        ${fromSql}
        ORDER BY l.receipt_date DESC, l.lot_no DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      totalSql = sql`
        WITH ${cte}
        SELECT COUNT(*)::int AS c
        ${fromSql}
      `;
    }

    const itemsRes = await this.db.execute(itemsSql);
    const totalRes = await this.db.execute(totalSql);

    const rows = (itemsRes as unknown) as Array<Record<string, any>>;
    const total = Number(((totalRes as unknown) as Array<{ c: number | string }>)[0]?.c ?? 0);

    const items: IqcDefectDetailItem[] = rows.map((row) => ({
      lotId: row.lotId,
      lotNo: row.lotNo ?? '-',
      receiptDate: row.receiptDate instanceof Date ? row.receiptDate.toISOString().slice(0, 10) : row.receiptDate,
      batchNo: row.batchNo,
      materialCode: row.materialCode,
      materialName: row.materialName,
      materialType: row.materialType,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      totalQty: row.totalQty != null ? String(row.totalQty) : null,
      unit: row.unit,
      inspectionResult: row.inspectionResult,
      status: row.status,
      reportId: row.reportId,
      reportNo: row.reportNo,
      mainDefectType: row.mainDefectType,
      defectItemCount: row.defectItemCount != null ? Number(row.defectItemCount) : undefined,
      defectQtyTotal: row.defectQtyTotal != null ? Number(row.defectQtyTotal) : undefined,
      defectDescriptions: Array.isArray(row.defectDescriptions) ? row.defectDescriptions.filter(Boolean) : [],
    }));

    return { items, total, page, pageSize, dimension, value, startDate: start, endDate: end };
  }

  // ========== 6. IQC 待检超期 ==========

  async getIqcOverdue(): Promise<IqcOverdueStats> {
    const [warningHours, urgentHours] = await Promise.all([
      this.getParamNumber('iqc_pending_warning_hours', 24),
      this.getParamNumber('iqc_pending_urgent_hours', 48),
    ]);

    const rows = await this.db
      .select({
        warningCount: sql<number>`COUNT(*) FILTER (
          WHERE ${iqcLot.createdAt} < NOW() - (${warningHours} || ' hours')::interval
            AND ${iqcLot.createdAt} >= NOW() - (${urgentHours} || ' hours')::interval
        )`,
        overdueCount: sql<number>`COUNT(*) FILTER (
          WHERE ${iqcLot.createdAt} < NOW() - (${urgentHours} || ' hours')::interval
        )`,
      })
      .from(iqcLot)
      .where(eq(iqcLot.status, 'pending'));

    return {
      warningCount: Number(rows[0]?.warningCount ?? 0),
      overdueCount: Number(rows[0]?.overdueCount ?? 0),
    };
  }

  // ========== 7. 待检状态 ==========

  async getPendingStats(): Promise<PendingStats> {
    const rows = await this.db
      .select({
        pendingCount: count(),
        over24h: sql<number>`COUNT(*) FILTER (WHERE ${iqcLot.createdAt} < NOW() - INTERVAL '24 hours')`,
      })
      .from(iqcLot)
      .where(eq(iqcLot.status, 'pending'));

    const pendingCount = Number(rows[0]?.pendingCount ?? 0);
    const pendingOver24hCount = Number(rows[0]?.over24h ?? 0);

    return {
      pendingCount,
      pendingOver24hCount,
      pendingCleared: pendingCount === 0,
      over24hCleared: pendingOver24hCount === 0,
    };
  }

  // ========== 8. 超补汇总 ==========

  async getSupplementSummary(): Promise<SupplementSummary> {
    const [
      woResult,
      pickingResult,
      topMaterialsResult,
      recentResult,
    ] = await Promise.all([
      // 超补工单数量
      this.db
        .select({ count: count() })
        .from(workOrder)
        .where(eq(workOrder.isSupplement, true)),
      // 超补领料单数与超补数量
      this.db
        .select({
          count: count(),
          totalQty: sql<string>`COALESCE(SUM(${pickingOrder.totalQty}), '0')`,
        })
        .from(pickingOrder)
        .where(eq(pickingOrder.isSupplement, true)),
      // 超补物料 TOP5
      this.db
        .select({
          materialCode: materialRequirementItem.materialCode,
          materialName: materialRequirementItem.materialName,
          supplementQty: sql<string>`COALESCE(SUM(${materialRequirementItem.supplementQty}), '0')`,
          baseQty: sql<string>`COALESCE(SUM(${materialRequirementItem.baseQty}), '0')`,
        })
        .from(materialRequirementItem)
        .where(sql`${materialRequirementItem.supplementQty} > 0`)
        .groupBy(materialRequirementItem.materialCode, materialRequirementItem.materialName)
        .orderBy(desc(sql`SUM(${materialRequirementItem.supplementQty})`))
        .limit(5),
      // 近期超补领料记录（最近10条）
      this.db.execute(sql`
        SELECT
          wo.work_order_no AS "workOrderNo",
          po.picking_no AS "pickingNo",
          mri.material_code AS "materialCode",
          mri.material_name AS "materialName",
          COALESCE(mri.supplement_qty, 0)::float AS "supplementQty",
          po._created_at AS "createdAt"
        FROM picking_order po
        LEFT JOIN work_order wo ON po.work_order_id = wo.id
        LEFT JOIN material_requirement_item mri ON po.req_id = mri.req_id
        WHERE po.is_supplement = true
        ORDER BY po._created_at DESC
        LIMIT 10
      `),
    ]);

    const topMaterials = topMaterialsResult.map((row) => {
      const supplementQty = Number(row.supplementQty ?? 0);
      const baseQty = Number(row.baseQty ?? 0);
      const supplementRatio = baseQty > 0
        ? Math.round((supplementQty / baseQty) * 1000) / 10
        : 0;
      return {
        materialCode: row.materialCode,
        materialName: row.materialName,
        supplementQty,
        supplementRatio,
      };
    });

    const recentRows = (recentResult as unknown) as Array<{
      workOrderNo: string | null;
      pickingNo: string;
      materialCode: string | null;
      materialName: string | null;
      supplementQty: number | string;
      createdAt: Date | string;
    }>;
    const recentRecords = recentRows.map((row) => ({
      workOrderNo: row.workOrderNo ?? '',
      pickingNo: row.pickingNo,
      materialCode: row.materialCode ?? '',
      materialName: row.materialName ?? '',
      supplementQty: Number(row.supplementQty ?? 0),
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ''),
    }));

    return {
      supplementWorkOrderCount: Number(woResult[0]?.count ?? 0),
      supplementPickingCount: Number(pickingResult[0]?.count ?? 0),
      supplementTotalQty: Number(pickingResult[0]?.totalQty ?? 0),
      topMaterials,
      recentRecords,
    };
  }

  // ========== 9. 管理员验证 & 目标合格率配置 ==========

  /** 验证管理员账号密码 */
  async verifyAdmin(account: string, password: string): Promise<{ success: boolean; name?: string }> {
    if (!account || !password) {
      throw new BadRequestException('账号和密码不能为空');
    }
    const rows = await this.db
      .select({ account: sysAccount.account, passwordHash: sysAccount.passwordHash, roleCode: sysAccount.roleCode, name: sysAccount.name })
      .from(sysAccount)
      .where(eq(sysAccount.account, account))
      .limit(1);

    if (rows.length === 0) {
      throw new BadRequestException('账号或密码错误');
    }
    const row = rows[0];

    // 验证密码（与登录相同的pbkdf2方式）
    try {
      const parts = (row.passwordHash || '').split(':');
      if (parts.length !== 5) throw new Error('invalid hash');
      const iterations = parseInt(parts[2], 10);
      const salt = parts[3];
      const expectedHash = parts[4];
      const actualHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha256').toString('hex');
      if (actualHash !== expectedHash) {
        throw new BadRequestException('账号或密码错误');
      }
    } catch {
      throw new BadRequestException('账号或密码错误');
    }

    // 验证角色必须是admin
    if (row.roleCode !== 'admin') {
      throw new BadRequestException('该账号不是系统管理员，无权修改目标');
    }

    return { success: true, name: row.name };
  }

  /** 获取目标合格率配置（总目标 + 各物料类型目标） */
  async getTargetConfig(): Promise<{ overall: number; byType: Record<string, number | null> }> {
    // 先读新的JSON配置
    const rows = await this.db
      .select({ paramValue: sysParam.paramValue })
      .from(sysParam)
      .where(eq(sysParam.paramKey, 'iqc_target_config'))
      .limit(1);

    if (rows.length > 0 && rows[0].paramValue) {
      try {
        const parsed = JSON.parse(rows[0].paramValue);
        return {
          overall: typeof parsed.overall === 'number' ? parsed.overall : 95,
          byType: parsed.byType || {},
        };
      } catch {
        // 解析失败，继续用旧配置
      }
    }

    // 兼容旧配置：只有总目标
    const overall = await this.getParamNumber('iqc_target_pass_rate', 95);
    return { overall, byType: {} };
  }

  /** 更新目标合格率配置（需先验证管理员） */
  async updateTargetConfig(
    account: string,
    password: string,
    config: { overall: number; byType: Record<string, number | null> },
  ): Promise<{ success: boolean }> {
    // 先验证管理员
    await this.verifyAdmin(account, password);

    // 校验数值
    if (config.overall < 0 || config.overall > 100) {
      throw new BadRequestException('总目标合格率必须在0-100之间');
    }
    for (const [key, val] of Object.entries(config.byType)) {
      if (val != null && (val < 0 || val > 100)) {
        throw new BadRequestException(`物料类型[${key}]的目标合格率必须在0-100之间`);
      }
    }

    const jsonStr = JSON.stringify(config);

    // 保存新配置
    await this.db
      .insert(sysParam)
      .values({ paramKey: 'iqc_target_config', paramValue: jsonStr })
      .onConflictDoUpdate({
        target: sysParam.paramKey,
        set: { paramValue: jsonStr, updatedAt: new Date() },
      });

    // 同时更新旧的总目标key，兼容其他地方读取
    await this.db
      .insert(sysParam)
      .values({ paramKey: 'iqc_target_pass_rate', paramValue: String(config.overall) })
      .onConflictDoUpdate({
        target: sysParam.paramKey,
        set: { paramValue: String(config.overall), updatedAt: new Date() },
      });

    return { success: true };
  }
}
