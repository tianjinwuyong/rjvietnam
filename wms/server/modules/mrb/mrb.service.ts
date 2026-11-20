import { enqueueOaEvent } from '../../common/utils/oa-event';
﻿import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, or, like, gte, lt, desc, asc, sql, count, inArray, notInArray, ne } from 'drizzle-orm';
import type {
  MrbReview,
  MrbReviewer,
  MrbDisposition,
  MrbDispositionInput,
  MrbDispositionType,
  MrbPendingLot,
  MrbLotGroup,
  MrbOtherType,
  MrbSlaLevel,
  PaginatedResponse,
} from '@shared/api.interface';

import {
  mrbReview,
  mrbReviewer,
  mrbDisposition,
  mrbDispositionLabel,
  iqcLot,
  iqcLotReceipt,
  receiptOrder,
  material,
  supplier,
  inventory,
  inventoryTransaction,
  supplierReturnOrder,
  supplierReturnItem,
  reworkOrder,
  defectiveMoveTask,
  sysParam,
  warehouse,
  warehouseLocation,
  sysAccount,
  sysRole,
} from '@server/database/schema';
import { MRB_REVIEW_RESULTS } from '../../common/constants/business-enums';
import { SupplierDebtService } from '../supplier-debt/supplier-debt.service';
import { NoticeService } from '../notice/notice.service';
import {
  nextDefectiveMoveNo,
  nextMrbNo,
  normalizeInspectionNo,
} from '../../common/utils/doc-no.util';
import {
  MRB_STATUSES,
  MRB_DONE_STATUSES,
  MRB_INFLIGHT_BLOCKING_STATUSES,
  MRB_STATUS_LABELS,
  MRB_TRANSITIONS,
  MRB_CANCELLABLE_STATUSES,
  MRB_OTHER_TYPES,
  MRB_OTHER_TYPE_LABELS,
  MRB_RESERVE_LOCATION_MARK,
  MRB_OTHER_LIKE_PATTERN,
  buildOtherLockReason,
  buildReturnLockReason,
  buildScrapLockReason,
  buildReserveLocationCode,
  computeMrbSla,
  reviewableDefectiveCond,
  lockedGoodCond,
  disposalCandidateCond,
  mrbStuckHoursSql,
  mrbSlaLevelSql,
  mrbActiveCond,
  buildCurrentTodo,
  type MrbStatus,
} from './mrb.status';

/** 可参与库存执行的处置方式（「其他」纳入，具体去向由 other_type 决定） */
const EXECUTABLE_DISPOSITIONS: MrbDispositionType[] = [
  'special_admit',
  'return',
  'rework',
  'scrap',
  'other',
];

/** 终审后仍需下游动作才算完成的处置方式（退货 / 返工 / 报废） */
const PENDING_DISPOSITIONS: MrbDispositionType[] = ['return', 'rework', 'scrap'];

/**
 * PDA / 旧前端历史上用 accept / reject / deviation 提评审意见，
 * 服务端只认四项处置枚举 → 100% 400（设计文档 §0 记录的存量 bug）。
 * 这里在入口做一次映射，落库一律是四项枚举。
 */
const LEGACY_REVIEW_RESULT_MAP: Record<string, MrbDispositionType> = {
  accept: 'special_admit',
  reject: 'return',
  deviation: 'rework',
};

/** UUID 格式，用于发起 MRB 时的入参预校验 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 慢件 / 急件的默认阈值：与 mrb.status.ts 的阈值表一致，这里仅用于文档提示 */
const MIN_CANCEL_REASON_LEN = 5;
const MIN_REMARK_LEN = 5;
const SEPARATION_REMARK_MIN = 2;
const SEPARATION_REMARK_MAX = 200;

export interface MrbReviewerInput {
  reviewerId: string;
  reviewerName?: string;
  reviewerRole?: string;
}

/** 二维码分摊：某个收货箱分给某个处置的数量（MRB v3） */
export interface MrbPlanLabelInput {
  receiptId: string;
  quantity: number;
}

/** 方案中的一条处置（MRB v3）：数量由 labels 汇总，不单独传 */
export interface MrbPlanDispositionInput {
  dispositionType: MrbDispositionType;
  otherType?: string;
  refNo?: string;
  holdUntil?: string;
  remark?: string;
  labels: MrbPlanLabelInput[];
}

/** 批次收货箱视图（二维码分摊弹窗数据源） */
export interface MrbLotLabelRow {
  receiptId: string;
  receiptNo: string;
  qrContent: string | null;
  quantity: number;
  allocated: number;
  remaining: number;
  productionDate: string | null;
  batchNo: string | null;
  serialNo: string | null;
}

/** 操作人上下文（一律来自登录态，禁止从请求体取） */
export interface MrbOperator {
  userId: string;
  roleCode: string;
  name?: string;
}

/** 单条库存分配（拆量后每条分配独占一行库存） */
interface InventoryAlloc {
  row: any;
  qtyScaled: number;
  src: 'defective' | 'locked_good';
  targetRow?: any;
}

/** 一条处置明细的计划执行单元 */
interface PlannedLine {
  type: MrbDispositionType;
  /** 本行数量（×10000 缩放后的整数，避免浮点尾差） */
  qtyScaled: number;
  /** 仅 type='other' 时有效 */
  otherType?: MrbOtherType;
  /** customer_return / sample 的关联单号 */
  refNo?: string;
  /** hold 的复核日期 YYYY-MM-DD */
  holdUntil?: string;
  remark?: string;
  allocs: InventoryAlloc[];
  dispositionId?: string;
}

@Injectable()
export class MrbService {
  private readonly logger = new Logger(MrbService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly supplierDebtService: SupplierDebtService,
    private readonly noticeService: NoticeService,
  ) {}

  // =========================================================================
  // 评审员候选（「选定评审人员」下拉的候选池）
  // =========================================================================

  /**
   * 可被指派为评审员的启用账号。
   *
   * 为什么不复用 `GET /api/system/account/list`：
   * 那是「账号管理」页的接口，挂着 `@NeedRoles('admin')`。SQE / 质量主管打开
   * 「选定评审人员」时会被 403，前端 catch 静默降级后下拉里一个人名都没有
   * （只有管理员账号能看到名单，历史缺陷）。这里只暴露选人必需的最小字段，
   * 不返回 last_login_at / is_first_login / password_hash 等账号管理信息。
   */
  async getReviewerCandidates(): Promise<
    Array<{ id: string; account: string; name: string; roleCode: string; roleName: string | null }>
  > {
    const rows = await this.db
      .select({
        id: sysAccount.id,
        account: sysAccount.account,
        name: sysAccount.name,
        roleCode: sysAccount.roleCode,
        roleName: sysRole.roleName,
      })
      .from(sysAccount)
      .leftJoin(sysRole, eq(sysRole.roleCode, sysAccount.roleCode))
      .where(eq(sysAccount.status, 'active'))
      .orderBy(asc(sysAccount.name))
      .limit(500);

    return rows.map((r) => ({
      id: r.id,
      account: r.account,
      name: r.name,
      roleCode: r.roleCode,
      roleName: r.roleName ?? null,
    }));
  }

  // =========================================================================
  // 一、内核：状态迁移（唯一入口）
  // =========================================================================

  /**
   * 状态迁移的唯一入口（设计文档 §7 共享知识 2）。
   *
   * 语义：
   *  - `UPDATE ... WHERE id=? AND status=from` 的 CAS，并发下只有一次成功；
   *  - 同一条 UPDATE 里刷新 `status_since`（SLA 唯一时钟基准）；
   *  - `_updated_at` 由数据库触发器维护，**绝不可**当 SLA 基准。
   *
   * @param txOrDb  事务句柄或 db（下游模块在事务内调用时必须传 tx）
   * @param mrbId   MRB 单 id
   * @param from    期望的当前状态；null 表示不校验状态（仅迁移脚本/初始化用）
   * @param to      目标状态
   * @param extra   同批写入的其它字段（如 cancel_reason / completeness_*）
   */
  private async transition(
    txOrDb: any,
    mrbId: string,
    from: MrbStatus | null,
    to: MrbStatus,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    if (!MRB_STATUSES.includes(to)) {
      throw new BadRequestException(`未知的 MRB 状态：${to}`);
    }
    if (from && from !== to) {
      const allowed = MRB_TRANSITIONS[from] || [];
      if (!allowed.includes(to)) {
        throw new BadRequestException(
          `当前状态（${MRB_STATUS_LABELS[from]}）不可执行该操作`,
        );
      }
    }

    const executor = txOrDb ?? this.db;
    const rows = await executor
      .update(mrbReview)
      .set({ ...extra, status: to, statusSince: new Date() })
      .where(
        from
          ? and(eq(mrbReview.id, mrbId), eq(mrbReview.status, from))
          : eq(mrbReview.id, mrbId),
      )
      .returning({ id: mrbReview.id });

    if (rows.length === 0) {
      throw new ConflictException('该MRB已被处理，请刷新后重试');
    }
  }

  /** 读取单据最少字段（内部校验用） */
  private async loadMrb(mrbId: string): Promise<any> {
    const rows = await this.db
      .select()
      .from(mrbReview)
      .where(eq(mrbReview.id, mrbId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException('MRB评审单不存在');
    return rows[0];
  }

  /**
   * 归属校验第一道：是不是发起人本人（或管理员 / 质量经理）。
   * `@NeedRoles` 只卡角色，同角色用户之间必须靠这一层隔离。
   */
  private assertInitiator(
    mrb: any,
    operator: MrbOperator,
    opts: { allowQualityManager?: boolean } = {},
  ): void {
    const initiatorId = this.readUserProfileId(mrb?.sqeId);
    const allowedRoles = ['admin'];
    if (opts.allowQualityManager) allowedRoles.push('quality_manager');
    if (initiatorId && initiatorId === operator.userId) return;
    if (allowedRoles.includes(operator.roleCode)) return;
    throw new ForbiddenException('仅发起人可执行该操作');
  }

  /** 从 user_profile 复合值里取 user_id（postgres-js 返回的是 `{"(uuid)"}` 或字符串） */
  private readUserProfileId(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') {
      return value.replace(/^\(|\)$/g, '').replace(/^"|"$/g, '');
    }
    if (typeof value === 'object') {
      if (typeof value.user_id === 'string') return value.user_id;
      const raw = String(value);
      return raw.replace(/^\(|\)$/g, '').replace(/^"|"$/g, '');
    }
    return String(value);
  }

  // =========================================================================
  // 二、行映射
  // =========================================================================

  /** MRB 列表统一查询字段（列表 / 批次分组 / 详情共用） */
  private mrbRowSelection() {
    const completenessById = sql<string>`(${mrbReview.completenessBy}).user_id`.as(
      'completeness_by_id',
    );
    const cancelById = sql<string>`(${mrbReview.cancelBy}).user_id`.as('cancel_by_id');
    const qualityManagerId = sql<string>`(${mrbReview.qualityManagerId}).user_id`.as(
      'quality_manager_uid',
    );

    return {
      id: mrbReview.id,
      mrbNo: mrbReview.mrbNo,
      /** 来源检验单号：老单未回填时回落到批次上的检验单号 */
      inspectionNo: sql<string | null>`COALESCE(${mrbReview.sourceInspectionNo}, ${iqcLot.inspectionNo})`.as(
        'inspection_no',
      ),
      lotId: mrbReview.lotId,
      lotNo: iqcLot.lotNo,
      materialId: mrbReview.materialId,
      materialCode: material.materialCode,
      materialName: material.materialName,
      supplierId: mrbReview.supplierId,
      supplierCode: supplier.supplierCode,
      supplierName: supplier.supplierName,
      batchNo: mrbReview.batchNo,
      quantity: mrbReview.quantity,
      unit: mrbReview.unit,
      failReason: mrbReview.failReason,
      status: mrbReview.status,
      finalDecision: mrbReview.finalDecision,
      sqeId: mrbReview.sqeId,
      sqeName: sql<string>`(SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_review.sqe_id).user_id)`.as('sqe_name'),
      qualityManagerId: mrbReview.qualityManagerId,
      qualityManagerIdText: qualityManagerId,
      qualityManagerName: sql<string>`(SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_review.quality_manager_id).user_id)`.as('quality_manager_name'),
      finalApprovalTime: mrbReview.finalApprovalTime,
      finalRemark: mrbReview.finalRemark,
      remark: mrbReview.remark,
      createdAt: mrbReview.createdAt,
      // ---- v2.1 新增字段 ----
      statusSince: mrbReview.statusSince,
      isUrgent: mrbReview.isUrgent,
      urgentReason: mrbReview.urgentReason,
      completenessResult: mrbReview.completenessResult,
      completenessById,
      completenessByName: sql<string>`(SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_review.completeness_by).user_id)`.as('completeness_by_name'),
      completenessTime: mrbReview.completenessTime,
      completenessRemark: mrbReview.completenessRemark,
      separationRemark: mrbReview.separationRemark,
      cancelReason: mrbReview.cancelReason,
      cancelById,
      cancelByName: sql<string>`(SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_review.cancel_by).user_id)`.as('cancel_by_name'),
      cancelTime: mrbReview.cancelTime,
      // ---- v3.1：撤回 / 驳回留痕 ----
      withdrawReason: mrbReview.withdrawReason,
      withdrawById: sql<string>`(${mrbReview.withdrawBy}).user_id`.as('withdraw_by_id'),
      withdrawByName: sql<string>`(SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_review.withdraw_by).user_id)`.as('withdraw_by_name'),
      withdrawTime: mrbReview.withdrawTime,
      returnReason: mrbReview.returnReason,
      returnById: sql<string>`(${mrbReview.returnBy}).user_id`.as('return_by_id'),
      returnByName: sql<string>`(SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_review.return_by).user_id)`.as('return_by_name'),
      returnTime: mrbReview.returnTime,
      returnFrom: mrbReview.returnFrom,
      // ---- 巡检派生字段 ----
      stuckHours: mrbStuckHoursSql().as('stuck_hours'),
      slaLevel: mrbSlaLevelSql().as('sla_level'),
      pendingReviewerNames: sql<string>`(
        SELECT string_agg(COALESCE(sa.name, (r.reviewer_id).user_id), '、' ORDER BY r.sort_order)
        FROM mrb_reviewer r
        LEFT JOIN sys_account sa ON sa.id::text = (r.reviewer_id).user_id
        WHERE r.mrb_id = mrb_review.id AND r.review_result IS NULL
      )`.as('pending_reviewer_names'),
      pendingReviewerCount: sql<number>`(
        SELECT COUNT(*) FROM mrb_reviewer r
        WHERE r.mrb_id = mrb_review.id AND r.review_result IS NULL
      )`.as('pending_reviewer_count'),
      downstreamNos: sql<string>`(
        SELECT string_agg(t.no, '、') FROM (
          SELECT return_no AS no FROM supplier_return_order WHERE mrb_id = mrb_review.id
          UNION ALL
          SELECT rework_no AS no FROM rework_order WHERE mrb_id = mrb_review.id
        ) t
      )`.as('downstream_nos'),
    };
  }

  private mapMrbRow(row: any): MrbReview {
    const statusSince = row.statusSince
      ? row.statusSince instanceof Date
        ? row.statusSince.toISOString()
        : String(row.statusSince)
      : undefined;
    const isUrgent = !!row.isUrgent;

    // SLA 优先取 SQL 计算值（列表带筛选时以 SQL 为准），否则在 JS 里按同一张阈值表算
    const sla =
      row.stuckHours === null || row.stuckHours === undefined
        ? computeMrbSla(row.status, row.statusSince, isUrgent)
        : {
            stuckHours:
              row.stuckHours === null || row.stuckHours === undefined
                ? null
                : Math.round(Number(row.stuckHours) * 10) / 10,
            slaLevel: (row.slaLevel as MrbSlaLevel) || 'ok',
          };

    const completenessById = row.completenessById ?? undefined;
    const qualityManagerUid = row.qualityManagerIdText ?? undefined;
    const separationRemark = row.separationRemark ?? undefined;

    // 单人审批：预审人 == 终审人（或已填代审说明）
    const isSingleApprover =
      !!separationRemark ||
      (!!completenessById && !!qualityManagerUid && completenessById === qualityManagerUid);

    // 急件跳过预审（或 admin 人工 skip）
    const skippedApproval =
      row.completenessResult === 'skipped' ||
      (isUrgent && !row.completenessResult && !['draft', 'pending_review', 'reviewing', 'cancelled'].includes(row.status));

    const pendingReviewerNames = row.pendingReviewerNames
      ? String(row.pendingReviewerNames).split('、').filter((s) => !!s)
      : [];

    return {
      id: row.id,
      mrbNo: row.mrbNo,
      inspectionNo: row.inspectionNo ?? row.sourceInspectionNo ?? undefined,
      lotId: row.lotId,
      lotNo: row.lotNo,
      materialId: row.materialId,
      materialCode: row.materialCode,
      materialName: row.materialName,
      supplierId: row.supplierId,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      batchNo: row.batchNo ?? undefined,
      quantity: Number(row.quantity),
      unit: row.unit,
      failReason: row.failReason ?? undefined,
      status: row.status,
      finalDecision: row.finalDecision ?? undefined,
      sqeId: row.sqeId ?? undefined,
      sqeName: row.sqeName ?? undefined,
      qualityManagerId: row.qualityManagerId ?? undefined,
      qualityManagerName: row.qualityManagerName ?? undefined,
      finalApprovalTime: row.finalApprovalTime
        ? (row.finalApprovalTime instanceof Date ? row.finalApprovalTime.toISOString() : row.finalApprovalTime)
        : undefined,
      finalRemark: row.finalRemark ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt
        ? (row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt)
        : undefined,
      reviewers: row.reviewers ?? undefined,
      // ---- v2.1 ----
      statusSince,
      isUrgent,
      urgentReason: row.urgentReason ?? undefined,
      completeness:
        row.completenessResult || completenessById || row.completenessTime || row.completenessRemark
          ? {
              result: row.completenessResult ?? undefined,
              by: completenessById,
              byName: row.completenessByName ?? undefined,
              time: row.completenessTime
                ? (row.completenessTime instanceof Date
                    ? row.completenessTime.toISOString()
                    : String(row.completenessTime))
                : undefined,
              remark: row.completenessRemark ?? undefined,
            }
          : undefined,
      skippedApproval,
      isSingleApprover,
      separationRemark,
      cancel:
        row.cancelReason || row.cancelTime || row.cancelById
          ? {
              reason: row.cancelReason ?? undefined,
              by: row.cancelById ?? undefined,
              byName: row.cancelByName ?? undefined,
              time: row.cancelTime
                ? (row.cancelTime instanceof Date ? row.cancelTime.toISOString() : String(row.cancelTime))
                : undefined,
            }
          : undefined,
      withdraw:
        row.withdrawReason || row.withdrawTime || row.withdrawById
          ? {
              reason: row.withdrawReason ?? undefined,
              by: row.withdrawById ?? undefined,
              byName: row.withdrawByName ?? undefined,
              time: row.withdrawTime
                ? (row.withdrawTime instanceof Date ? row.withdrawTime.toISOString() : String(row.withdrawTime))
                : undefined,
            }
          : undefined,
      returnBack:
        row.returnReason || row.returnTime || row.returnById
          ? {
              reason: row.returnReason ?? undefined,
              by: row.returnById ?? undefined,
              byName: row.returnByName ?? undefined,
              time: row.returnTime
                ? (row.returnTime instanceof Date ? row.returnTime.toISOString() : String(row.returnTime))
                : undefined,
              from: row.returnFrom ?? undefined,
            }
          : undefined,
      stuckHours: sla.stuckHours,
      slaLevel: sla.slaLevel,
      currentTodo: buildCurrentTodo({
        status: row.status,
        sqeName: row.sqeName,
        pendingReviewerNames,
        downstreamNos: row.downstreamNos
          ? String(row.downstreamNos).split('、').filter((s) => !!s)
          : [],
      }),
    };
  }

  private mapReviewerRow(row: any): MrbReviewer {
    return {
      id: row.id,
      mrbId: row.mrbId,
      reviewerId: row.reviewerId,
      reviewerName: row.reviewerName ?? undefined,
      reviewerRole: row.reviewerRole ?? undefined,
      reviewOpinion: row.reviewOpinion ?? undefined,
      reviewResult: row.reviewResult ?? undefined,
      reviewTime: row.reviewTime
        ? (row.reviewTime instanceof Date ? row.reviewTime.toISOString() : row.reviewTime)
        : undefined,
      sortOrder: Number(row.sortOrder || 0),
    };
  }

  // =========================================================================
  // 三、待发起批次（可评审量三处同源之一）
  // =========================================================================

  /**
   * 待发起 MRB 的 IQC 批次清单
   * 条件：IQC 判定 fail，且不存在进行中的 MRB；并满足下列之一：
   *   a) 不良品仓仍有**未被「其他」处置占用**的库存 —— 已判定 fail 且完成过 MRB 的批次
   *      只要不良品仓还有货，即可「重新发起」；
   *   b) 首次发起且良品仓存在待隔离（locked）库存（尚未调拨到不良品仓）。
   */
  async getPendingLots(params: {
    page: number;
    pageSize: number;
    materialCode?: string;
    batchNo?: string;
    inspectionNo?: string;
  }): Promise<PaginatedResponse<MrbPendingLot>> {
    const { page, pageSize, materialCode, batchNo, inspectionNo } = params;

    // 不良品仓仍可评审的库存 —— 与 initiateMrb / finalApprove 共用 reviewableDefectiveCond
    const defectiveQtySql = sql<number>`COALESCE((
      SELECT SUM(inv.quantity) FROM inventory inv
      WHERE inv.material_id = ${iqcLot.materialId}
        AND inv.supplier_id = ${iqcLot.supplierId}
        AND inv.batch_no = regexp_replace(COALESCE(${iqcLot.batchNo}, ''), '-R[0-9]+$', '')
        AND ${reviewableDefectiveCond('inv')}
    ), 0)`;

    // 良品仓待隔离库存：IQC 判 fail 后尚未调拨到不良品仓的情形，仅首次发起时可用
    const lockedGoodQtySql = sql<number>`COALESCE((
      SELECT SUM(inv.quantity) FROM inventory inv
      WHERE inv.material_id = ${iqcLot.materialId}
        AND inv.supplier_id = ${iqcLot.supplierId}
        AND inv.batch_no = regexp_replace(COALESCE(${iqcLot.batchNo}, ''), '-R[0-9]+$', '')
        AND ${lockedGoodCond('inv')}
    ), 0)`;

    // 可评审库存 = 不良品仓未占用 + 良品仓待隔离
    const reviewableQtySql = sql<number>`((${defectiveQtySql}) + (${lockedGoodQtySql}))`;

    // 历史评审次数（「驳回 / 取消」不计入）
    const mrbCountSql = sql<number>`(
      SELECT COUNT(*) FROM mrb_review m
      WHERE m.lot_id = ${iqcLot.id}
        AND m.status NOT IN ('rejected', 'cancelled')
    )`;

    // 存在「还没分配数量」的进行中 MRB 时不允许重复发起。
    // `pending_execute` 不算阻塞：它已把数量迁出可评审池，剩余量可单独再发起。
    const activeMrbSql = sql`EXISTS (
      SELECT 1 FROM mrb_review m
      WHERE m.lot_id = ${iqcLot.id}
        AND m.status IN ('draft', 'pending_review', 'reviewing', 'pending_approval', 'pending_final')
    )`;

    const lastMrbNoSql = sql`(
      SELECT m.mrb_no FROM mrb_review m
      WHERE m.lot_id = ${iqcLot.id} AND m.status NOT IN ('rejected', 'cancelled')
      ORDER BY m._created_at DESC LIMIT 1
    )`;
    const lastDecisionSql = sql`(
      SELECT m.final_decision FROM mrb_review m
      WHERE m.lot_id = ${iqcLot.id} AND m.status NOT IN ('rejected', 'cancelled')
      ORDER BY m._created_at DESC LIMIT 1
    )`;
    const lastMrbAtSql = sql`(
      SELECT m.final_approval_time FROM mrb_review m
      WHERE m.lot_id = ${iqcLot.id} AND m.status NOT IN ('rejected', 'cancelled')
      ORDER BY m._created_at DESC LIMIT 1
    )`;

    const canInitiateSql = sql`NOT (${activeMrbSql}) AND (
      (${defectiveQtySql}) > 0
      OR ((${lockedGoodQtySql}) > 0 AND (${mrbCountSql}) = 0)
    )`;

    const conditions = [eq(iqcLot.inspectionResult, 'fail'), canInitiateSql];
    if (materialCode) conditions.push(like(material.materialCode, `%${materialCode}%`));
    if (batchNo) conditions.push(like(iqcLot.batchNo, `%${batchNo}%`));
    if (inspectionNo) conditions.push(like(iqcLot.inspectionNo, `%${inspectionNo}%`));

    const baseQuery = this.db
      .select({
        lotId: iqcLot.id,
        lotNo: iqcLot.lotNo,
        inspectionNo: iqcLot.inspectionNo,
        materialId: iqcLot.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        supplierId: iqcLot.supplierId,
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        batchNo: iqcLot.batchNo,
        quantity: iqcLot.totalQty,
        unit: iqcLot.unit,
        receiptDate: iqcLot.receiptDate,
        inspectionTime: iqcLot.inspectionTime,
        defectType: iqcLot.defectType,
        defectiveQty: defectiveQtySql.as('defective_qty'),
        reviewableQty: reviewableQtySql.as('reviewable_qty'),
        mrbCount: mrbCountSql.as('mrb_count'),
        lastMrbNo: lastMrbNoSql.as('last_mrb_no'),
        lastDecision: lastDecisionSql.as('last_decision'),
        lastMrbAt: lastMrbAtSql.as('last_mrb_at'),
      })
      .from(iqcLot)
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id));

    const countResult = await this.db
      .select({ count: count() })
      .from(iqcLot)
      .leftJoin(material, eq(iqcLot.materialId, material.id))
      .leftJoin(supplier, eq(iqcLot.supplierId, supplier.id))
      .where(and(...conditions));

    const total = Number(countResult[0]?.count || 0);

    const items = await baseQuery
      .where(and(...conditions))
      // 默认按检验时间升序：最老的先处理（PRD 8.1）
      .orderBy(sql`${iqcLot.inspectionTime} asc nulls last`, desc(iqcLot.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: items.map((row: any): MrbPendingLot => ({
        lotId: row.lotId,
        lotNo: row.lotNo,
        inspectionNo: row.inspectionNo ?? row.sourceInspectionNo ?? undefined,
        materialId: row.materialId,
        materialCode: row.materialCode ?? undefined,
        materialName: row.materialName ?? undefined,
        supplierId: row.supplierId ?? undefined,
        supplierCode: row.supplierCode ?? undefined,
        supplierName: row.supplierName ?? undefined,
        batchNo: row.batchNo ?? undefined,
        quantity: Number(row.quantity || 0),
        unit: row.unit,
        receiptDate: row.receiptDate ?? undefined,
        inspectionTime: row.inspectionTime
          ? (row.inspectionTime instanceof Date ? row.inspectionTime.toISOString() : row.inspectionTime)
          : undefined,
        defectType: row.defectType ?? undefined,
        defectiveQty: Number(row.defectiveQty || 0),
        /** 仓内剩余未处理量（= 未被「其他」处置占用的不良品量） */
        remainingDefectiveQty: Number(row.defectiveQty || 0),
        reviewableQty: Number(row.reviewableQty || 0),
        mrbCount: Number(row.mrbCount || 0),
        lastMrbNo: row.lastMrbNo ?? undefined,
        lastDecision: row.lastDecision ?? undefined,
        lastMrbAt: row.lastMrbAt
          ? (row.lastMrbAt instanceof Date ? row.lastMrbAt.toISOString() : row.lastMrbAt)
          : undefined,
        isReopen: Number(row.mrbCount || 0) > 0,
      })),
      total,
      page,
      pageSize,
    };
  }

  // =========================================================================
  // 四、列表 / 批次分组 / 巡检
  // =========================================================================

  async getMrbList(params: {
    page: number;
    pageSize: number;
    mrbNo?: string;
    materialCode?: string;
    batchNo?: string;
    status?: string;
    scope?: 'pending' | 'done';
    startDate?: string;
    endDate?: string;
    /** 只返回 warn / overdue（'1' 生效） */
    onlyTimeout?: string | boolean;
    /** 只返回急件（'1' 生效） */
    onlyUrgent?: string | boolean;
    /** 精确筛选某个 SLA 等级 */
    slaLevel?: MrbSlaLevel;
  }): Promise<PaginatedResponse<MrbReview>> {
    const {
      page,
      pageSize,
      mrbNo,
      materialCode,
      batchNo,
      status,
      scope,
      startDate,
      endDate,
      onlyTimeout,
      onlyUrgent,
      slaLevel,
    } = params;

    const conditions: any[] = [];
    if (mrbNo) {
      // 单号前缀即检验单号，业务方常直接拿 JY 号来搜，故一并匹配来源检验单
      const kw = `%${mrbNo.trim()}%`;
      conditions.push(
        or(
          like(mrbReview.mrbNo, kw),
          like(mrbReview.sourceInspectionNo, kw),
          like(iqcLot.inspectionNo, kw),
        ),
      );
    }
    if (materialCode) conditions.push(like(material.materialCode, `%${materialCode}%`));
    if (batchNo) conditions.push(like(iqcLot.batchNo, `%${batchNo}%`));
    if (status) conditions.push(eq(mrbReview.status, status));
    if (scope === 'done') conditions.push(inArray(mrbReview.status, [...MRB_DONE_STATUSES]));
    else if (scope === 'pending') conditions.push(notInArray(mrbReview.status, [...MRB_DONE_STATUSES]));
    if (startDate) conditions.push(gte(mrbReview.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lt(mrbReview.createdAt, new Date(endDate)));
    if (onlyUrgent === '1' || onlyUrgent === true) conditions.push(eq(mrbReview.isUrgent, true));
    if (slaLevel) conditions.push(sql`${mrbSlaLevelSql()} = ${slaLevel}`);
    if (onlyTimeout === '1' || onlyTimeout === true) {
      conditions.push(sql`${mrbSlaLevelSql()} <> 'ok'`);
    }

    const baseQuery = this.db
      .select(this.mrbRowSelection())
      .from(mrbReview)
      .leftJoin(iqcLot, eq(mrbReview.lotId, iqcLot.id))
      .leftJoin(material, eq(mrbReview.materialId, material.id))
      .leftJoin(supplier, eq(mrbReview.supplierId, supplier.id));

    const whereQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(mrbReview)
      .leftJoin(iqcLot, eq(mrbReview.lotId, iqcLot.id))
      .leftJoin(material, eq(mrbReview.materialId, material.id))
      .leftJoin(supplier, eq(mrbReview.supplierId, supplier.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    // 进行中视图排序：急件 > overdue > warn > 其余（status_since 升序，越早越靠前）
    const orderBy =
      scope === 'pending'
        ? [
            sql`${mrbReview.isUrgent} DESC`,
            sql`CASE ${mrbSlaLevelSql()} WHEN 'overdue' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END`,
            mrbReview.statusSince,
            desc(mrbReview.createdAt),
          ]
        : [desc(mrbReview.createdAt)];

    const items = await whereQuery
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: items.map((item: any) => this.mapMrbRow(item)),
      total,
      page,
      pageSize,
    };
  }

  /** 巡检汇总：{ warn, overdue, singleApprover } */
  async getOverdueSummary(): Promise<{ warn: number; overdue: number; singleApprover: number }> {
    const rows = await this.db.execute<{
      warn: number;
      overdue: number;
      single_approver: number;
    }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE t.lvl = 'warn')::int    AS warn,
        COUNT(*) FILTER (WHERE t.lvl = 'overdue')::int AS overdue,
        COUNT(*) FILTER (
          WHERE t.sr IS NOT NULL AND btrim(t.sr) <> ''
        )::int AS single_approver
      FROM (
        SELECT ${mrbSlaLevelSql()} AS lvl, ${mrbReview.separationRemark} AS sr
        FROM mrb_review
        WHERE ${mrbActiveCond()}
      ) t
    `);

    const row: any = rows[0] ?? {};
    return {
      warn: Number(row.warn ?? 0),
      overdue: Number(row.overdue ?? 0),
      singleApprover: Number(row.single_approver ?? 0),
    };
  }

  /**
   * 已处理 MRB —— 按 IQC 批次折叠。
   * `reviewCount` 只统计 approved / closed（驳回、作废不计入「评审次数」），
   * 另返回 `totalCount`（全部子单数）供「另有 N 次驳回/作废」提示与展开判断。
   */
  async getMrbLotGroups(params: {
    page: number;
    pageSize: number;
    mrbNo?: string;
    materialCode?: string;
    batchNo?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PaginatedResponse<MrbLotGroup>> {
    const { page, pageSize, mrbNo, materialCode, batchNo, status, startDate, endDate } = params;

    const conditions: any[] = [inArray(mrbReview.status, [...MRB_DONE_STATUSES])];
    if (mrbNo) {
      // 单号前缀即检验单号，业务方常直接拿 JY 号来搜，故一并匹配来源检验单
      const kw = `%${mrbNo.trim()}%`;
      conditions.push(
        or(
          like(mrbReview.mrbNo, kw),
          like(mrbReview.sourceInspectionNo, kw),
          like(iqcLot.inspectionNo, kw),
        ),
      );
    }
    if (materialCode) conditions.push(like(material.materialCode, `%${materialCode}%`));
    if (batchNo) conditions.push(like(iqcLot.batchNo, `%${batchNo}%`));
    if (status) conditions.push(eq(mrbReview.status, status));
    if (startDate) conditions.push(gte(mrbReview.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lt(mrbReview.createdAt, new Date(endDate)));
    const whereSql = and(...conditions);

    const lastAt = sql`MAX(${mrbReview.createdAt})`;
    // 评审次数：不含 rejected / cancelled（P0-8 A3）
    const reviewCountSql = sql<number>`COUNT(*) FILTER (WHERE ${mrbReview.status} IN ('approved', 'closed'))`;
    const totalCountSql = sql<number>`COUNT(*)`;

    const groupRows = await this.db
      .select({
        lotId: mrbReview.lotId,
        reviewCount: reviewCountSql.as('review_count'),
        totalCount: totalCountSql.as('total_count'),
        lastAt: lastAt.as('last_at'),
      })
      .from(mrbReview)
      .leftJoin(iqcLot, eq(mrbReview.lotId, iqcLot.id))
      .leftJoin(material, eq(mrbReview.materialId, material.id))
      .leftJoin(supplier, eq(mrbReview.supplierId, supplier.id))
      .where(whereSql)
      .groupBy(mrbReview.lotId)
      .orderBy(desc(lastAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const totalRows = await this.db
      .select({ total: sql<number>`COUNT(DISTINCT ${mrbReview.lotId})` })
      .from(mrbReview)
      .leftJoin(iqcLot, eq(mrbReview.lotId, iqcLot.id))
      .leftJoin(material, eq(mrbReview.materialId, material.id))
      .leftJoin(supplier, eq(mrbReview.supplierId, supplier.id))
      .where(whereSql);

    const total = Number(totalRows[0]?.total || 0);
    const lotIds = groupRows.map((r) => r.lotId).filter((v): v is string => !!v);

    if (lotIds.length === 0) {
      return { items: [], total, page, pageSize };
    }

    const rows = await this.db
      .select(this.mrbRowSelection())
      .from(mrbReview)
      .leftJoin(iqcLot, eq(mrbReview.lotId, iqcLot.id))
      .leftJoin(material, eq(mrbReview.materialId, material.id))
      .leftJoin(supplier, eq(mrbReview.supplierId, supplier.id))
      .where(and(inArray(mrbReview.status, [...MRB_DONE_STATUSES]), inArray(mrbReview.lotId, lotIds)))
      .orderBy(desc(mrbReview.createdAt));

    const byLot = new Map<string, MrbReview[]>();
    for (const row of rows) {
      const mrb = this.mapMrbRow(row);
      const list = byLot.get(mrb.lotId);
      if (list) list.push(mrb);
      else byLot.set(mrb.lotId, [mrb]);
    }

    // 该页各批次的「未占用不良品余量」与「是否存在进行中单」→ 决定能否再次发起
    const remainMap = await this.loadRemainingDefectiveByBatch(
      rows.map((r: any) => ({ materialId: r.materialId, supplierId: r.supplierId, batchNo: r.batchNo })),
    );
    const activeLots = new Set(
      (
        await this.db
          .select({ lotId: mrbReview.lotId })
          .from(mrbReview)
          .where(
            and(
              inArray(mrbReview.lotId, lotIds),
              notInArray(mrbReview.status, [...MRB_DONE_STATUSES]),
            ),
          )
          .groupBy(mrbReview.lotId)
      ).map((r) => r.lotId),
    );

    const items: MrbLotGroup[] = [];
    for (const lotId of lotIds) {
      const list = byLot.get(lotId);
      if (!list || list.length === 0) continue;
      const [latest, ...history] = list;
      const groupRow = groupRows.find((g) => g.lotId === lotId);
      const remain = remainMap.get(
        this.batchKey(latest.materialId, latest.supplierId, latest.batchNo),
      ) ?? 0;
      const canReinitiate = !activeLots.has(lotId) && remain > 0;

      items.push({
        lotId,
        batchNo: latest.batchNo,
        materialId: latest.materialId,
        materialCode: latest.materialCode,
        materialName: latest.materialName,
        supplierId: latest.supplierId,
        supplierName: latest.supplierName,
        unit: latest.unit,
        reviewCount: Number(groupRow?.reviewCount ?? 0),
        totalCount: Number(groupRow?.totalCount ?? list.length),
        remainingDefectiveQty: remain,
        canReinitiate,
        latest,
        history,
      });
    }

    return { items, total, page, pageSize };
  }

  private batchKey(materialId?: string, supplierId?: string, batchNo?: string): string {
    return `${materialId || ''}|${supplierId || ''}|${this.normalizeBatchNo(batchNo)}`;
  }

  /** 去掉重检后缀 -R1 / -R2，与可评审量 SQL 的 regexp_replace 保持一致 */
  private normalizeBatchNo(batchNo?: string | null): string {
    return (batchNo || '').replace(/-R\d+$/, '');
  }

  /**
   * 批量取「未被 MRB-OTHER 占用的不良品余量」，按 (material, supplier, batch) 聚合。
   * 供已处理折叠行的「剩余不良品量 / 可再次发起」判断使用（一次查询覆盖整页）。
   */
  private async loadRemainingDefectiveByBatch(
    keys: Array<{ materialId?: string; supplierId?: string; batchNo?: string }>,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const materialIds = [...new Set(keys.map((k) => k.materialId).filter((v): v is string => !!v))];
    if (materialIds.length === 0) return result;

    const rows = await this.db.execute<{
      material_id: string;
      supplier_id: string | null;
      batch_no: string | null;
      qty: string;
    }>(sql`
      SELECT inv.material_id::text AS material_id,
             inv.supplier_id::text AS supplier_id,
             regexp_replace(inv.batch_no, '-R[0-9]+$', '') AS batch_no,
             SUM(inv.quantity) AS qty
      FROM inventory inv
      WHERE inv.material_id IN (${sql.join(materialIds.map((id) => sql`${id}::uuid`), sql`, `)})
        AND ${reviewableDefectiveCond('inv')}
      GROUP BY 1, 2, 3
    `);

    for (const r of rows as any[]) {
      result.set(
        this.batchKey(r.material_id, r.supplier_id ?? undefined, r.batch_no ?? undefined),
        Number(r.qty || 0),
      );
    }
    return result;
  }

  // =========================================================================
  // 五、基础工具（仓库 / 库位 / 单号 / 入参解析）
  // =========================================================================

  /** 按系统参数或仓库类型取仓库行（需要 wh_code，故不只返回 id） */
  private async findWarehouseRowByParamOrType(
    paramKey: string,
    fallbackWhType: 'normal' | 'defective',
    label: string,
  ): Promise<{ id: string; whCode: string }> {
    const paramResult = await this.db
      .select({ paramValue: sysParam.paramValue })
      .from(sysParam)
      .where(eq(sysParam.paramKey, paramKey))
      .limit(1);

    if (paramResult.length > 0 && paramResult[0].paramValue) {
      const whCode = paramResult[0].paramValue;
      const whResult = await this.db
        .select({ id: warehouse.id, whCode: warehouse.whCode })
        .from(warehouse)
        .where(eq(warehouse.whCode, whCode))
        .limit(1);
      if (whResult.length > 0) return whResult[0];
      this.logger.warn(
        `${label}参数 ${paramKey}=${whCode} 在仓库表中不存在，已按类型 ${fallbackWhType} 兜底`,
      );
    }

    const fallbackResult = await this.db
      .select({ id: warehouse.id, whCode: warehouse.whCode })
      .from(warehouse)
      .where(and(eq(warehouse.whType, fallbackWhType), eq(warehouse.status, 'active')))
      .orderBy(warehouse.whCode)
      .limit(1);
    if (fallbackResult.length === 0) {
      throw new NotFoundException(`系统参数 ${paramKey} 未配置且无 ${fallbackWhType} 类型仓库可用`);
    }
    return fallbackResult[0];
  }

  /** 良品仓下第一个可用库位（供下游模块复用） */
  async getGoodWarehouseLocation(): Promise<{ id: string; locationCode: string }> {
    const wh = await this.findWarehouseRowByParamOrType(
      'good_warehouse_code',
      'normal',
      '良品仓库',
    );

    const locResult = await this.db
      .select({ id: warehouseLocation.id, locationCode: warehouseLocation.locationCode })
      .from(warehouseLocation)
      .where(
        and(
          eq(warehouseLocation.warehouseId, wh.id),
          eq(warehouseLocation.status, 'active'),
          // 排除 MRB 保留库位：特采放行必须落普通库位，否则会被后续「其他」处置的排除条件误伤。
          // 保留库位编码形如 `<不良品仓编码>-MRB-RSV-<mrbNo>`，故用 `%<MARK>%` 通配匹配。
          sql`${warehouseLocation.locationCode} NOT LIKE ${`%${MRB_RESERVE_LOCATION_MARK}%`}`,
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
   * MRB 处置保留库位：`<不良品仓编码>-MRB-RSV-<mrbNo>`（**一张 MRB 一个**，设计 v2.1-arch.1 §7-5）。
   *
   * 为什么按 MRB 拆库位而不是全仓共用一个：
   *  1. 跨 MRB 天然隔离 —— `inventory` 的 4 列唯一键含 `location_id`，
   *     两张单各自一个库位就不可能撞键，也不需要改动全仓 20+ 处 upsert 的唯一索引
   *     （BUG-MRB-001 的错账根因正是「共用一个库位 → 同批次多去向被合并成一行」）；
   *  2. 审计性好 —— 一个库位只承载一张单的占用，盘点/追责一目了然。
   *
   * `status='locked'`：保留位不是可作业库位，必须从库位下拉 / 目标地址码选择器消失
   * （`getAllActiveLocations()` 硬编码 `status='active'` 过滤，故 locked 会自动被排除）。
   * `location_type='defective'`：不新增枚举值，避免库位页面出现未知类型。
   *
   * 并发终审同一张单（或重复终审）会同时创建：靠 `location_code` 唯一键 + ON CONFLICT DO NOTHING
   * 兜住，冲突后重查拿对方插入的行。
   *
   * @param mrbNo MRB 单号；为空时抛错（保留位必须能追溯到具体单号）
   */
  private async getReserveLocation(mrbNo: string): Promise<{ id: string; locationCode: string }> {
    const no = (mrbNo || '').trim();
    if (!no) {
      throw new BadRequestException('MRB 单号为空，无法定位处置保留库位');
    }

    const wh = await this.findWarehouseRowByParamOrType(
      'defective_warehouse_code',
      'defective',
      '不良品仓库',
    );
    const locationCode = buildReserveLocationCode(wh.whCode, no);

    const existing = await this.db
      .select({ id: warehouseLocation.id, locationCode: warehouseLocation.locationCode })
      .from(warehouseLocation)
      .where(eq(warehouseLocation.locationCode, locationCode))
      .limit(1);
    if (existing.length > 0) return existing[0];

    const inserted = await this.db
      .insert(warehouseLocation)
      .values({
        locationCode,
        warehouseId: wh.id,
        areaCode: 'MRB',
        shelfCode: 'RSV',
        layerCode: '01',
        positionCode: '0001',
        // 保持 defective（不新增 location_type 值，否则库位页面/调拨选择器会出现未知类型）
        locationType: 'defective',
        // locked：不进库位下拉、不可被选作移库/调拨目标（系统自动维护）
        status: 'locked',
        // 描述带单号：`GET /api/warehouse/location` 分页列表不带 status 时仍看得到，
        // 运维靠这段文字判断「这行是系统资产，禁止手工移库/改名/启用」
        description: `MRB 处置保留位（${no}）｜系统自动维护，禁止手工移库/改名/启用`,
      })
      .onConflictDoNothing({ target: warehouseLocation.locationCode })
      .returning({ id: warehouseLocation.id, locationCode: warehouseLocation.locationCode });

    if (inserted.length > 0) return inserted[0];

    const again = await this.db
      .select({ id: warehouseLocation.id, locationCode: warehouseLocation.locationCode })
      .from(warehouseLocation)
      .where(eq(warehouseLocation.locationCode, locationCode))
      .limit(1);
    if (again.length === 0) {
      throw new NotFoundException(`MRB 处置保留库位创建失败：${locationCode}`);
    }
    return again[0];
  }

  /**
   * 不良品仓下第一个可用库位（排除 MRB 保留库位）。
   * 供「释放保留占用」时如果没有原不良品行落地使用。
   */
  private async getDefectiveWarehouseLocation(): Promise<{ id: string; locationCode: string } | null> {
    const wh = await this.findWarehouseRowByParamOrType(
      'defective_warehouse_code',
      'defective',
      '不良品仓库',
    );
    const locResult = await this.db
      .select({ id: warehouseLocation.id, locationCode: warehouseLocation.locationCode })
      .from(warehouseLocation)
      .where(
        and(
          eq(warehouseLocation.warehouseId, wh.id),
          eq(warehouseLocation.status, 'active'),
          sql`${warehouseLocation.locationCode} NOT LIKE ${`%${MRB_RESERVE_LOCATION_MARK}%`}`,
        ),
      )
      .orderBy(warehouseLocation.locationCode)
      .limit(1);
    return locResult.length > 0 ? locResult[0] : null;
  }

  /**
   * 释放某张 MRB 的保留占用（把余量搬回不良品仓、解锁、清 lock_reason、写流水）。
   *
   * 触发时机：**两个终态都释放** —— `approved`（finalApprove 内）与 `closed`（syncExecutionStatus 内），
   * 均与本单状态变更同事务。状态与保留行的对应关系是硬不变量（arch.6 §7-13）：
   * ```
   * draft ~ pending_final : 保留行不存在（还没终审）
   * pending_execute       : 保留行存在 == Σ(sample+hold) + Σ(customer_return 且 pending)
   * approved / closed     : 保留行必须 0 行（余量已释放回不良品仓）
   * ```
   * 为什么必须释放：留样/暂存继续挂在 `<wh>-MRB-RSV-<mrbNo>` 且 `locked=true`，会同时死锁三处 ——
   * ① 被 `NOT LIKE 'MRB-OTHER:%'` 排除在可评审量外（待发起看不到、无法重新发起 MRB）；
   * ② 被库存守卫拦住（不能移库/解锁/盘点）；
   * ③ 库位 `status='locked'` 在任何库位选择器里都选不到。等于只能改库才能解。
   * 追溯不靠锁库存：`mrb_disposition` + `inventory_transaction` 已完整留痕。
   *
   * 为什么 `pending_execute` 不释放：「退回客户」还在等实物提走，提前释放会造成
   * 「账上有货、库里没有」——比死库存更严重的错账。
   *
   * 实现要点：
   *  - **不 `UPDATE inventory SET location_id=...`**：目标库位可能已有同物料同批次同状态的行，
   *    直接改 location 会撞 4 列唯一键 23505。正确做法是「先查目标行 → 有则数量相加、无则插入 → 删保留行」。
   *  - 合并时**只加数量**，绝不动目标行的 `locked` / `lock_reason` / `is_special_admit`：
   *    那里可能挂着别的业务语义（如「退货单 xx 已取消」），清掉就是二次事故。
   *  - 数量**只搬不减**：全库 Σ(inventory.quantity) 不变；真正减持只发生在 confirm-out / 报废核销。
   *  - 幂等：无保留行时静默返回（并发重复调 release 不会重复加库存或重复写流水）。
   *  - `hold_until` 只是留痕，到期不自动释放、也不阻断释放（本期不做到期提醒）。
   *
   * @param tx 事务执行器（必须与状态变更同事务，失败整体回滚）
   * @param mrbId MRB 主键
   */
  private async releaseMrbReserve(tx: any, mrbId: string): Promise<void> {
    const mrbRows = await tx
      .select({
        mrbNo: mrbReview.mrbNo,
        status: mrbReview.status,
        materialId: mrbReview.materialId,
        batchNo: mrbReview.batchNo,
        unit: mrbReview.unit,
      })
      .from(mrbReview)
      .where(eq(mrbReview.id, mrbId))
      .limit(1);
    if (mrbRows.length === 0) return;
    const mrb = mrbRows[0];

    // 没有不良品仓（理论上不可能，因为占用行必须落在不良品仓下的保留位）→ 无需释放
    let whCode = '';
    try {
      const wh = await this.findWarehouseRowByParamOrType(
        'defective_warehouse_code',
        'defective',
        '不良品仓库',
      );
      whCode = wh.whCode;
    } catch {
      return;
    }
    if (!whCode) return;

    const locationCode = buildReserveLocationCode(whCode, mrb.mrbNo);
    const locRows = await tx
      .select({ id: warehouseLocation.id })
      .from(warehouseLocation)
      .where(eq(warehouseLocation.locationCode, locationCode))
      .limit(1);
    // 该单从未产生过「其他」占用（纯特采 / 退货 / 返工 / 报废单）→ 无事可做
    if (locRows.length === 0) return;
    const reserveLocId = locRows[0].id;

    const lockReason = buildOtherLockReason(mrb.mrbNo);
    const reserveRows = (await tx
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.locationId, reserveLocId),
          eq(inventory.lockReason, lockReason),
          sql`${inventory.quantity} > 0`,
        ),
      )
      .orderBy(asc(inventory.createdAt), asc(inventory.id))
      .for('update')) as any[];

    for (const row of reserveRows) {
      const qtyScaled = this.toScaled(row.quantity);
      if (qtyScaled <= 0) continue;
      const qtyStr = this.fromScaled(qtyScaled);

      // 找「原不良品行」合并：同物料 + 同批次 + 同库存状态 + 未被 MRB 占用
      const dest = (await tx.execute(sql`
        SELECT id, location_id FROM inventory
        WHERE material_id = ${row.materialId}::uuid
          AND coalesce(batch_no, '') = ${row.batchNo ?? ''}
          AND stock_status = ${row.stockStatus ?? 'defective'}
          AND (lock_reason IS NULL OR lock_reason NOT LIKE ${MRB_OTHER_LIKE_PATTERN})
          AND id <> ${row.id}::uuid
        ORDER BY _created_at, id
        LIMIT 1
        FOR UPDATE
      `)) as unknown as Array<{ id: string; location_id: string }>;

      let destLocationId: string;
      let balanceScaled: number;
      if (dest.length > 0) {
        destLocationId = dest[0].location_id;
        const updated = (await tx.execute(sql`
          UPDATE inventory SET quantity = quantity + ${qtyStr}::numeric
          WHERE id = ${dest[0].id}::uuid
          RETURNING quantity
        `)) as unknown as Array<{ quantity: string }>;
        balanceScaled = this.toScaled(updated?.[0]?.quantity);
      } else {
        // 原行已被本次处置吃空（数量全搬走了）→ 在不良品仓普通库位重建一行
        const fallbackLoc = await this.getDefectiveWarehouseLocation();
        if (!fallbackLoc) {
          throw new BadRequestException('不良品仓下无可用库位，无法释放 MRB 保留占用');
        }
        const created = (await tx
          .insert(inventory)
          .values({
            materialId: row.materialId,
            locationId: fallbackLoc.id,
            batchNo: row.batchNo ?? '',
            supplierId: row.supplierId ?? null,
            quantity: qtyStr,
            unit: row.unit ?? mrb.unit,
            stockStatus: row.stockStatus ?? 'defective',
            productionDate: row.productionDate ?? null,
            locked: false,
            lockReason: null,
          })
          .returning({ id: inventory.id, quantity: inventory.quantity })) as any[];
        destLocationId = fallbackLoc.id;
        balanceScaled = this.toScaled(created[0].quantity);
      }

      await tx.insert(inventoryTransaction).values({
        materialId: row.materialId,
        locationId: destLocationId,
        batchNo: row.batchNo ?? null,
        labelNo: row.labelNo ?? null,
        stockStatus: row.stockStatus ?? 'defective',
        txType: 'mrb_reserve_release',
        txNo: mrb.mrbNo,
        qty: qtyStr,
        balanceAfter: this.fromScaled(balanceScaled),
        unit: row.unit ?? mrb.unit,
        referenceNo: mrb.mrbNo,
        remark: `MRB ${mrb.status === 'closed' ? '结案（closed）' : '归档（approved）'}释放保留占用 ${qtyStr}，货物退回不良品仓`,
        createdBy: null,
        updatedBy: null,
      });

      await tx.delete(inventory).where(eq(inventory.id, row.id));
    }

    // 保留库位停用（不删：保留审计线索）；下次同一单号不会复用，故直接停用即可
    await tx
      .update(warehouseLocation)
      .set({ status: 'inactive' })
      .where(eq(warehouseLocation.id, reserveLocId));
  }

  /**
   * 解析发起 MRB 的 IQC 批次入参
   * 依次支持：UUID（iqc_lot.id）→ 检验编号（inspection_no）→ 批次号（lot_no）→ 来料批次号（batch_no）
   */
  private async resolveIqcLotId(input: string): Promise<string> {
    const raw = (input || '').trim();
    if (!raw) {
      throw new BadRequestException('请输入正确的 IQC 批次 ID：该字段不能为空');
    }
    if (UUID_RE.test(raw)) return raw;

    const byInspectionNo = await this.db
      .select({ id: iqcLot.id })
      .from(iqcLot)
      .where(eq(iqcLot.inspectionNo, raw))
      .limit(2);
    if (byInspectionNo.length === 1) return byInspectionNo[0].id;
    if (byInspectionNo.length > 1) {
      throw new BadRequestException(`请输入正确的 IQC 批次 ID：检验编号「${raw}」对应多个批次，请改用批次 ID`);
    }

    const byLotNo = await this.db
      .select({ id: iqcLot.id })
      .from(iqcLot)
      .where(eq(iqcLot.lotNo, raw))
      .limit(2);
    if (byLotNo.length === 1) return byLotNo[0].id;

    const byBatchNo = await this.db
      .select({ id: iqcLot.id })
      .from(iqcLot)
      .where(eq(iqcLot.batchNo, raw))
      .limit(2);
    if (byBatchNo.length === 1) return byBatchNo[0].id;
    if (byBatchNo.length > 1) {
      throw new BadRequestException(`请输入正确的 IQC 批次 ID：来料批次号「${raw}」不唯一，请改用检验编号或批次 ID`);
    }

    throw new BadRequestException(
      `请输入正确的 IQC 批次 ID：未找到检验编号 / 批次号为「${raw}」的检验批次`,
    );
  }

  /** 生成「当前登录人 == 该行评审员」的匹配条件（兼容历史脏数据里存工号的行） */
  private async reviewerMatchCondition(userId: string): Promise<any> {
    if (!userId) return sql`false`;
    let matchAccount = '';
    if (UUID_RE.test(userId)) {
      const acc = await this.db
        .select({ account: sysAccount.account })
        .from(sysAccount)
        .where(eq(sysAccount.id, userId))
        .limit(1);
      matchAccount = acc[0]?.account || '';
    }
    return matchAccount
      ? sql`((${mrbReviewer.reviewerId}).user_id = ${userId} OR (${mrbReviewer.reviewerId}).user_id = ${matchAccount})`
      : sql`(${mrbReviewer.reviewerId}).user_id = ${userId}`;
  }

  /** 把「评审员标识」规范化为 sys_account.id（UUID），同时接受工号 */
  private async normalizeReviewerRef(raw: string): Promise<string | null> {
    const value = (raw || '').trim();
    if (!value) return null;

    if (UUID_RE.test(value)) {
      const byId = await this.db
        .select({ id: sysAccount.id })
        .from(sysAccount)
        .where(eq(sysAccount.id, value))
        .limit(1);
      return byId.length > 0 ? byId[0].id : null;
    }

    const byAccount = await this.db
      .select({ id: sysAccount.id })
      .from(sysAccount)
      .where(eq(sysAccount.account, value))
      .limit(1);
    return byAccount.length > 0 ? byAccount[0].id : null;
  }

  /** 校验并把评审员入参解析成账号 UUID（解析不到直接点名报错） */
  private async resolveReviewers(reviewers: MrbReviewerInput[]): Promise<MrbReviewerInput[]> {
    const resolved: MrbReviewerInput[] = [];
    for (const r of reviewers) {
      const uid = await this.normalizeReviewerRef(r.reviewerId);
      if (!uid) {
        throw new BadRequestException(
          `评审人员「${r.reviewerName || r.reviewerId}」的账号不存在（${r.reviewerId}），请重新选择`,
        );
      }
      resolved.push({ ...r, reviewerId: uid });
    }
    return resolved;
  }

  /** 事务内重建评审员列表 */
  private async replaceReviewers(
    tx: any,
    mrbId: string,
    resolved: MrbReviewerInput[],
  ): Promise<void> {
    await tx.delete(mrbReviewer).where(eq(mrbReviewer.mrbId, mrbId));
    const values = resolved.map((r: MrbReviewerInput, idx: number) => ({
      mrbId,
      reviewerId: r.reviewerId,
      reviewerRole: r.reviewerRole,
      sortOrder: idx,
    }));
    await tx.insert(mrbReviewer).values(values);
  }

  // =========================================================================
  // 六、T3 发起与生命周期（initiate / assign / submit / cancel）
  // =========================================================================

  /**
   * 发起 MRB。
   *
   * 与旧实现的三处差异：
   *  1. 发起人一律取登录态（旧实现从请求体拿 initiatorId，可冒名）；
   *  2. 本次评审数量 N 可由人指定（1 ≤ N ≤ M），默认 M；M 与待发起列表同源；
   *  3. `submit=false` 落草稿，`submit=true` 时同事务内完成指派与状态推进。
   */
  async initiateMrb(params: {
    iqcLotId: string;
    reason: string;
    operator: MrbOperator;
    quantity?: number;
    submit?: boolean;
    isUrgent?: boolean;
    urgentReason?: string;
    reviewers?: MrbReviewerInput[];
  }): Promise<MrbReview> {
    const { operator } = params;
    const reason = (params.reason || '').trim();
    if (!reason) throw new BadRequestException('请填写不合格原因');

    const submit = params.submit !== false; // 缺省 true（兼容旧前端）
    const isUrgent = params.isUrgent === true;
    const urgentReason = (params.urgentReason || '').trim();
    if (isUrgent && !urgentReason) {
      throw new BadRequestException('急件必须填写急件原因');
    }

    const iqcLotId = await this.resolveIqcLotId(params.iqcLotId);

    // 1. 批次必须存在且检验不合格
    const lotResult = await this.db.select().from(iqcLot).where(eq(iqcLot.id, iqcLotId)).limit(1);
    if (lotResult.length === 0) throw new NotFoundException('检验批次不存在');
    const lot = lotResult[0];
    if (lot.inspectionResult !== 'fail') {
      throw new BadRequestException('仅检验不合格的批次可发起MRB评审');
    }

    // 2. 同批次不允许并行多张「还没分配数量」的进行中单。
    //    `pending_execute` 不阻塞：处置数量已从可评审池迁出，剩余量可单独发起（见
    //    MRB_INFLIGHT_BLOCKING_STATUSES 注释）。
    const existingMrb = await this.db
      .select({ id: mrbReview.id, mrbNo: mrbReview.mrbNo })
      .from(mrbReview)
      .where(
        and(
          eq(mrbReview.lotId, iqcLotId),
          inArray(mrbReview.status, [...MRB_INFLIGHT_BLOCKING_STATUSES]),
        ),
      )
      .limit(1);
    if (existingMrb.length > 0) {
      throw new ConflictException(
        `该批次已存在进行中的MRB评审单（${existingMrb[0].mrbNo}），请先完成后再发起`,
      );
    }

    // 3. 历史评审次数：判定「首次发起」还是「重新发起」
    const historyResult = await this.db
      .select({ c: count() })
      .from(mrbReview)
      .where(
        and(eq(mrbReview.lotId, iqcLotId), notInArray(mrbReview.status, ['rejected', 'cancelled'])),
      );
    const historyCount = Number(historyResult[0]?.c || 0);

    // 4. 可评审量 M：与 pending-lots / finalApprove 共用同一 SQL 片段
    const matchBatchNo = this.normalizeBatchNo(lot.batchNo);
    const qtyRows = await this.db.execute<{ defective: string; locked_good: string }>(sql`
      SELECT
        COALESCE((
          SELECT SUM(inv.quantity) FROM inventory inv
          WHERE inv.material_id = ${lot.materialId}::uuid
            AND inv.supplier_id = ${lot.supplierId}::uuid
            AND inv.batch_no = ${matchBatchNo}
            AND ${reviewableDefectiveCond('inv')}
        ), 0) AS defective,
        COALESCE((
          SELECT SUM(inv.quantity) FROM inventory inv
          WHERE inv.material_id = ${lot.materialId}::uuid
            AND inv.supplier_id = ${lot.supplierId}::uuid
            AND inv.batch_no = ${matchBatchNo}
            AND ${lockedGoodCond('inv')}
        ), 0) AS locked_good
    `);
    const defectiveQtyNum = Number((qtyRows as any)[0]?.defective ?? 0);
    const lockedGoodQtyNum = Number((qtyRows as any)[0]?.locked_good ?? 0);

    if (historyCount > 0) {
      if (defectiveQtyNum <= 0) {
        throw new BadRequestException(
          '该批次已完成 MRB 评审，且不良品仓已无未处理库存，无需重新发起',
        );
      }
    } else if (defectiveQtyNum <= 0 && lockedGoodQtyNum <= 0) {
      throw new BadRequestException(
        '该批次无可评审的不良品库存（需已调拨至不良品仓，或在良品仓处于锁定状态）',
      );
    }

    // 重新发起时只取不良品仓剩余量，不把已放行的良品计入
    const maxScaled =
      this.toScaled(defectiveQtyNum) + (historyCount > 0 ? 0 : this.toScaled(lockedGoodQtyNum));
    const maxQtyNum = this.fromScaled(maxScaled);

    let quantityScaled = maxScaled;
    if (params.quantity !== undefined && params.quantity !== null) {
      const raw = Number(params.quantity);
      const scaled = this.toScaled(raw);
      if (!Number.isFinite(raw) || scaled <= 0 || scaled > maxScaled) {
        throw new BadRequestException(
          `本次评审数量需在 1 ~ ${maxQtyNum} 之间（当前不良品仓可评审 ${maxQtyNum}）`,
        );
      }
      quantityScaled = scaled;
    }

    // 5. 评审员（可选）：一步到位时同事务写入
    const reviewers = params.reviewers?.length ? await this.resolveReviewers(params.reviewers) : [];

    const inspectionNo = normalizeInspectionNo(lot.inspectionNo);
    const now = new Date();

    const mrbId = await this.db.transaction(async (tx) => {
      // 单号必须在事务内取：序号按「该批次已有 MRB 数」递增，靠 advisory lock 串行化
      const mrbNo = await nextMrbNo(tx, { lotId: iqcLotId, inspectionNo });
      const inserted = await tx
        .insert(mrbReview)
        .values({
          mrbNo,
          sourceInspectionNo: inspectionNo,
          lotId: iqcLotId,
          materialId: lot.materialId,
          supplierId: lot.supplierId,
          batchNo: lot.batchNo,
          quantity: this.fromScaled(quantityScaled),
          unit: lot.unit,
          failReason: reason,
          // 一律先落草稿，再按 submit/评审员情况推进（保证状态机只有一个入口）
          status: 'draft',
          statusSince: now,
          // 只有 SQE 自己发起的 MRB 才绑定责任人；管理员/IQC 代发起时留空，
          // 否则这张单会被「只能制定本人负责的方案」挡死，任何 SQE 都提交不了。
          sqeId: operator.roleCode === 'sqe' ? operator.userId : null,
          isUrgent,
          urgentReason: isUrgent ? urgentReason : null,
        })
        .returning({ id: mrbReview.id });

      const id = inserted[0].id;
      if (reviewers.length > 0) {
        await this.replaceReviewers(tx, id, reviewers);
      }
      if (submit) {
        // v3.1：新单此刻一定还没有处置方案。没有方案就进评审会产生
        // 「评审中但方案为空」的死单（无法执行、只能作废），故一律先落「待制定方案」。
        // 真正进评审由 `savePlan(submit=true)` 完成。
        const target: MrbStatus = 'pending_review';
        await this.transition(tx, id, 'draft', target);
      }
      return id;
    });

    return this.getMrbDetail(mrbId);
  }

  // =========================================================================
  // 六之二、方案制定（MRB v3）：二维码分摊 + 处置方案
  // =========================================================================

  /**
   * 该批次关联的全部收货箱（一箱 = 一张收货单 = 一个二维码）。
   * `allocated` 是本单已分摊到各处置的数量，用于弹窗显示「已分配 / 未分配」。
   */
  async getLotLabels(params: { mrbId?: string; lotId?: string }): Promise<MrbLotLabelRow[]> {
    let lotId = params.lotId;
    const mrbId = params.mrbId;

    if (!lotId) {
      if (!mrbId) throw new BadRequestException('请提供 lotId 或 mrbId');
      const rows = await this.db
        .select({ lotId: mrbReview.lotId })
        .from(mrbReview)
        .where(eq(mrbReview.id, mrbId))
        .limit(1);
      if (rows.length === 0) throw new NotFoundException('MRB评审单不存在');
      lotId = rows[0].lotId;
    }

    const result = await this.db.execute(sql`
      SELECT
        ro.id             AS receipt_id,
        ro.receipt_no     AS receipt_no,
        ro.qr_content     AS qr_content,
        ro.quantity       AS quantity,
        ro.production_date AS production_date,
        ro.batch_no       AS batch_no,
        ro.serial_no      AS serial_no,
        COALESCE(alloc.allocated, 0) AS allocated
      FROM iqc_lot_receipt ilr
      JOIN receipt_order ro ON ro.id = ilr.receipt_id
      LEFT JOIN (
        SELECT mdl.receipt_id, SUM(mdl.quantity) AS allocated
        FROM mrb_disposition_label mdl
        WHERE mdl.mrb_id = ${mrbId ?? null}::uuid
        GROUP BY mdl.receipt_id
      ) alloc ON alloc.receipt_id = ro.id
      WHERE ilr.lot_id = ${lotId}::uuid
      ORDER BY ro.receipt_no
    `);

    return (result as unknown as Array<Record<string, any>>).map((r) => {
      const qty = Number(r.quantity ?? 0);
      const allocated = Number(r.allocated ?? 0);
      return {
        receiptId: r.receipt_id,
        receiptNo: r.receipt_no,
        qrContent: r.qr_content,
        quantity: qty,
        allocated,
        remaining: Math.round((qty - allocated) * 10000) / 10000,
        productionDate: r.production_date,
        batchNo: r.batch_no,
        serialNo: r.serial_no,
      };
    });
  }

  /**
   * 保存 / 提交方案（MRB v3 主入口）。
   *
   * 与旧流程的差别：处置明细由 SQE 在这里定死，质量经理终审时只做通过/否决。
   * 数量一律从 `labels` 汇总，杜绝「处置行数量」与「箱级分摊」两套数字打架。
   */
  async savePlan(params: {
    mrbId: string;
    reviewers?: MrbReviewerInput[];
    dispositions: MrbPlanDispositionInput[];
    /** 不合格原因：系统自动触发时写的是模板文案，必须由 SQE 在制定方案时填写真实原因 */
    failReason?: string;
    submit?: boolean;
    operator: MrbOperator;
  }): Promise<MrbReview> {
    const { mrbId, operator } = params;
    const submit = params.submit !== false;

    const mrb = await this.loadMrb(mrbId);
    if (mrb.status === 'reviewing') {
      throw new BadRequestException('评审已开始，如需修改请先撤回');
    }
    if (!['draft', 'pending_review'].includes(mrb.status)) {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status as MrbStatus] || mrb.status}）不可制定方案`,
      );
    }
    await this.assertPlanPermission(mrb, operator);

    // 提交方案时不合格原因必填：列表里那段是自动触发时写的说明，不能当真实原因
    const failReason = (params.failReason || '').trim();
    if (submit && failReason.length < 2) {
      throw new BadRequestException('请填写不合格原因（至少 2 个字）');
    }
    if (submit && failReason.includes('自动触发')) {
      throw new BadRequestException('请填写真实的不合格原因，不能沿用系统自动生成的说明');
    }

    // ---------- 1. 入参归一化 ----------
    const lines: Array<{
      type: MrbDispositionType;
      qtyScaled: number;
      otherType?: MrbOtherType;
      refNo?: string;
      holdUntil?: string;
      remark?: string;
      sortOrder: number;
      labels: Array<{ receiptId: string; receiptNo: string; qrContent: string | null; quantity: string }>;
    }> = [];

    const boxes = await this.getLotLabels({ mrbId });
    const boxMap = new Map(boxes.map((b) => [b.receiptId, b]));
    const perBoxScaled = new Map<string, number>();

    let sortOrder = 0;
    for (const [index, line] of (params.dispositions || []).entries()) {
      if (!line || !line.dispositionType) continue;
      if (!EXECUTABLE_DISPOSITIONS.includes(line.dispositionType)) {
        throw new BadRequestException(`不支持的处置方式：${line.dispositionType}`);
      }
      const labelInputs = line.labels || [];
      if (labelInputs.length === 0) {
        throw new BadRequestException(`第 ${index + 1} 条处置未分配任何收货箱`);
      }

      const seen = new Set<string>();
      const labelRows: Array<{ receiptId: string; receiptNo: string; qrContent: string | null; quantity: string }> = [];
      let lineScaled = 0;

      for (const lb of labelInputs) {
        if (!lb || !lb.receiptId) {
          throw new BadRequestException(`第 ${index + 1} 条处置存在空的收货箱`);
        }
        const box = boxMap.get(lb.receiptId);
        if (!box) {
          throw new BadRequestException(`收货箱 ${lb.receiptId} 不属于该批次，请刷新后重试`);
        }
        if (seen.has(lb.receiptId)) {
          throw new BadRequestException(`收货箱 ${box.receiptNo} 在同一处置中重复出现`);
        }
        seen.add(lb.receiptId);

        const scaled = this.toScaled(lb.quantity);
        if (scaled <= 0) {
          throw new BadRequestException(`收货箱 ${box.receiptNo} 的分配数量必须大于 0`);
        }
        lineScaled += scaled;

        const acc = (perBoxScaled.get(lb.receiptId) || 0) + scaled;
        perBoxScaled.set(lb.receiptId, acc);

        labelRows.push({
          receiptId: lb.receiptId,
          receiptNo: box.receiptNo,
          qrContent: box.qrContent,
          quantity: this.fromScaled(scaled),
        });
      }

      const lineObj: (typeof lines)[number] = {
        type: line.dispositionType,
        qtyScaled: lineScaled,
        remark: line.remark,
        sortOrder: sortOrder++,
        labels: labelRows,
      };
      if (line.dispositionType === 'other') {
        const other = this.validateOtherLine(line as any, index);
        lineObj.otherType = other.otherType;
        lineObj.refNo = other.refNo;
        lineObj.holdUntil = other.holdUntil;
      }
      lines.push(lineObj);
    }

    // ---------- 2. 单箱不超分 ----------
    for (const [receiptId, usedScaled] of perBoxScaled) {
      const box = boxMap.get(receiptId)!;
      const boxScaled = this.toScaled(box.quantity);
      if (usedScaled > boxScaled) {
        throw new BadRequestException(
          `收货箱 ${box.receiptNo} 分配合计 ${this.fromScaled(usedScaled)} 超过箱内数量 ${box.quantity}`,
        );
      }
    }

    // ---------- 3. 守恒校验（提交时才强制，草稿允许未填完） ----------
    const totalScaled = this.toScaled(mrb.quantity);
    const sumScaled = lines.reduce((s, l) => s + l.qtyScaled, 0);
    if (submit) {
      if (lines.length === 0) throw new BadRequestException('请至少填写一条处置方案');
      if (sumScaled !== totalScaled) {
        throw new BadRequestException(
          `分摊合计 ${this.fromScaled(sumScaled)} 与本次评审数量 ${this.fromScaled(totalScaled)} 不一致`,
        );
      }
      if (!params.reviewers?.length) {
        const exist = await this.db
          .select({ id: mrbReviewer.id })
          .from(mrbReviewer)
          .where(eq(mrbReviewer.mrbId, mrbId))
          .limit(1);
        if (exist.length === 0) throw new BadRequestException('提交评审前必须选定至少一名评审人员');
      }
    }

    const reviewers = params.reviewers?.length ? await this.resolveReviewers(params.reviewers) : null;
    const now = new Date();

    await this.db.transaction(async (tx) => {
      // 重建方案：草稿可反复保存，旧数据整单清掉重写
      await tx.delete(mrbDispositionLabel).where(eq(mrbDispositionLabel.mrbId, mrbId));
      await tx.delete(mrbDisposition).where(eq(mrbDisposition.mrbId, mrbId));

      for (const line of lines) {
        const inserted = await tx
          .insert(mrbDisposition)
          .values({
            mrbId,
            dispositionType: line.type,
            otherType: line.otherType ?? null,
            refNo: line.refNo ?? null,
            holdUntil: line.holdUntil ?? null,
            quantity: this.fromScaled(line.qtyScaled),
            unit: mrb.unit,
            // SQE 已定、未执行：终审通过后才转 pending / done
            execStatus: 'planned',
            remark: line.remark ?? null,
            sortOrder: line.sortOrder,
            createdBy: operator.userId,
            updatedBy: operator.userId,
          })
          .returning({ id: mrbDisposition.id });

        const dispositionId = inserted[0].id;
        await tx.insert(mrbDispositionLabel).values(
          line.labels.map((l) => ({
            mrbId,
            dispositionId,
            receiptId: l.receiptId,
            receiptNo: l.receiptNo,
            qrContent: l.qrContent,
            quantity: l.quantity,
            createdBy: operator.userId,
            updatedBy: operator.userId,
          })),
        );
      }

      if (reviewers) await this.replaceReviewers(tx, mrbId, reviewers);

      await tx
        .update(mrbReview)
        .set({
          planBy: operator.userId,
          planTime: now,
          // SQE 填写的真实不合格原因覆盖自动触发时的模板文案
          ...(failReason ? { failReason } : {}),
          // 无责任人 / 原责任人不是 SQE（管理员或 IQC 代发起）时，保存即认领
          ...(mrb.sqeId !== operator.userId ? { sqeId: operator.userId } : {}),
        })
        .where(eq(mrbReview.id, mrbId));

      if (submit) {
        // 方案确定 → 进入评审；评审员全部提交后再由 submitReview 推 pending_final
        await this.transition(tx, mrbId, mrb.status, 'reviewing');
      }
    });

    return this.getMrbDetail(mrbId);
  }

  /** 读方案：处置行 + 二维码分摊 + 评审员 */
  async getPlan(mrbId: string): Promise<{
    mrbId: string;
    status: string;
    quantity: string;
    planBy?: string | null;
    planTime?: Date | null;
    failReason?: string | null;
    dispositions: any[];
    reviewers: any[];
  }> {
    const mrb = await this.loadMrb(mrbId);

    const dispRows = await this.db.execute(sql`
      SELECT id, disposition_type, other_type, ref_no, hold_until, quantity, unit,
             exec_status, remark, sort_order
      FROM mrb_disposition
      WHERE mrb_id = ${mrbId}::uuid
      ORDER BY sort_order
    `);

    const labelRows = await this.db.execute(sql`
      SELECT disposition_id, receipt_id, receipt_no, qr_content, quantity
      FROM mrb_disposition_label
      WHERE mrb_id = ${mrbId}::uuid
      ORDER BY receipt_no
    `);

    const labelMap = new Map<string, any[]>();
    for (const r of labelRows as unknown as Array<Record<string, any>>) {
      const arr = labelMap.get(r.disposition_id) || [];
      arr.push({
        receiptId: r.receipt_id,
        receiptNo: r.receipt_no,
        qrContent: r.qr_content,
        quantity: Number(r.quantity),
      });
      labelMap.set(r.disposition_id, arr);
    }

    const reviewers = await this.db.execute(sql`
      SELECT r.id, (r.reviewer_id).user_id AS reviewer_id, r.reviewer_role,
             r.review_result, r.review_opinion, r.review_time,
             a.name AS reviewer_name
      FROM mrb_reviewer r
      LEFT JOIN sys_account a ON a.id = ((r.reviewer_id).user_id)::uuid
      WHERE r.mrb_id = ${mrbId}::uuid
      ORDER BY r.sort_order
    `);

    return {
      mrbId,
      status: mrb.status,
      quantity: mrb.quantity,
      planBy: mrb.planBy ?? null,
      planTime: mrb.planTime ?? null,
      failReason: mrb.failReason ?? null,
      dispositions: (dispRows as unknown as Array<Record<string, any>>).map((d) => ({
        id: d.id,
        dispositionType: d.disposition_type,
        otherType: d.other_type,
        refNo: d.ref_no,
        holdUntil: d.hold_until,
        quantity: Number(d.quantity),
        unit: d.unit,
        execStatus: d.exec_status,
        remark: d.remark,
        labels: labelMap.get(d.id) || [],
      })),
      reviewers: (reviewers as unknown as Array<Record<string, any>>).map((r) => ({
        id: r.id,
        reviewerId: r.reviewer_id,
        reviewerName: r.reviewer_name,
        reviewerRole: r.reviewer_role,
        reviewResult: r.review_result,
        reviewOpinion: r.review_opinion,
        reviewTime: r.review_time,
      })),
    };
  }

  /** 方案制定权限：SQE 本人或管理员 */
  private async assertPlanPermission(mrb: any, operator: MrbOperator): Promise<void> {
    if (operator.roleCode === 'admin') return;
    if (operator.roleCode !== 'sqe') {
      throw new ForbiddenException('仅 SQE 可制定 MRB 处置方案');
    }
    if (!operator.userId) {
      throw new ForbiddenException('未获取到登录用户');
    }
    if (!mrb.sqeId || mrb.sqeId === operator.userId) return;

    // 责任人不是「在职 SQE」时允许当前 SQE 接手：
    // 历史单由管理员 / IQC 主管代发起，sqe_id 记的是他们，任何 SQE 都改不了。
    const ownerRows = await this.db
      .select({ roleCode: sysAccount.roleCode, status: sysAccount.status })
      .from(sysAccount)
      .where(or(
        eq(sysAccount.platformUserId, mrb.sqeId),
        sql`${sysAccount.id}::text = ${mrb.sqeId}`,
      ))
      .limit(1);
    const owner = ownerRows[0];
    const ownerIsActiveSqe = owner?.roleCode === 'sqe' && owner?.status === 'active';
    if (ownerIsActiveSqe) {
      throw new ForbiddenException('只能制定本人负责的 MRB 方案');
    }
    // 允许认领：责任人不是 SQE（或已停用），下面把 sqe_id 改成当前用户
  }

  /**
   * 提交时该落到哪个状态（设计文档 §1.4）：
   *  - 无评审员            → pending_review（待指派）
   *  - 有评审员但未评完    → reviewing（可立即续评）
   *  - 全部评完            → 急件 pending_final / 非急件 pending_approval
   */
  private async resolveSubmitTarget(tx: any, mrbId: string): Promise<MrbStatus> {
    const reviewers = await tx
      .select({ reviewResult: mrbReviewer.reviewResult })
      .from(mrbReviewer)
      .where(eq(mrbReviewer.mrbId, mrbId));

    if (reviewers.length === 0) return 'pending_review';

    const allSubmitted = reviewers.every(
      (r: any) => r.reviewResult !== null && r.reviewResult !== undefined && r.reviewResult !== '',
    );
    if (!allSubmitted) return 'reviewing';

    const rows = await tx
      .select({ isUrgent: mrbReview.isUrgent })
      .from(mrbReview)
      .where(eq(mrbReview.id, mrbId))
      .limit(1);
    if (rows[0]?.isUrgent) return 'pending_final';
    // MRB v3.1：默认启用 IQC 主管审核节点（评审员评审完 → IQC主管审核 → 质量经理审批）。
    // 如需回到「评审完直接终审」，显式设置 MRB_REQUIRE_PRE_APPROVAL=false。
    // ⚠️ 默认值从「跳过」改为「启用」：跳过时 IQC 主管没有任何审核/驳回入口，
    //    与业务要求的两级审批不符。
    return process.env.MRB_REQUIRE_PRE_APPROVAL === 'false' ? 'pending_final' : 'pending_approval';
  }

  /** 指派评审员：draft 保持 draft；pending_review → reviewing */
  async assignReviewers(params: {
    mrbId: string;
    reviewers: MrbReviewerInput[];
    operator: MrbOperator;
  }): Promise<MrbReview> {
    const { mrbId, reviewers, operator } = params;

    const mrb = await this.loadMrb(mrbId);
    if (!['draft', 'pending_review'].includes(mrb.status)) {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status as MrbStatus] || mrb.status}）不可执行该操作`,
      );
    }
    // 归属：发起人本人，或 iqc_manager / quality_manager / admin
    if (!['iqc_manager', 'quality_manager', 'admin'].includes(operator.roleCode)) {
      this.assertInitiator(mrb, operator);
    }
    if (!reviewers || reviewers.length === 0) {
      throw new BadRequestException('请至少选择一位评审人员');
    }

    const resolved = await this.resolveReviewers(reviewers);

    await this.db.transaction(async (tx) => {
      await this.replaceReviewers(tx, mrbId, resolved);
      if (mrb.status === 'pending_review') {
        await this.transition(tx, mrbId, 'pending_review', 'reviewing');
      }
      // draft：状态不变，status_since 也不刷新（还是「建单未提交」的钟）
    });

    return this.getMrbDetail(mrbId);
  }

  /** 提交草稿：draft → (pending_review | reviewing | pending_approval | pending_final) */
  async submitMrb(params: { mrbId: string; operator: MrbOperator }): Promise<MrbReview> {
    const { mrbId, operator } = params;
    const mrb = await this.loadMrb(mrbId);

    if (mrb.status !== 'draft') {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status as MrbStatus] || mrb.status}）不可执行该操作，仅草稿状态可提交`,
      );
    }
    this.assertInitiator(mrb, operator);

    const reviewerRows = await this.db
      .select({ id: mrbReviewer.id })
      .from(mrbReviewer)
      .where(eq(mrbReviewer.mrbId, mrbId));
    if (reviewerRows.length === 0) {
      throw new BadRequestException('请先指派评审员');
    }
    // v3.1：没有处置方案不许进评审 —— 否则会产生「评审中但方案为空」的死单
    await this.assertPlanComplete(mrb);

    await this.db.transaction(async (tx) => {
      const target = await this.resolveSubmitTarget(tx, mrbId);
      await this.transition(tx, mrbId, 'draft', target);
    });

    return this.getMrbDetail(mrbId);
  }

  /**
   * 方案完整性校验（提交评审前）：至少一条处置，且分摊合计 == 本单评审数量。
   *
   * 为什么放在 service 而不是只靠 savePlan：`initiate` / `submit` 都能让单据进评审，
   * 只要有一条路径没校验，就会出现「已评审、无方案」的单（历史已踩坑）。
   */
  private async assertPlanComplete(mrb: any): Promise<void> {
    const rows = await this.db.execute(sql`
      SELECT COALESCE(SUM(quantity), 0) AS total, COUNT(*) AS cnt
      FROM mrb_disposition WHERE mrb_id = ${mrb.id}::uuid
    `);
    const row = (rows as unknown as Array<{ total: string; cnt: string }>)[0];
    const cnt = Number(row?.cnt || 0);
    if (cnt === 0) {
      throw new BadRequestException('请先制定处置方案（特采 / 返工 / 退货 / 报废的数量）再提交评审');
    }
    const sumScaled = this.toScaled(row?.total ?? 0);
    const totalScaled = this.toScaled(mrb.quantity);
    if (sumScaled !== totalScaled) {
      throw new BadRequestException(
        `方案分摊合计 ${this.fromScaled(sumScaled)} 与本次评审数量 ${this.fromScaled(totalScaled)} 不一致，请调整后再提交`,
      );
    }
  }

  /** 清空已投的评审意见（撤回 / 驳回后需重新评审） */
  private async clearReviewResults(tx: any, mrbId: string, operatorId?: string): Promise<void> {
    await tx
      .update(mrbReviewer)
      .set({
        reviewResult: null,
        reviewOpinion: null,
        reviewTime: null,
        updatedBy: operatorId ?? null,
      })
      .where(eq(mrbReviewer.mrbId, mrbId));
  }

  /**
   * 撤回方案（SQE）：reviewing → pending_review。
   *
   * 与「作废」的区别：
   *  - 撤回只把单子拉回「待制定方案」，单据继续存活、方案数据保留，改完可重新提交；
   *  - 作废是终态，单据不再参与任何流程。
   *
   * 已投的评审意见会被清空：方案既然要改，旧结论就失去依据，必须重新评审。
   */
  async withdrawMrb(params: {
    mrbId: string;
    reason: string;
    operator: MrbOperator;
  }): Promise<MrbReview> {
    const { mrbId, operator } = params;
    const reason = (params.reason || '').trim();

    const mrb = await this.loadMrb(mrbId);
    if (mrb.status !== 'reviewing') {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status as MrbStatus] || mrb.status}）不可撤回，仅「评审中」可撤回`,
      );
    }
    this.assertInitiator(mrb, operator, { allowQualityManager: true });

    if (reason.length < MIN_CANCEL_REASON_LEN) {
      throw new BadRequestException(`请填写撤回原因（至少 ${MIN_CANCEL_REASON_LEN} 个字）`);
    }

    await this.db.transaction(async (tx) => {
      await this.transition(tx, mrbId, 'reviewing', 'pending_review', {
        withdrawReason: reason,
        withdrawBy: operator.userId,
        withdrawTime: new Date(),
        // 撤回后重新提交要重新走审批，清掉旧的预审结论
        completenessResult: null,
        completenessBy: null,
        completenessTime: null,
        completenessRemark: null,
      });
      await this.clearReviewResults(tx, mrbId, operator.userId);
    });

    return this.getMrbDetail(mrbId);
  }

  /**
   * 驳回（IQC 主管预审 / 质量经理终审）：pending_approval / pending_final → pending_review。
   *
   * 与「否决并全批退货」的区别：
   *  - 驳回 = 方案有问题，退回 SQE 修改，**不产生任何库存变动、不生成退货单**；
   *  - 否决 = 业务结论，终态 rejected，按全批退货执行（见 `rejectMrb`）。
   *
   * 评审员已投的意见一并清空，重新提交后需要重新评审。
   */
  async returnBackMrb(params: {
    mrbId: string;
    reason: string;
    operator: MrbOperator;
  }): Promise<MrbReview> {
    const { mrbId, operator } = params;
    const reason = (params.reason || '').trim();

    const mrb = await this.loadMrb(mrbId);
    const from = mrb.status as MrbStatus;
    if (!['pending_approval', 'pending_final'].includes(from)) {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[from] || from}）不可驳回，仅审批节点（IQC主管审核 / 质量经理审批）可驳回`,
      );
    }
    // 岗位与节点强绑定：预审只能 IQC 主管驳回，终审只能质量经理驳回（admin 均可）
    if (from === 'pending_approval' && !['iqc_manager', 'admin'].includes(operator.roleCode)) {
      throw new ForbiddenException('IQC 主管审核节点仅 IQC 主管可驳回');
    }
    if (from === 'pending_final' && !['quality_manager', 'admin'].includes(operator.roleCode)) {
      throw new ForbiddenException('质量经理审批节点仅质量经理可驳回');
    }

    if (reason.length < MIN_CANCEL_REASON_LEN) {
      throw new BadRequestException(`请填写驳回原因（至少 ${MIN_CANCEL_REASON_LEN} 个字）`);
    }

    await this.db.transaction(async (tx) => {
      await this.transition(tx, mrbId, from, 'pending_review', {
        returnReason: reason,
        returnBy: operator.userId,
        returnTime: new Date(),
        returnFrom: from,
        // 驳回后按新方案重走审批链
        completenessResult: null,
        completenessBy: null,
        completenessTime: null,
        completenessRemark: null,
      });
      await this.clearReviewResults(tx, mrbId, operator.userId);
    });

    return this.getMrbDetail(mrbId);
  }

  /** 作废：仅 draft / pending_review / reviewing；必填原因（≥5 字）；库存与明细零变动 */
  async cancelMrb(params: {
    mrbId: string;
    reason: string;
    operator: MrbOperator;
  }): Promise<MrbReview> {
    const { mrbId, operator } = params;
    const reason = (params.reason || '').trim();

    const mrb = await this.loadMrb(mrbId);

    if ((MRB_DONE_STATUSES as readonly string[]).includes(mrb.status)) {
      throw new BadRequestException('已结案单据不可作废');
    }
    if (!MRB_CANCELLABLE_STATUSES.includes(mrb.status)) {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status as MrbStatus] || mrb.status}）不可执行该操作`,
      );
    }
    this.assertInitiator(mrb, operator, { allowQualityManager: true });

    if (reason.length < MIN_CANCEL_REASON_LEN) {
      throw new BadRequestException('请填写作废原因（至少 5 个字）');
    }

    await this.db.transaction(async (tx) => {
      await this.transition(tx, mrbId, mrb.status as MrbStatus, 'cancelled', {
        cancelReason: reason,
        cancelBy: operator.userId,
        cancelTime: new Date(),
      });
    });

    return this.getMrbDetail(mrbId);
  }

  // =========================================================================
  // 七、T4 评审与预审
  // =========================================================================

  async getMyTasks(params: {
    page: number;
    pageSize: number;
    reviewerId: string;
    status?: string;
  }): Promise<PaginatedResponse<MrbReview & { myReview?: MrbReviewer }>> {
    const { page, pageSize, reviewerId, status } = params;

    const conditions: any[] = [];
    conditions.push(await this.reviewerMatchCondition(reviewerId));
    if (status) conditions.push(eq(mrbReview.status, status));

    const baseQuery = this.db
      .select({
        mrb: {
          id: mrbReview.id,
          mrbNo: mrbReview.mrbNo,
          lotId: mrbReview.lotId,
          materialId: mrbReview.materialId,
          supplierId: mrbReview.supplierId,
          batchNo: mrbReview.batchNo,
          quantity: mrbReview.quantity,
          unit: mrbReview.unit,
          failReason: mrbReview.failReason,
          status: mrbReview.status,
          finalDecision: mrbReview.finalDecision,
          sqeId: mrbReview.sqeId,
          sqeName: sql<string>`(SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_review.sqe_id).user_id)`.as('sqe_name'),
          qualityManagerId: mrbReview.qualityManagerId,
          qualityManagerName: sql<string>`(SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_review.quality_manager_id).user_id)`.as('quality_manager_name'),
          finalApprovalTime: mrbReview.finalApprovalTime,
          finalRemark: mrbReview.finalRemark,
          remark: mrbReview.remark,
          statusSince: mrbReview.statusSince,
          isUrgent: mrbReview.isUrgent,
          urgentReason: mrbReview.urgentReason,
        },
        lotNo: iqcLot.lotNo,
        materialCode: material.materialCode,
        materialName: material.materialName,
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        myReview: {
          id: mrbReviewer.id,
          mrbId: mrbReviewer.mrbId,
          reviewerId: mrbReviewer.reviewerId,
          reviewerName: sql<string>`COALESCE((SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_reviewer.reviewer_id).user_id), (SELECT sa.name FROM sys_account sa WHERE sa.account = (mrb_reviewer.reviewer_id).user_id), (mrb_reviewer.reviewer_id).user_id)`.as('reviewer_name'),
          reviewerRole: mrbReviewer.reviewerRole,
          reviewOpinion: mrbReviewer.reviewOpinion,
          reviewResult: mrbReviewer.reviewResult,
          reviewTime: mrbReviewer.reviewTime,
          sortOrder: mrbReviewer.sortOrder,
        },
      })
      .from(mrbReviewer)
      .leftJoin(mrbReview, eq(mrbReviewer.mrbId, mrbReview.id))
      .leftJoin(iqcLot, eq(mrbReview.lotId, iqcLot.id))
      .leftJoin(material, eq(mrbReview.materialId, material.id))
      .leftJoin(supplier, eq(mrbReview.supplierId, supplier.id));

    const whereQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(mrbReviewer)
      .leftJoin(mrbReview, eq(mrbReviewer.mrbId, mrbReview.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    const items = await whereQuery
      .orderBy(desc(mrbReview.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return {
      items: items.map((item: any) => {
        const mrb = this.mapMrbRow({
          ...item.mrb,
          lotNo: item.lotNo,
          materialCode: item.materialCode,
          materialName: item.materialName,
          supplierCode: item.supplierCode,
          supplierName: item.supplierName,
        });
        const myReview = item.myReview ? this.mapReviewerRow(item.myReview) : undefined;
        return { ...mrb, myReview };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 提交评审意见：全员提交后按是否急件分流 pending_approval / pending_final */
  async submitReview(params: {
    reviewerId: string;
    mrbId: string;
    reviewOpinion: string;
    reviewResult: string;
  }): Promise<MrbReview> {
    const { reviewerId, mrbId, reviewOpinion } = params;

    if (!reviewerId) {
      throw new BadRequestException('评审员ID不能为空');
    }

    // 兼容 PDA / 旧前端的 accept / reject / deviation（设计文档 §0 记录的存量 bug）
    const rawResult = String(params.reviewResult || '').trim();
    const mapped = LEGACY_REVIEW_RESULT_MAP[rawResult];
    let reviewResult = mapped ?? rawResult;
    // MRB v3：评审员只对 SQE 的方案表态，不再自选处置结论。
    // 旧的四选一值（特采/退货/返工/报废）来自老 PDA 端，一律按「同意」落库，
    // 保留意见原文供终审参考，避免老客户端提交时报 400。
    const PLAN_REVIEW_RESULTS = ['agree', 'disagree'];
    if ((MRB_REVIEW_RESULTS as readonly string[]).includes(reviewResult)) {
      reviewResult = 'agree';
    }
    if (!PLAN_REVIEW_RESULTS.includes(reviewResult)) {
      throw new BadRequestException(
        `评审结论非法，仅支持：同意(agree)、有异议(disagree)`,
      );
    }
    if (reviewResult === 'disagree' && String(reviewOpinion || '').trim().length < MIN_REMARK_LEN) {
      throw new BadRequestException(`有异议时必须填写意见（至少 ${MIN_REMARK_LEN} 字）`);
    }

    const reviewerMatchSql = await this.reviewerMatchCondition(reviewerId);

    const reviewerResult = await this.db
      .select()
      .from(mrbReviewer)
      .where(and(eq(mrbReviewer.mrbId, mrbId), reviewerMatchSql))
      .limit(1);

    if (reviewerResult.length === 0) {
      throw new NotFoundException('您不是该MRB的评审人员');
    }

    const mrb = await this.loadMrb(mrbId);
    if (mrb.status !== 'reviewing') {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status as MrbStatus] || mrb.status}）不可执行该操作`,
      );
    }

    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(mrbReviewer)
        .set({ reviewOpinion, reviewResult, reviewTime: now })
        .where(and(eq(mrbReviewer.mrbId, mrbId), reviewerMatchSql));

      const allReviewers = await tx
        .select({ reviewResult: mrbReviewer.reviewResult })
        .from(mrbReviewer)
        .where(eq(mrbReviewer.mrbId, mrbId));

      const allSubmitted =
        allReviewers.length > 0 &&
        allReviewers.every(
          (r: any) => r.reviewResult !== null && r.reviewResult !== undefined && r.reviewResult !== '',
        );

      if (allSubmitted) {
        // 急件 / 默认跳过预审 → 直送终审（目标状态由 resolveSubmitTarget 统一决定）
        const target = await this.resolveSubmitTarget(tx, mrbId);
        await this.transition(tx, mrbId, 'reviewing', target);
      }
      // 未全部提交：状态不变（仍 reviewing），status_since 不刷新（保持真实滞留时长）
    });

    return this.getMrbDetail(mrbId);
  }

  /**
   * 资料齐全性预审（只核资料齐全，不核结论）。
   *  complete   : pending_approval → pending_final
   *  incomplete : pending_approval → draft（保留已收集的评审意见，不重走评审）
   *  skip       : 仅 admin；pending_approval → pending_final（completeness_result='skipped'）
   */
  async preApprove(params: {
    mrbId: string;
    result: 'complete' | 'incomplete' | 'skip';
    remark?: string;
    separationRemark?: string;
    operator: MrbOperator;
  }): Promise<MrbReview> {
    const { mrbId, operator } = params;
    const result = params.result;
    const remark = (params.remark || '').trim();

    const mrb = await this.loadMrb(mrbId);
    if (mrb.status !== 'pending_approval') {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status as MrbStatus] || mrb.status}）不可执行该操作`,
      );
    }

    if (result === 'complete') {
      await this.db.transaction(async (tx) => {
        await this.transition(tx, mrbId, 'pending_approval', 'pending_final', {
          completenessResult: 'complete',
          completenessBy: operator.userId,
          completenessTime: new Date(),
          completenessRemark: remark || null,
          ...(params.separationRemark ? { separationRemark: params.separationRemark } : {}),
        });
      });
      return this.getMrbDetail(mrbId);
    }

    if (remark.length < MIN_REMARK_LEN) {
      throw new BadRequestException(
        result === 'incomplete'
          ? '请填写资料不齐的退回说明（至少 5 个字）'
          : '请填写跳过预审的原因（至少 5 个字）',
      );
    }

    if (result === 'incomplete') {
      // v3.1：预审驳回 = 退回 SQE 改方案（pending_review），方案与评审员保留，
      // 已投的评审意见清空 —— 方案要改，旧结论失去依据，必须重新评审。
      await this.db.transaction(async (tx) => {
        await this.transition(tx, mrbId, 'pending_approval', 'pending_review', {
          completenessResult: 'incomplete',
          completenessBy: operator.userId,
          completenessTime: new Date(),
          completenessRemark: remark,
          returnReason: remark,
          returnBy: operator.userId,
          returnTime: new Date(),
          returnFrom: 'pending_approval',
        });
        await this.clearReviewResults(tx, mrbId, operator.userId);
      });
      return this.getMrbDetail(mrbId);
    }

    if (result === 'skip') {
      if (operator.roleCode !== 'admin') {
        throw new ForbiddenException('您没有权限执行此操作');
      }
      await this.db.transaction(async (tx) => {
        await this.transition(tx, mrbId, 'pending_approval', 'pending_final', {
          completenessResult: 'skipped',
          completenessBy: operator.userId,
          completenessTime: new Date(),
          completenessRemark: remark,
        });
      });
      return this.getMrbDetail(mrbId);
    }

    throw new BadRequestException('预审结果仅支持：complete / incomplete / skip');
  }

  // =========================================================================
  // 八、T5 终审重构（其他三类 + 守恒不可绕过 + 单人审批 + 驳回）
  // =========================================================================

  /**
   * 「其他」处置的三类必填校验。返回规范化后的 otherType / refNo / holdUntil。
   */
  private validateOtherLine(
    line: { dispositionType: MrbDispositionType; otherType?: string; refNo?: string; holdUntil?: string },
    index: number,
  ): { otherType: MrbOtherType; refNo?: string; holdUntil?: string } {
    const otherTypeRaw = (line.otherType || '').trim();
    if (!otherTypeRaw) {
      throw new BadRequestException(
        '其他处置必须选择具体去向：退回客户 / 转留样·样品 / 待定暂存',
      );
    }
    if (!(MRB_OTHER_TYPES as readonly string[]).includes(otherTypeRaw)) {
      throw new BadRequestException(
        '其他处置仅支持退回客户 / 转留样·样品 / 待定暂存；其它情形请走特批（本期未开放）',
      );
    }
    const otherType = otherTypeRaw as MrbOtherType;
    const refNo = (line.refNo || '').trim();
    const holdUntil = (line.holdUntil || '').trim();

    if (otherType === 'customer_return' && !refNo) {
      throw new BadRequestException('退回客户必须填写关联单号');
    }
    if (otherType === 'sample' && !refNo) {
      throw new BadRequestException('转留样/样品必须填写留样编号');
    }
    if (otherType === 'hold') {
      if (!holdUntil) {
        throw new BadRequestException('待定暂存必须填写复核日期');
      }
      const parsed = new Date(`${holdUntil}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('待定暂存必须填写复核日期');
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const minDay = new Date(today);
      minDay.setDate(minDay.getDate() + 1);
      const maxDay = new Date(today);
      maxDay.setDate(maxDay.getDate() + 90);
      if (parsed < minDay) throw new BadRequestException('复核日期至少为明天');
      if (parsed > maxDay) throw new BadRequestException('复核日期不得超过 90 天');
    }

    return {
      otherType,
      refNo: refNo || undefined,
      holdUntil: otherType === 'hold' ? holdUntil : undefined,
    };
  }

  /** 留样编号唯一性（限定 other_type='sample' 且未取消的明细，避免历史脏值阻塞） */
  private async assertSampleRefNoUnique(refNo: string, mrbId: string): Promise<void> {
    const dup = await this.db
      .select({ id: mrbDisposition.id })
      .from(mrbDisposition)
      .where(
        and(
          eq(mrbDisposition.otherType, 'sample'),
          eq(mrbDisposition.refNo, refNo),
          ne(mrbDisposition.execStatus, 'cancelled'),
          ne(mrbDisposition.mrbId, mrbId),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictException(`留样编号 ${refNo} 已存在`);
    }
  }

  /**
   * 单人审批（预审人 == 终审人）的代审说明校验。
   * 库里没有 quality_manager 账号，iqc_manager 既预审又终审会是常态，
   * 硬分离会让流程无人可走，因此改为「软分离」：强制填写 2~200 字代审说明。
   */
  private assertSeparationRemark(mrb: any, operator: MrbOperator, remark?: string): string | null {
    const completenessById = this.readUserProfileId(mrb.completenessBy);
    const samePerson = !!completenessById && completenessById === operator.userId;
    if (!samePerson) return null;

    const value = (remark || '').trim();
    if (value.length < SEPARATION_REMARK_MIN || value.length > SEPARATION_REMARK_MAX) {
      throw new BadRequestException('预审人与终审人为同一人，请填写代审说明（2~200 字）');
    }
    return value;
  }

  /**
   * 终审。
   *
   * 硬约束：
   *  1. Σ(处置数量) 必须严格等于**本单数量** `mrb_review.quantity`（整数比较，不留 eps）；
   *  2. 明细为空一律 400「请填写处置明细」——已删除原「lines=[] → closed」静默结案分支；
   *  3. `final_decision` 取「主处置」（数量最大的一行，并列取 sortOrder 最小）；
   *  4. 「其他」三类把数量搬到**本单专属**保留库位并打 `MRB-OTHER:<mrbNo>`，不核销库存。
   */
  async finalApprove(params: {
    mrbId: string;
    finalResult?: 'special_admit' | 'return' | 'rework' | 'scrap' | 'other';
    finalRemark?: string;
    separationRemark?: string;
    approverId: string;
    approverName?: string;
    roleCode?: string;
    /** 拆分处置明细 */
    dispositions?: MrbDispositionInput[];
    /**
     * 终审否决模式（MRB v3）：否决 = 全批退货。
     * 内部把本单数量 N 当作一条隐式退货处置，复用下方同一条执行链，
     * 只是终态落 `rejected` 且欠料来源记为 `mrb_reject`。
     */
    rejectMode?: boolean;
  }): Promise<MrbReview> {
    const { mrbId, finalResult, finalRemark, approverId, dispositions, rejectMode } = params;

    const mrb = await this.loadMrb(mrbId);
    if (mrb.status === 'pending_approval') {
      throw new BadRequestException('尚未完成资料齐全性预审，不能终审');
    }
    if (mrb.status !== 'pending_final') {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status as MrbStatus] || mrb.status}）不可执行该操作`,
      );
    }

    const operator: MrbOperator = {
      userId: approverId,
      roleCode: params.roleCode || '',
      name: params.approverName,
    };
    const separationRemark = this.assertSeparationRemark(mrb, operator, params.separationRemark);

    // ---------- 1. 处置明细：优先采用 SQE 已提交的方案 ----------
    // MRB v3 起，处置方案由 SQE 在「方案制定」环节落库（exec_status='planned'）。
    // 终审只做通过/否决，不再现场录明细；入参 dispositions 仅用于兼容老前端与存量单据。
    const planRows = await this.db
      .select()
      .from(mrbDisposition)
      .where(and(eq(mrbDisposition.mrbId, mrbId), eq(mrbDisposition.execStatus, 'planned')))
      .orderBy(mrbDisposition.sortOrder);

    const planMode =
      !rejectMode && planRows.length > 0 && (!dispositions || dispositions.length === 0);

    const lines: PlannedLine[] = [];
    if (rejectMode) {
      // 否决 = 全批退货：原方案作废，本单数量 N 整体转一条退货处置
      await this.db
        .update(mrbDisposition)
        .set({ execStatus: 'cancelled', updatedBy: approverId || null })
        .where(
          and(eq(mrbDisposition.mrbId, mrbId), eq(mrbDisposition.execStatus, 'planned')),
        );
      lines.push({
        type: 'return',
        qtyScaled: this.toScaled(mrb.quantity),
        remark: '终审否决，全批转退货',
        allocs: [],
      });
    } else if (planMode) {
      for (const r of planRows) {
        lines.push({
          type: r.dispositionType as MrbDispositionType,
          qtyScaled: this.toScaled(r.quantity),
          otherType: (r.otherType as MrbOtherType) ?? undefined,
          refNo: r.refNo ?? undefined,
          holdUntil: r.holdUntil ?? undefined,
          remark: r.remark ?? undefined,
          allocs: [],
          dispositionId: r.id,
        });
      }
    }
    for (const [index, d] of (dispositions || []).entries()) {
      if (planMode || rejectMode) break;
      if (!d || !d.dispositionType) continue;
      const scaled = this.toScaled(d.quantity);
      // 数量为 0 的行直接丢弃（前端常带一条空行），负数留给下面的守恒校验报错
      if (scaled === 0) continue;

      const type = d.dispositionType;
      if (!EXECUTABLE_DISPOSITIONS.includes(type)) {
        throw new BadRequestException(`不支持的处置方式：${type}`);
      }

      const line: PlannedLine = {
        type,
        remark: d.remark,
        allocs: [],
        qtyScaled: scaled,
      };
      if (type === 'other') {
        const other = this.validateOtherLine(d, index);
        line.otherType = other.otherType;
        line.refNo = other.refNo;
        line.holdUntil = other.holdUntil;
      }
      lines.push(line);
    }

    // 兼容旧入参：只传 finalResult、不传 dispositions 时按全量单行处理（other 除外）
    if (lines.length === 0 && finalResult && finalResult !== 'other') {
      if (!EXECUTABLE_DISPOSITIONS.includes(finalResult as MrbDispositionType)) {
        throw new BadRequestException(`不支持的处置方式：${finalResult}`);
      }
      lines.push({
        type: finalResult as MrbDispositionType,
        allocs: [],
        qtyScaled: this.toScaled(mrb.quantity),
      });
    }

    // ---------- 2. 明细全空 → 400（禁止静默结案） ----------
    if (lines.length === 0) {
      throw new BadRequestException('请填写处置明细');
    }

    // ---------- 3. 数量守恒硬校验（基准 = 本单数量，不是批次总量） ----------
    // 整数比较，不写 Math.abs(a-b) < eps：numeric(18,4) 缩放 4 位后必然是整数
    const totalScaled = this.toScaled(mrb.quantity);
    let sumScaled = 0;
    for (const l of lines) {
      if (l.qtyScaled <= 0) {
        throw new BadRequestException(`处置数量必须大于 0（${this.dispositionTypeLabel(l)}）`);
      }
      sumScaled += l.qtyScaled;
    }
    if (sumScaled !== totalScaled) {
      throw new BadRequestException(
        `处置数量合计 ${this.fromScaled(sumScaled)} 必须等于本次评审数量 ${this.fromScaled(totalScaled)}`,
      );
    }

    // ---------- 4. 留样编号唯一性 ----------
    // (a) 跨单唯一：库里已有同号（排除本单，本单正在插入）→ 409
    // (b) 单内唯一：本次提交的多条 sample 明细互相重号 → 409
    //     （(a) 的 SQL 排除了本单，挡不住「同一次提交里两条一样」）
    const sampleRefSeen = new Set<string>();
    for (const l of lines) {
      if (l.type === 'other' && l.otherType === 'sample' && l.refNo) {
        const key = l.refNo.trim();
        if (sampleRefSeen.has(key)) {
          throw new ConflictException(`留样编号 ${key} 在本单内重复，请为每条留样填写唯一编号`);
        }
        sampleRefSeen.add(key);
        await this.assertSampleRefNoUnique(key, mrbId);
      }
    }

    // ---------- 5. 主处置 + 终态 ----------
    const needDownstream = lines.some((l) => this.needsDownstream(l));
    // 主处置 = 数量最大的一行；并列取先出现者（sortOrder 最小）
    const mainLine = lines.reduce(
      (best, l) => (l.qtyScaled > best.qtyScaled ? l : best),
      lines[0],
    );
    // 否决模式终态固定为 rejected（下游动作仍按退货执行）
    const finalStatus: MrbStatus = rejectMode
      ? 'rejected'
      : needDownstream
        ? 'pending_execute'
        : 'approved';
    const finalDecisionValue = rejectMode ? 'rejected' : mainLine.type;

    // 下游单据用的冗余信息
    const materialRow = await this.db
      .select({ code: material.materialCode, name: material.materialName })
      .from(material)
      .where(eq(material.id, mrb.materialId))
      .limit(1);
    const supplierRow = await this.db
      .select({ code: supplier.supplierCode, name: supplier.supplierName })
      .from(supplier)
      .where(eq(supplier.id, mrb.supplierId))
      .limit(1);

    const matchBatchNo = this.normalizeBatchNo(mrb.batchNo);
    const now = new Date();

    await this.db.transaction(async (tx) => {
      // ---------- 6. 状态 CAS（pending_final → approved / pending_execute） ----------
      const extra: Record<string, unknown> = {
        finalDecision: finalDecisionValue,
        qualityManagerId: approverId,
        finalApprovalTime: now,
        finalRemark: finalRemark ?? null,
      };
      if (separationRemark) extra.separationRemark = separationRemark;
      await this.transition(tx, mrbId, 'pending_final', finalStatus, extra);

      // ---------- 7. 候选库存：不良品仓可评审行优先，其次良品仓锁定行 ----------
      // 与 getPendingLots / initiateMrb 共用 disposalCandidateCond（排除 MRB-OTHER 占用）
      await tx.execute(sql`
        SELECT id FROM inventory
        WHERE material_id = ${mrb.materialId}::uuid
          AND supplier_id = ${mrb.supplierId}::uuid
          AND batch_no = ${matchBatchNo}
          AND ${disposalCandidateCond('inventory')}
        FOR UPDATE
      `);

      const candidates = (
        await tx.execute<{
          id: string;
          material_id: string;
          location_id: string;
          batch_no: string;
          supplier_id: string | null;
          quantity: string;
          unit: string;
          stock_status: string;
          production_date: string | null;
          label_no: string | null;
          locked: boolean;
        }>(sql`
          SELECT id, material_id, location_id, batch_no, supplier_id, quantity, unit,
                 stock_status, production_date, label_no, locked
          FROM inventory
          WHERE material_id = ${mrb.materialId}::uuid
            AND supplier_id = ${mrb.supplierId}::uuid
            AND batch_no = ${matchBatchNo}
            AND ${disposalCandidateCond('inventory')}
          ORDER BY (stock_status = 'defective') DESC, location_id
        `)
      ).map((r: any) => ({
        row: {
          id: r.id,
          materialId: r.material_id,
          locationId: r.location_id,
          batchNo: r.batch_no,
          supplierId: r.supplier_id,
          quantity: r.quantity,
          unit: r.unit,
          stockStatus: r.stock_status,
          productionDate: r.production_date,
          labelNo: r.label_no,
        },
        remaining: this.toScaled(r.quantity),
        src: (r.stock_status === 'defective' ? 'defective' : 'locked_good') as
          | 'defective'
          | 'locked_good',
      }));

      const availableScaled = candidates.reduce((s, c) => s + c.remaining, 0);
      if (availableScaled < sumScaled) {
        throw new BadRequestException(
          `可处置库存不足：需要 ${this.fromScaled(sumScaled)}，当前仅 ${this.fromScaled(availableScaled)}`,
        );
      }

      // ---------- 8. 按明细顺序分配数量 ----------
      for (const l of lines) {
        let need = l.qtyScaled;
        for (const c of candidates) {
          if (need <= 0) break;
          if (c.remaining <= 0) continue;
          const take = Math.min(need, c.remaining);
          l.allocs.push({ row: c.row, qtyScaled: take, src: c.src });
          c.remaining -= take;
          need -= take;
        }
        if (need > 0) {
          throw new BadRequestException(`处置数量超出可分配库存：缺少 ${this.fromScaled(need)}`);
        }
      }

      // ---------- 9. 先从来源行扣减 ----------
      const consumedByRow = new Map<string, number>();
      for (const p of lines) {
        for (const a of p.allocs) {
          consumedByRow.set(a.row.id, (consumedByRow.get(a.row.id) || 0) + a.qtyScaled);
        }
      }
      for (const [rowId, consumed] of consumedByRow.entries()) {
        const src = candidates.find((c) => c.row.id === rowId);
        if (!src) continue;
        const origScaled = this.toScaled(src.row.quantity);
        const remainder = origScaled - consumed;
        if (remainder > 0) {
          await tx
            .update(inventory)
            .set({ quantity: this.fromScaled(remainder) })
            .where(eq(inventory.id, rowId));
        } else {
          await tx.delete(inventory).where(eq(inventory.id, rowId));
        }
      }

      // ---------- 10. 目标库位 / 下游单号 ----------
      // 特采已改为原地解封，不再需要良品仓目标库位
      const reserveLoc = lines.some((p) => p.type === 'other')
        ? await this.getReserveLocation(mrb.mrbNo)
        : null;

      const returnLines = lines.filter((p) => p.type === 'return');
      const reworkLines = lines.filter((p) => p.type === 'rework');
      const returnNo = returnLines.length > 0 ? await this.generateReturnNo(tx) : null;
      const reworkNo = reworkLines.length > 0 ? await this.generateReworkNo(tx) : null;

      // ---------- 11. 落库处置明细 ----------
      // 方案已存在（planMode）时只更新执行状态，绝不重复插入——
      // 否则同一张单会出现两套处置行，库存对账必然对不上。
      let sortOrder = 0;
      for (const p of lines) {
        const qtyScaled = p.allocs.reduce((s, a) => s + a.qtyScaled, 0);
        const isPending = this.needsDownstream(p);
        if (p.dispositionId) {
          await tx
            .update(mrbDisposition)
            .set({
              quantity: this.fromScaled(qtyScaled),
              execStatus: isPending ? 'pending' : 'done',
              execTime: isPending ? null : now,
              sortOrder: sortOrder++,
              updatedBy: approverId || null,
            })
            .where(eq(mrbDisposition.id, p.dispositionId));
          continue;
        }
        const inserted = await tx
          .insert(mrbDisposition)
          .values({
            mrbId,
            dispositionType: p.type,
            otherType: p.otherType ?? null,
            refNo: p.refNo ?? null,
            holdUntil: p.holdUntil ?? null,
            quantity: this.fromScaled(qtyScaled),
            unit: mrb.unit,
            execStatus: isPending ? 'pending' : 'done',
            execTime: isPending ? null : now,
            remark: p.remark ?? null,
            sortOrder: sortOrder++,
            createdBy: approverId || null,
            updatedBy: approverId || null,
          })
          .returning({ id: mrbDisposition.id });
        p.dispositionId = inserted[0].id;
      }

      // ---------- 12. 落到目标库存行 + 写库存流水 ----------
      const touched: Array<{
        line: PlannedLine;
        alloc: InventoryAlloc;
        rowId: string;
        qtyScaled: number;
      }> = [];

      for (const p of lines) {
        for (const a of p.allocs) {
          const src = a.row;
          let destLocId = src.locationId;
          let destStatus = 'good';
          let locked = false;
          let lockReason: string | null = null;
          let isSpecialAdmit: boolean | undefined;
          let specialAdmitRef: string | null | undefined;
          let setZero = false;
          let txType = 'mrb_special_admit';
          let qtyDelta = a.qtyScaled;
          let remark = '';

          if (p.type === 'special_admit') {
            // MRB v3：特采「原地解封」——库位不动，只把不良转回良品并解除锁定。
            // 少一次搬运，仓管不用再跑一趟。
            destStatus = 'good';
            locked = false;
            lockReason = null;
            isSpecialAdmit = true;
            specialAdmitRef = mrb.mrbNo;
            txType = 'mrb_special_admit';
            remark = `MRB特采放行 ${this.fromScaled(a.qtyScaled)}`;
          } else if (p.type === 'return') {
            // MRB v3：退货不再把库存改成 returned，而是**保持不良 + 锁定原库位**，
            // 由仓库按调拨任务搬到不良品仓后再出库。这样「仓库调拨」才有实际动作。
            //
            // 标记带的是**退货单号**而不是 MRB 单号：这批货最终由退货单消耗，
            // 供应商退货出库（supplier-return）要按它精确定位库存行
            // （调拨合并会让 item.inventory_id 失效，只能靠标记兜底）。
            destStatus = 'defective';
            locked = true;
            lockReason = buildReturnLockReason(returnNo as string);
            txType = 'mrb_return_freeze';
            remark = `MRB判定退货：待调拨不良品仓后出库 ${this.fromScaled(a.qtyScaled)}`;
          } else if (p.type === 'rework') {
            destStatus = 'rework';
            lockReason = reworkNo;
            txType = 'mrb_rework';
            remark = `MRB判定返工：转返工库存 ${this.fromScaled(a.qtyScaled)}`;
          } else if (p.type === 'other') {
            // 其他三类：搬到**本单专属**保留库位，不核销、不改 stock_status。
            // `lock_reason` 只带单号（`MRB-OTHER:<mrbNo>`），不带去向：
            // 同单多条 other 明细共用一行承载（数量累加），去向唯一事实来源是 mrb_disposition。
            destLocId = reserveLoc!.id;
            destStatus = src.stockStatus;
            locked = true;
            lockReason = buildOtherLockReason(mrb.mrbNo);
            txType = `mrb_other_${p.otherType}`;
            remark = `MRB其他处置（${MRB_OTHER_TYPE_LABELS[p.otherType!]}）转保留位 ${this.fromScaled(a.qtyScaled)}`;
          } else {
            // MRB v3：报废改为「调拨到不良品仓 → 销毁」，终审这一步**只冻结不核销**。
            //
            // 为什么用 `stock_status='scrapped'` 而不是 `defective`：
            //  inventory 唯一键是 (物料, 库位, 批次, **状态**)。退货和报废若都落 `defective`，
            //  同库位同批次的 120 报废 + 80 退货会被 upsert **合并成一行 200**，
            //  后写的 lock_reason 覆盖前一个 → 销毁时找不到报废量、退货出库也分不清。
            //  用独立的 `scrapped` 状态天然分桶：报废行与退货行各自独立，
            //  可评审量（只认 `defective`）也自动不会把待销毁的量算进去。
            //
            // `quantity` 一分不减：真正核销发生在 destroyScrap()（仓管确认销毁）。
            destStatus = 'scrapped';
            locked = true;
            lockReason = buildScrapLockReason(mrb.mrbNo);
            txType = 'mrb_scrap_freeze';
            qtyDelta = a.qtyScaled;
            remark = `MRB判定报废：待调拨不良品仓后销毁 ${this.fromScaled(a.qtyScaled)}`;
          }

          const dest = await this.upsertInventoryRow(tx, {
            materialId: src.materialId,
            locationId: destLocId,
            batchNo: src.batchNo,
            supplierId: src.supplierId,
            stockStatus: destStatus,
            unit: src.unit,
            productionDate: src.productionDate,
            deltaScaled: a.qtyScaled,
            setZero,
            locked,
            lockReason,
            isSpecialAdmit,
            specialAdmitRef,
          });

          await this.writeInventoryTx(tx, {
            row: { ...src, id: dest.id, locationId: destLocId, stockStatus: destStatus },
            txType,
            qtyDelta,
            balanceAfter: dest.quantityScaled,
            txNo: mrb.mrbNo,
            remark,
            operatorId: approverId,
          });

          touched.push({ line: p, alloc: a, rowId: dest.id, qtyScaled: a.qtyScaled });
        }
      }

      // ---------- 13. 下游单据：退货出库单 ----------
      if (returnLines.length > 0) {
        const totalReturnScaled = returnLines.reduce(
          (s, p) => s + p.allocs.reduce((x, a) => x + a.qtyScaled, 0),
          0,
        );
        const orderInserted = await tx
          .insert(supplierReturnOrder)
          .values({
            returnNo: returnNo as string,
            mrbId,
            dispositionId: returnLines[0].dispositionId ?? null,
            supplierId: mrb.supplierId,
            supplierCode: supplierRow[0]?.code ?? null,
            supplierName: supplierRow[0]?.name ?? null,
            batchNo: mrb.batchNo ?? null,
            status: 'pending_out',
            totalQty: this.fromScaled(totalReturnScaled),
            outQty: '0',
            unit: mrb.unit,
            remark: rejectMode
              ? `MRB ${mrb.mrbNo} 终审否决，整批退货生成`
              : `由 MRB ${mrb.mrbNo} 判定退货生成`,
            createdBy: approverId || null,
            updatedBy: approverId || null,
          })
          .returning({ id: supplierReturnOrder.id });

        let itemSort = 0;
        for (const t of touched.filter((x) => x.line.type === 'return')) {
          await tx.insert(supplierReturnItem).values({
            orderId: orderInserted[0].id,
            materialId: mrb.materialId,
            materialCode: materialRow[0]?.code ?? null,
            materialName: materialRow[0]?.name ?? null,
            batchNo: t.alloc.row.batchNo ?? null,
            locationId: t.alloc.row.locationId,
            inventoryId: t.rowId,
            quantity: this.fromScaled(t.qtyScaled),
            outQty: '0',
            unit: mrb.unit,
            dispositionId: t.line.dispositionId ?? null,
            sortOrder: itemSort++,
          });
        }
      }

      // ---------- 13.5 供应商欠料 + 不良品调拨任务（MRB v3） ----------
      await this.writeDebtAndMoveTasks(tx, {
        mrb,
        lines,
        materialCode: materialRow[0]?.code ?? null,
        materialName: materialRow[0]?.name ?? null,
        supplierCode: supplierRow[0]?.code ?? null,
        supplierName: supplierRow[0]?.name ?? null,
        operatorId: approverId,
        sourceKind: rejectMode ? 'reject' : 'mrb',
      });

      // ---------- 14. 下游单据：返工单 ----------
      if (reworkLines.length > 0) {
        const totalReworkScaled = reworkLines.reduce(
          (s, p) => s + p.allocs.reduce((x, a) => x + a.qtyScaled, 0),
          0,
        );
        const firstRework = touched.find((x) => x.line.type === 'rework');
        await tx.insert(reworkOrder).values({
          reworkNo: reworkNo as string,
          mrbId,
          dispositionId: reworkLines[0].dispositionId ?? null,
          materialId: mrb.materialId,
          materialCode: materialRow[0]?.code ?? null,
          materialName: materialRow[0]?.name ?? null,
          supplierId: mrb.supplierId,
          supplierCode: supplierRow[0]?.code ?? null,
          supplierName: supplierRow[0]?.name ?? null,
          batchNo: mrb.batchNo ?? null,
          quantity: this.fromScaled(totalReworkScaled),
          unit: mrb.unit,
          status: 'pending',
          sourceLocationId: firstRework?.alloc.row.locationId ?? null,
          remark: `由 MRB ${mrb.mrbNo} 判定返工生成`,
          createdBy: approverId || null,
          updatedBy: approverId || null,
        });
      }

      // ---------- 14.5 抄送 + 站内消息（MRB v3） ----------
      // 放在终审末尾统一发：此时退货/返工单号、欠料条数都已确定，
      // 消息正文能一次说清「判了什么 + 生成了哪些单」，抄送人不用再进单据里翻。
      await this.writeCcAndNotices(tx, {
        mrb,
        lines,
        approverId,
        rejectMode,
        returnNo,
        reworkNo,
        materialCode: materialRow[0]?.code ?? null,
        materialName: materialRow[0]?.name ?? null,
      });

      // ---------- 15. 归档即释放保留占用（arch.6 §7-5 / §7-13） ----------
      // `approved` = 全部明细都是即时类、没有下游执行环节，单子**当场归档、永不经过 closed**
      // （`closed` 只能由 syncExecutionStatus 从 pending_execute 收敛而来），所以这里必须释放，
      // 否则「100 全留样」这种最常见的单会永久占用保留位。
      // `pending_execute`（含退回客户待提走）不释放 —— 实物还没走，释放会造成「账上有货、库里没有」。
      // 另一个终态 `closed` 的释放挂在 syncExecutionStatus() 里（同一事务）。
      if (finalStatus === 'approved') {
        await this.releaseMrbReserve(tx, mrbId);
      }
    });

    return this.getMrbDetail(mrbId);
  }

  /** 该处置行是否仍需下游动作（决定 exec_status 与 MRB 落点） */
  private needsDownstream(line: PlannedLine): boolean {
    if (PENDING_DISPOSITIONS.includes(line.type)) return true;
    return line.type === 'other' && line.otherType === 'customer_return';
  }

  /** 处置方式中文名（错误文案用） */
  private dispositionTypeLabel(line: PlannedLine): string {
    const map: Record<string, string> = {
      special_admit: '特采',
      return: '退货',
      rework: '供应商返工',
      scrap: '报废',
      other: line.otherType ? `其他-${MRB_OTHER_TYPE_LABELS[line.otherType]}` : '其他',
    };
    return map[line.type] || line.type;
  }

  /** 驳回：pending_final → rejected；必填理由（≥5 字）；库存零变动 */
  /**
   * 终审否决（MRB v3）= 全批退货。
   *
   * 业务口径：质量经理按否决，等于认定「SQE 的方案不能用，这批货只能退给供应商」，
   * 所以不再单独写一套执行逻辑，直接复用 finalApprove 的退货链：
   * 生成退货单、登记供应商欠料、创建不良品调拨任务，只是终态落 `rejected`。
   */
  async rejectMrb(params: {
    mrbId: string;
    reason: string;
    separationRemark?: string;
    operator: MrbOperator;
  }): Promise<MrbReview> {
    const { mrbId, operator } = params;
    const reason = (params.reason || '').trim();

    const mrb = await this.loadMrb(mrbId);
    if (mrb.status !== 'pending_final') {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status as MrbStatus] || mrb.status}）不可执行该操作`,
      );
    }
    if (reason.length < MIN_REMARK_LEN) {
      throw new BadRequestException('请填写否决理由（至少 5 个字）');
    }
    this.assertSeparationRemark(mrb, operator, params.separationRemark);

    await this.finalApprove({
      mrbId,
      finalRemark: reason,
      separationRemark: params.separationRemark,
      approverId: operator.userId,
      approverName: operator.name,
      roleCode: operator.roleCode,
      dispositions: [],
      rejectMode: true,
    });

    return this.getMrbDetail(mrbId);
  }

  // =========================================================================
  // 九、T6 下游收敛
  // =========================================================================

  /**
   * 「其他-退回客户」确认已提走：核销保留库位库存 + 明细置 done + 全部 done 后结案。
   * 未提走前库存不得消失（这是与旧「静默结案」的本质差别）。
   */
  async confirmOut(params: {
    dispositionId: string;
    operator: MrbOperator;
  }): Promise<MrbReview> {
    const { dispositionId, operator } = params;

    const dispRows = await this.db
      .select()
      .from(mrbDisposition)
      .where(eq(mrbDisposition.id, dispositionId))
      .limit(1);
    if (dispRows.length === 0) throw new NotFoundException('处置明细不存在');
    const disp = dispRows[0];

    if (disp.dispositionType !== 'other') {
      throw new BadRequestException('仅「其他-退回客户」的处置明细需要确认提走');
    }
    if (disp.otherType !== 'customer_return') {
      throw new BadRequestException('仅「其他-退回客户」的处置明细需要确认提走');
    }
    if (disp.execStatus !== 'pending') {
      throw new BadRequestException('该处置明细已完成或已取消，无需重复确认');
    }

    const mrb = await this.loadMrb(disp.mrbId);
    // 保留行的占用标记只带单号；保留库位是**本单专属**的，两者共同定位唯一一组行
    const lockReason = buildOtherLockReason(mrb.mrbNo);
    const needScaled = this.toScaled(disp.quantity);
    if (needScaled <= 0) {
      throw new BadRequestException('处置数量异常，无法核销');
    }

    await this.db.transaction(async (tx) => {
      // ---------- 0. 先锁明细行、锁内重读状态（并发幂等的唯一正确做法） ----------
      // 事务外那次 `execStatus !== 'pending'` 只是快速失败，挡不住并发：
      // 两个请求可能都读到 pending，然后各自进事务、各扣一次（双花）。
      // 这里 `FOR UPDATE` 让后到者等前者提交，再读到的就是 done → 400。
      const lockedDisp = (await tx.execute(sql`
        SELECT id, disposition_type, other_type, exec_status, quantity
        FROM mrb_disposition
        WHERE id = ${dispositionId}::uuid
        FOR UPDATE
      `)) as unknown as Array<{
        id: string;
        disposition_type: string;
        other_type: string | null;
        exec_status: string;
        quantity: string;
      }>;
      const cur = lockedDisp?.[0];
      if (!cur) throw new NotFoundException('处置明细不存在');
      if (cur.disposition_type !== 'other' || cur.other_type !== 'customer_return') {
        throw new BadRequestException('仅「其他-退回客户」的处置明细需要确认提走');
      }
      if (cur.exec_status !== 'pending') {
        throw new BadRequestException('该处置明细已完成或已取消，无需重复确认');
      }
      // 数量以锁内重读为准（期间可能被别的流程调整过）
      const needLockedScaled = this.toScaled(cur.quantity);
      if (needLockedScaled <= 0) {
        throw new BadRequestException('处置数量异常，无法核销');
      }

      // 本单专属保留库位 + 单号级 lock_reason + 规范化批次三条件收窄：
      // 只按 lock_reason 查会把**别的 MRB**（历史共用一个保留库位时）或**别的批次**的行一起扣掉。
      const reserveLoc = await this.getReserveLocation(mrb.mrbNo);
      const rows = (await tx
        .select()
        .from(inventory)
        .where(
          and(
            eq(inventory.materialId, mrb.materialId),
            eq(inventory.locationId, reserveLoc.id),
            eq(inventory.lockReason, lockReason),
            sql`coalesce(${inventory.batchNo}, '') = ${this.normalizeBatchNo(mrb.batchNo)}`,
            sql`${inventory.quantity} > 0`,
          ),
        )
        .orderBy(asc(inventory.createdAt), asc(inventory.id))
        .for('update')) as any[];

      const availScaled = rows.reduce((s: number, r: any) => s + this.toScaled(r.quantity), 0);
      if (availScaled < needLockedScaled) {
        // 可核销量不足：回滚整个事务，明细保持 pending，单子不结案。
        // 典型成因：货物已被人工搬走、或保留行被误调整。
        // 409 = 库存状态冲突（等一等或先处理别处），不能静默置 done —— 那会让库存凭空消失。
        // 文案按设计 §4.3 定稿，QA 按「保留库存不足」做字面匹配，不要改前缀。
        throw new ConflictException(
          `保留库存不足：本明细需核销 ${this.fromScaled(needLockedScaled)}，` +
            `实际可核销 ${this.fromScaled(availScaled)}` +
            `（批次 ${mrb.batchNo || '-'}）。请核对保留库位库存后再确认提走`,
        );
      }

      // 按明细数量逐行扣减（FIFO），归零才删行；`balanceAfter` 记真实余额
      let remainScaled = needLockedScaled;
      for (const row of rows) {
        if (remainScaled <= 0) break;
        const rowScaled = this.toScaled(row.quantity);
        if (rowScaled <= 0) continue;
        const takeScaled = Math.min(rowScaled, remainScaled);
        const leftScaled = rowScaled - takeScaled;

        if (leftScaled === 0) {
          await tx.delete(inventory).where(eq(inventory.id, row.id));
        } else {
          await tx
            .update(inventory)
            .set({ quantity: this.fromScaled(leftScaled) })
            .where(eq(inventory.id, row.id));
        }

        await tx.insert(inventoryTransaction).values({
          materialId: row.materialId,
          locationId: row.locationId,
          batchNo: row.batchNo ?? null,
          labelNo: row.labelNo ?? null,
          stockStatus: row.stockStatus ?? 'defective',
          txType: 'mrb_other_customer_out',
          txNo: mrb.mrbNo,
          qty: this.fromScaled(-takeScaled),
          // 真实余额：整行核销时为 0，部分核销时为剩余量（原实现固定写 '0'，部分核销会错账）
          balanceAfter: this.fromScaled(leftScaled),
          unit: row.unit ?? 'PCS',
          referenceNo: disp.refNo ?? mrb.mrbNo,
          remark: `MRB其他处置（退回客户）确认提走核销 ${this.fromScaled(takeScaled)}`,
          createdBy: operator.userId || null,
          updatedBy: operator.userId || null,
        });

        remainScaled -= takeScaled;
      }

      await this.markDispositionDone(tx, dispositionId);
    });

    await this.syncExecutionStatus(disp.mrbId);
    return this.getMrbDetail(disp.mrbId);
  }

  /**
   * 报废销毁（MRB v3）：把已调入不良品仓的报废量真正核销掉。
   *
   * 为什么拆成两步（终审冻结 → 入库后销毁）：
   *  `scrap` 旧实现是终审当场把库存减到 0，账上立刻没有货，实物却还在收货库位 ——
   *  仓库没有任何动作、库存流水只有一条 `-200`，一旦事后追责（谁搬的、搬到哪、
   *  什么时候销毁的）完全查不到。现在终审只冻结并生成调拨任务，仓管把货搬进不良品仓、
   *  在系统里点「报废销毁」才减账，实物与账务一一对得上。
   *
   * 前置（缺一不可）：
   *  1. 明细是 `scrap` 且 `pending`（锁内重读，防并发双扣）；
   *  2. 单据处于 `pending_execute`；
   *  3. 本单报废量**已全部位于不良品仓** —— 没搬完不许销毁（否则又是「账没了货还在」）。
   *
   * @throws ConflictException 报废库存尚未调入不良品仓
   */
  async destroyScrap(params: {
    dispositionId: string;
    operator: MrbOperator;
    remark?: string;
  }): Promise<MrbReview> {
    const { dispositionId, operator } = params;

    const dispRows = await this.db
      .select()
      .from(mrbDisposition)
      .where(eq(mrbDisposition.id, dispositionId))
      .limit(1);
    if (dispRows.length === 0) throw new NotFoundException('处置明细不存在');
    const disp = dispRows[0];

    if (disp.dispositionType !== 'scrap') {
      throw new BadRequestException('仅「报废」的处置明细需要确认销毁');
    }
    if (disp.execStatus !== 'pending') {
      throw new BadRequestException('该处置明细已完成或已取消，无需重复销毁');
    }

    const mrb = await this.loadMrb(disp.mrbId);
    if (mrb.status !== 'pending_execute') {
      throw new BadRequestException(
        `当前状态（${MRB_STATUS_LABELS[mrb.status] ?? mrb.status}）不可执行报废销毁`,
      );
    }

    // 报废冻结行的唯一标记；库位另按「属于不良品仓」过滤，两者共同收窄
    const lockReason = buildScrapLockReason(mrb.mrbNo);

    await this.db.transaction(async (tx) => {
      // ---------- 0. 锁明细行、锁内重读（并发幂等） ----------
      const lockedDisp = (await tx.execute(sql`
        SELECT id, disposition_type, exec_status, quantity
        FROM mrb_disposition
        WHERE id = ${dispositionId}::uuid
        FOR UPDATE
      `)) as unknown as Array<{
        id: string;
        disposition_type: string;
        exec_status: string;
        quantity: string;
      }>;
      const cur = lockedDisp?.[0];
      if (!cur) throw new NotFoundException('处置明细不存在');
      if (cur.disposition_type !== 'scrap') {
        throw new BadRequestException('仅「报废」的处置明细需要确认销毁');
      }
      if (cur.exec_status !== 'pending') {
        throw new BadRequestException('该处置明细已完成或已取消，无需重复销毁');
      }
      const needScaled = this.toScaled(cur.quantity);
      if (needScaled <= 0) {
        throw new BadRequestException('处置数量异常，无法销毁');
      }

      // ---------- 1. 报废冻结行必须已在不良品仓 ----------
      // 同时锁行（FOR UPDATE），避免和调拨任务完成、库存调整并发改同一行。
      const rows = (await tx.execute(sql`
        SELECT i.id, i.material_id, i.location_id, i.batch_no, i.quantity, i.unit, i.label_no
        FROM inventory i
        JOIN warehouse_location l ON l.id = i.location_id
        JOIN warehouse w ON w.id = l.warehouse_id
        WHERE i.material_id = ${mrb.materialId}::uuid
          AND coalesce(i.batch_no, '') = ${this.normalizeBatchNo(mrb.batchNo)}
          AND i.stock_status = 'scrapped'
          AND i.quantity > 0
          AND w.wh_type = 'defective'
          -- 本单标记优先；调拨合并时标记可能被同批次另一张单的行覆盖，
          -- 所以放宽到任何 MRB-SCRAP 标记 —— scrapped 且有量的行按定义就是「待销毁」。
          AND (i.lock_reason = ${lockReason} OR i.lock_reason LIKE 'MRB-SCRAP:%')
        ORDER BY (i.lock_reason = ${lockReason}) DESC, i._created_at, i.id
        FOR UPDATE OF i
      `)) as unknown as Array<{
        id: string;
        material_id: string;
        location_id: string;
        batch_no: string | null;
        quantity: string;
        unit: string | null;
        label_no: string | null;
      }>;

      const availScaled = rows.reduce((s, r) => s + this.toScaled(r.quantity), 0);
      if (availScaled < needScaled) {
        // 409 而不是 400：这是「货还没到位」的状态冲突，等调拨任务做完再点。
        throw new ConflictException(
          `报废库存尚未调入不良品仓：本明细需销毁 ${this.fromScaled(needScaled)}，` +
            `不良品仓现有 ${this.fromScaled(availScaled)}` +
            `（批次 ${mrb.batchNo || '-'}）。请先完成不良品调拨任务`,
        );
      }

      // ---------- 2. FIFO 扣减（归零才删行） ----------
      let remainScaled = needScaled;
      for (const row of rows) {
        if (remainScaled <= 0) break;
        const rowScaled = this.toScaled(row.quantity);
        if (rowScaled <= 0) continue;
        const takeScaled = Math.min(rowScaled, remainScaled);
        const leftScaled = rowScaled - takeScaled;

        if (leftScaled === 0) {
          await tx.delete(inventory).where(eq(inventory.id, row.id));
        } else {
          await tx
            .update(inventory)
            .set({ quantity: this.fromScaled(leftScaled) })
            .where(eq(inventory.id, row.id));
        }

        await tx.insert(inventoryTransaction).values({
          materialId: row.material_id,
          locationId: row.location_id,
          batchNo: row.batch_no ?? null,
          labelNo: row.label_no ?? null,
          stockStatus: 'scrapped',
          txType: 'mrb_scrap',
          txNo: mrb.mrbNo,
          qty: this.fromScaled(-takeScaled),
          // 真实余额：整行销毁为 0，部分销毁为剩余量
          balanceAfter: this.fromScaled(leftScaled),
          unit: row.unit ?? mrb.unit ?? 'PCS',
          referenceNo: mrb.mrbNo,
          remark:
            `MRB报废销毁 ${this.fromScaled(takeScaled)}` +
            (params.remark?.trim() ? `；${params.remark.trim()}` : ''),
          createdBy: operator.userId || null,
          updatedBy: operator.userId || null,
        });

        remainScaled -= takeScaled;
      }

      await this.markDispositionDone(tx, dispositionId);
    });

    await this.syncExecutionStatus(disp.mrbId);
    return this.getMrbDetail(disp.mrbId);
  }

  /**
   * 下游单据完成后同步 MRB 状态：
   * 所有处置明细都执行完毕（或下游单据被取消）→ pending_execute → closed。
   *
   * **状态变更与保留占用释放必须在同一事务**（设计 arch.6 §7-5 / §7-13）：
   * 否则崩溃窗口里会出现「单子已 closed、保留行还锁着」——那批货既进不了可评审量、
   * 又被库存守卫拦住、库位还是 locked，就成了永远解不开的死库存。
   *
   * 并发下 CAS 失败（`ConflictException`）视为另一路已结案，直接返回：
   * `releaseMrbReserve` 本身幂等（无保留行时静默返回），不会重复加库存/写流水。
   */
  async syncExecutionStatus(mrbId: string): Promise<void> {
    let closed = false;
    try {
      await this.db.transaction(async (tx) => {
        // 锁内重判，避免两个下游单据同时完成时把 closed 的释放做两遍
        const mrbResult = await tx
          .select({ status: mrbReview.status })
          .from(mrbReview)
          .where(eq(mrbReview.id, mrbId))
          .limit(1);
        if (mrbResult.length === 0) return;
        if (mrbResult[0].status !== 'pending_execute') return;

        const pending = await tx
          .select({ count: count() })
          .from(mrbDisposition)
          .where(and(eq(mrbDisposition.mrbId, mrbId), eq(mrbDisposition.execStatus, 'pending')));
        if (Number(pending[0]?.count || 0) > 0) return;

        await this.transition(tx, mrbId, 'pending_execute', 'closed');
        await this.releaseMrbReserve(tx, mrbId);
        closed = true;
      });
    } catch (e) {
      // 并发重复调用：另一路已先结案，忽略
      if (e instanceof ConflictException) return;
      throw e;
    }

    // P2：处置全部执行完 → 推 OA 结案（失败不影响 WMS，OA 侧仍有手动刷新）
    if (closed) {
      try {
        await this.pushExecutedToOa(mrbId);
      } catch (e) {
        // 回执失败只是 OA 状态滞后，不阻断业务
      }
    }
  }

  /** 处置执行完成回执：把最终状态与各明细执行结果推给 OA（走 outbox） */
  private async pushExecutedToOa(mrbId: string): Promise<void> {
    const mrbRows = await this.db
      .select({ mrbNo: mrbReview.mrbNo, status: mrbReview.status, finalDecision: mrbReview.finalDecision })
      .from(mrbReview)
      .where(eq(mrbReview.id, mrbId))
      .limit(1);
    const mrb = mrbRows[0];
    if (!mrb) return;

    const disps = await this.db
      .select({
        type: mrbDisposition.dispositionType,
        otherType: mrbDisposition.otherType,
        quantity: mrbDisposition.quantity,
        unit: mrbDisposition.unit,
        execStatus: mrbDisposition.execStatus,
        execTime: mrbDisposition.execTime,
        remark: mrbDisposition.remark,
      })
      .from(mrbDisposition)
      .where(eq(mrbDisposition.mrbId, mrbId));

    await enqueueOaEvent(this.db, 'mrb.executed', mrb.mrbNo, {
      event: 'mrb.executed',
      bizKey: mrb.mrbNo,
      occurredAt: new Date().toISOString(),
      mrb: { mrbNo: mrb.mrbNo, status: mrb.status, finalDecision: mrb.finalDecision },
      dispositions: disps.map((d) => ({
        dispositionType: d.type,
        otherType: d.otherType,
        quantity: d.quantity,
        unit: d.unit,
        execStatus: d.execStatus,
        execTime: d.execTime,
        remark: d.remark,
      })),
    });
  }

  /** 标记某条处置明细已执行完成 */
  async markDispositionDone(tx: any, dispositionId: string): Promise<void> {
    await tx
      .update(mrbDisposition)
      .set({ execStatus: 'done', execTime: new Date() })
      .where(eq(mrbDisposition.id, dispositionId));
  }

  /**
   * 终审落定后「抄送 + 站内消息」（MRB v3）。
   *
   * 抄送范围（业务定稿）：IQC 检验员（本批判定的那个人）+ 仓管员 + 仓库主管 + 计划主管 + 生产主管。
   * 为什么按**岗位**拉人而不是按人配名单：这些岗位是流程角色，人会换岗、会休假，
   * 配名单必然过期；按 role_code 现取能保证「谁在这个岗位上谁就收得到」。
   *
   * `mrb_cc` 存的是**姓名快照**（user_name），因为抄送是历史事实 ——
   * 三年后当事人离职改名，单据上仍应显示「当时的张三抄送过」，而不是空白。
   *
   * 所有写入挂在 `tx` 上：终审回滚不能留下「单子没过、通知已经发出去了」的假消息。
   */
  private async writeCcAndNotices(
    tx: any,
    params: {
      mrb: any;
      lines: PlannedLine[];
      approverId: string;
      rejectMode?: boolean;
      returnNo?: string | null;
      reworkNo?: string | null;
      /** 物料编码/名称不挂在 mrb_review 上，由调用方从 material 表带进来 */
      materialCode?: string | null;
      materialName?: string | null;
    },
  ): Promise<void> {
    const { mrb, lines } = params;
    const unit = mrb.unit || 'PCS';

    // ---------- 1. 收件人：本批检验员 + 四个岗位 ----------
    const recipients = new Map<string, { name: string | null; roleCode: string | null }>();

    const inspectorRows = await tx.execute(sql`
      SELECT ((l.inspector_id).user_id)::text AS user_id, a.name, a.role_code
      FROM iqc_lot l
      LEFT JOIN sys_account a ON a.id = ((l.inspector_id).user_id)::uuid
      WHERE l.id = ${mrb.lotId}::uuid
    `);
    for (const r of inspectorRows as unknown as Array<Record<string, any>>) {
      if (r.user_id) recipients.set(r.user_id, { name: r.name, roleCode: r.role_code });
    }

    const postRows = await tx.execute(sql`
      SELECT id::text AS user_id, name, role_code
      FROM sys_account
      WHERE role_code IN ('wh_keeper', 'wh_manager', 'plan_manager', 'production_manager')
        AND status = 'active'
    `);
    for (const r of postRows as unknown as Array<Record<string, any>>) {
      // 检验员本人可能同时是某个岗位，保留先取到的身份即可
      if (r.user_id && !recipients.has(r.user_id)) {
        recipients.set(r.user_id, { name: r.name, roleCode: r.role_code });
      }
    }

    if (recipients.size === 0) return;

    // ---------- 2. 抄送名单快照 ----------
    for (const [userId, info] of recipients) {
      await tx.execute(sql`
        INSERT INTO mrb_cc (mrb_id, user_id, user_name, role_code, _created_by)
        VALUES (
          ${mrb.id}::uuid,
          ROW(${userId})::user_profile,
          ${info.name ?? null},
          ${info.roleCode ?? null},
          ${params.approverId ? sql`ROW(${params.approverId})::user_profile` : sql`null`}
        )
        ON CONFLICT DO NOTHING
      `);
    }

    // ---------- 3. 消息正文 ----------
    const dispositionText = params.rejectMode
      ? `整批 ${this.fromScaled(this.toScaled(mrb.quantity))} ${unit} 退货`
      : lines
          .map((l) => `${this.dispositionTypeLabel(l)} ${this.fromScaled(l.qtyScaled)} ${unit}`)
          .join('、');

    const title = params.rejectMode
      ? `MRB ${mrb.mrbNo} 终审否决：整批退货`
      : `MRB ${mrb.mrbNo} 终审通过`;

    const downstream: string[] = [];
    if (params.returnNo) downstream.push(`退货单 ${params.returnNo}`);
    if (params.reworkNo) downstream.push(`返工单 ${params.reworkNo}`);
    if (params.rejectMode) downstream.push('不良品调拨任务');

    const content = [
      `物料：${[params.materialCode, params.materialName].filter(Boolean).join(' ')}`.trim(),
      `批次：${mrb.batchNo || '-'}`,
      `结论：${dispositionText || '-'}`,
      downstream.length > 0 ? `下游单据：${downstream.join('、')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    await this.noticeService.pushMany(
      {
        userIds: [...recipients.keys()],
        title,
        content,
        bizType: 'mrb',
        bizId: mrb.id,
        bizNo: mrb.mrbNo,
        createdBy: params.approverId || null,
      },
      tx,
    );
  }

  /**
   * 写供应商欠料台账 + 生成不良品调拨任务（MRB v3）。
   *
   * 规则（已与业务定稿）：
   *  - 退货、报废：各建一条欠料，供应商后续补料 IQC PASS 时由
   *    `SupplierDebtService.settleDebtOnReceipt` 自动冲减；
   *  - 返工、特采：不建欠料（货没少，供应商不欠）；
   *  - 否决：整单按退货处理，`source_type='mrb_reject'`，同时建调拨任务。
   *
   * 所有写入必须挂在调用方事务 `tx` 上：终审回滚时不能留下孤儿欠料。
   */
  private async writeDebtAndMoveTasks(
    tx: any,
    params: {
      mrb: any;
      lines: PlannedLine[];
      materialCode?: string | null;
      materialName?: string | null;
      supplierCode?: string | null;
      supplierName?: string | null;
      operatorId?: string;
      /** mrb=方案执行（退货/报废分别建账）；reject=终审否决（整单退货） */
      sourceKind: 'mrb' | 'reject';
    },
  ): Promise<void> {
    const { mrb, lines, operatorId } = params;

    const sumByType = (type: MrbDispositionType): number =>
      lines.filter((l) => l.type === type).reduce((s, l) => s + l.qtyScaled, 0);

    const returnScaled = sumByType('return');
    const scrapScaled = sumByType('scrap');

    // ---------- 欠料台账 ----------
    const debts: Array<{ scaled: number; sourceType: string }> =
      params.sourceKind === 'reject'
        ? [{ scaled: returnScaled, sourceType: 'mrb_reject' }]
        : [
            { scaled: returnScaled, sourceType: 'mrb_return' },
            { scaled: scrapScaled, sourceType: 'mrb_scrap' },
          ];

    for (const d of debts) {
      if (d.scaled <= 0) continue;
      await this.supplierDebtService.createDebt({
        supplierId: mrb.supplierId,
        supplierCode: params.supplierCode || '',
        supplierName: params.supplierName || '',
        materialId: mrb.materialId,
        materialCode: params.materialCode || '',
        materialName: params.materialName || '',
        qty: Number(this.fromScaled(d.scaled)),
        sourceType: d.sourceType,
        sourceId: mrb.id,
        sourceNo: mrb.mrbNo,
        userId: operatorId || undefined,
        tx,
      });
    }

    // ---------- 不良品调拨任务（退货 / 否决 / 报废） ----------
    //
    // 三类都要实物搬进不良品仓，但**目的不同**：
    //  - 退货 / 否决：搬到不良品仓后才能按退货单出库给供应商；
    //  - 报废：搬到不良品仓后才能销毁（destroyScrap 是唯一减账口）。
    //
    // 若来源库位本身就在不良品仓（对不良品仓的存量再评审时很常见），
    // 建一条「不良品仓 → 不良品仓」的任务纯属噪音，直接跳过：
    // destroyScrap 的前置条件是「报废量已全部位于不良品仓」，不依赖任务存在。
    const moveTasks: Array<{
      lineType: MrbDispositionType;
      scaled: number;
      source: string;
      reason: string;
      remark: string;
    }> = [];
    if (returnScaled > 0) {
      moveTasks.push({
        lineType: 'return',
        scaled: returnScaled,
        source: params.sourceKind === 'reject' ? 'mrb_reject' : 'mrb_return',
        reason:
          params.sourceKind === 'reject'
            ? `终审否决，整批退货 ${this.fromScaled(returnScaled)}`
            : `MRB 判退货 ${this.fromScaled(returnScaled)}`,
        remark: `MRB ${mrb.mrbNo} 判退货，待调拨至不良品仓后出库`,
      });
    }
    if (scrapScaled > 0 && params.sourceKind !== 'reject') {
      moveTasks.push({
        lineType: 'scrap',
        scaled: scrapScaled,
        source: 'mrb_scrap',
        reason: `MRB 判报废 ${this.fromScaled(scrapScaled)}`,
        remark: `MRB ${mrb.mrbNo} 判报废，待调拨至不良品仓后销毁`,
      });
    }
    if (moveTasks.length === 0) return;

    const defectiveLoc = await this.getDefectiveWarehouseLocation();

    /** 本次实际生成的任务（用于给仓库推待办消息） */
    const created: Array<{
      lineType: MrbDispositionType;
      qty: number;
      fromLocationId: string;
      moveNo?: string;
    }> = [];

    for (const t of moveTasks) {
      const line = lines.find((l) => l.type === t.lineType);
      const fromLocationId = line?.allocs?.[0]?.row?.locationId;
      if (!fromLocationId) {
        this.logger.warn(
          `MRB ${mrb.mrbNo} ${t.lineType} 行没有可追溯的来源库位，跳过调拨任务创建`,
        );
        continue;
      }
      if (await this.isDefectiveWarehouseLocation(fromLocationId)) continue;

      // 调拨单号：挂靠来源检验单号（<JY...>-NGDB），仓库一眼能对上是哪次检验
      const moveNo = await nextDefectiveMoveNo(tx, {
        inspectionNo: mrb.sourceInspectionNo ?? mrb.inspectionNo,
        mrbId: mrb.id,
      });

      await tx.insert(defectiveMoveTask).values({
        moveNo,
        sourceInspectionNo: mrb.sourceInspectionNo ?? mrb.inspectionNo ?? null,
        lotId: mrb.lotId,
        materialId: mrb.materialId,
        supplierId: mrb.supplierId,
        batchNo: mrb.batchNo ?? null,
        quantity: this.fromScaled(t.scaled),
        unit: mrb.unit,
        fromLocationId,
        toLocationId: defectiveLoc?.id ?? null,
        status: 'pending',
        remark: t.remark,
        mrbId: mrb.id,
        source: t.source,
        reason: t.reason,
        // MRB 派生单没有「制单/确认」环节（终审即生效），只记录生成人
        createdBy: operatorId || null,
      });

      created.push({ lineType: t.lineType, qty: t.scaled, fromLocationId, moveNo });
    }

    if (created.length === 0) return;

    // ---------- 推给仓库：不良品调拨待办 ----------
    //
    // 为什么单独一条消息、而不是依赖终审抄送：抄送的标题是「MRB 终审通过」，
    // 仓库看到的是质量结论，不是「你现在有活要干」。调拨没做，退货出库和
    // 报废销毁都会卡在「查无此货」，所以这里推一条动作导向的待办，
    // 点击直接进「库存 → 不良品调拨单」。
    const whAccounts = (await tx.execute(sql`
      SELECT id::text AS user_id FROM sys_account
      WHERE role_code IN ('wh_keeper', 'wh_manager') AND status = 'active'
    `)) as unknown as Array<{ user_id: string }>;
    if (whAccounts.length === 0) return;

    const locRows = await tx
      .select({
        id: warehouseLocation.id,
        locationCode: warehouseLocation.locationCode,
      })
      .from(warehouseLocation)
      .where(inArray(warehouseLocation.id, created.map((c) => c.fromLocationId)));
    const locMap = new Map<string, string>(
      locRows.map((r: any) => [r.id, r.locationCode]),
    );

    const itemText = created
      .map((c) => `${c.lineType === 'return' ? '退货' : '报废'} ${this.fromScaled(c.qty)}`)
      .join('、');
    const fromText = [
      ...new Set(created.map((c) => locMap.get(c.fromLocationId)).filter(Boolean)),
    ].join('、');
    const moveNoText = created.map((c) => c.moveNo).filter(Boolean).join('、');

    await this.noticeService.pushMany(
      {
        userIds: whAccounts.map((r) => r.user_id),
        title: `不良品调拨待办：MRB ${mrb.mrbNo}`,
        content: [
          moveNoText ? `调拨单：${moveNoText}` : '',
          `物料：${[params.materialCode, params.materialName].filter(Boolean).join(' ')}`.trim(),
          `批次：${mrb.batchNo || '-'}`,
          `待调拨：${itemText} ${mrb.unit || ''}`.trim(),
          fromText ? `原库位：${fromText}` : '',
          '请到「库存 → 不良品调拨」选中单据扫码执行（先扫货物标签，再扫不良品库位码）；',
          '搬入不良品仓后才能退货出库 / 报废销毁。',
        ]
          .filter(Boolean)
          .join('\n'),
        bizType: 'defective_move',
        bizId: mrb.id,
        bizNo: mrb.mrbNo,
        createdBy: operatorId || null,
      },
      tx,
    );
  }

  /**
   * 该库位是否属于不良品仓（`warehouse.wh_type = 'defective'`）。
   * 用于判断是否还需要建调拨任务 —— 来源已在不良品仓就没有搬运动作。
   */
  private async isDefectiveWarehouseLocation(locationId: string): Promise<boolean> {
    const rows = (await this.db.execute(sql`
      SELECT 1 AS hit
      FROM warehouse_location l
      JOIN warehouse w ON w.id = l.warehouse_id
      WHERE l.id = ${locationId}::uuid AND w.wh_type = 'defective'
      LIMIT 1
    `)) as unknown as Array<{ hit: number }>;
    return rows.length > 0;
  }

  // =========================================================================
  // 十、库存流水 / upsert / 单号
  // =========================================================================

  /** 数量换算：numeric(18,4) 用整数缩放避免浮点尾差（×10000，沿用现网实现） */
  private toScaled(value: unknown): number {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 10000);
  }

  private fromScaled(scaled: number): string {
    const n = scaled / 10000;
    return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  }

  /**
   * 写入目标库存行。
   *
   * 唯一键口径（v2.1-arch.1）：`(material_id, location_id, batch_no, stock_status)` 全局唯一。
   * 「其他」处置靠**一张 MRB 一个专属保留库位**做隔离，同单多条明细合并成同一行（数量累加），
   * 因此**不需要**改动 inventory 的唯一索引（全仓 20+ 处 upsert 都依赖它，动它风险极高）。
   *
   * ⚠️ `onConflictDoUpdate` 的 target 必须与库上唯一索引列**完全一致**，否则 PG 报 42P10。
   */
  async upsertInventoryRow(
    tx: any,
    opts: {
      materialId: string;
      locationId: string;
      batchNo: string | null;
      supplierId: string | null;
      stockStatus: string;
      unit: string;
      productionDate?: any;
      deltaScaled: number;
      setZero?: boolean;
      locked: boolean;
      lockReason: string | null;
      isSpecialAdmit?: boolean;
      specialAdmitRef?: string | null;
    },
  ): Promise<{ id: string; quantityScaled: number }> {
    // 单条原子 UPSERT：以唯一索引为冲突目标，冲突时 quantity 在库内原子累加（setZero 时归零）。
    const batchNo = opts.batchNo ?? '';
    const deltaStr = this.fromScaled(opts.deltaScaled);
    const insertQty = opts.setZero ? '0' : deltaStr;

    const set: Record<string, unknown> = {
      locked: opts.locked,
      lockReason: opts.lockReason,
      ...(opts.isSpecialAdmit !== undefined ? { isSpecialAdmit: opts.isSpecialAdmit } : {}),
      ...(opts.specialAdmitRef !== undefined ? { specialAdmitRef: opts.specialAdmitRef } : {}),
    };
    set.quantity = opts.setZero ? sql`0` : sql`${inventory.quantity} + ${deltaStr}::numeric`;

    const inserted = await tx
      .insert(inventory)
      .values({
        materialId: opts.materialId,
        locationId: opts.locationId,
        batchNo,
        supplierId: opts.supplierId,
        quantity: insertQty,
        unit: opts.unit,
        stockStatus: opts.stockStatus,
        productionDate: opts.productionDate ?? null,
        locked: opts.locked,
        lockReason: opts.lockReason,
        isSpecialAdmit: opts.isSpecialAdmit ?? false,
        specialAdmitRef: opts.specialAdmitRef ?? null,
      })
      .onConflictDoUpdate({
        target: [
          inventory.materialId,
          inventory.locationId,
          inventory.batchNo,
          inventory.stockStatus,
        ],
        set,
      })
      .returning({ id: inventory.id, quantity: inventory.quantity });

    const row = inserted[0];
    return { id: row.id, quantityScaled: this.toScaled(row.quantity) };
  }

  private async writeInventoryTx(
    tx: any,
    opts: {
      row: any;
      txType: string;
      qtyDelta: number;
      balanceAfter: number;
      txNo: string;
      remark: string;
      operatorId?: string;
    },
  ): Promise<void> {
    await tx.insert(inventoryTransaction).values({
      materialId: opts.row.materialId,
      locationId: opts.row.locationId,
      batchNo: opts.row.batchNo ?? null,
      labelNo: opts.row.labelNo ?? null,
      stockStatus: opts.row.stockStatus ?? 'good',
      txType: opts.txType,
      txNo: opts.txNo,
      qty: this.fromScaled(opts.qtyDelta),
      balanceAfter: this.fromScaled(opts.balanceAfter),
      unit: opts.row.unit ?? 'PCS',
      referenceNo: opts.txNo,
      remark: opts.remark,
      createdBy: opts.operatorId ?? null,
      updatedBy: opts.operatorId ?? null,
    });
  }

  private async generateReturnNo(tx: any): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await tx.execute(sql`SELECT nextval('seq_supplier_return_no') AS seq`);
    const seq = Number((result as any)[0]?.seq ?? 1);
    return `TH${datePart}${seq.toString().padStart(4, '0')}`;
  }

  private async generateReworkNo(tx: any): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const result = await tx.execute(sql`SELECT nextval('seq_rework_no') AS seq`);
    const seq = Number((result as any)[0]?.seq ?? 1);
    return `RG${datePart}${seq.toString().padStart(4, '0')}`;
  }

  /** 重新生成下游单号（供下游模块复用） */
  async nextReturnNo(): Promise<string> {
    return this.generateReturnNo(this.db);
  }

  async nextReworkNo(): Promise<string> {
    return this.generateReworkNo(this.db);
  }

  // =========================================================================
  // 十一、详情与明细
  // =========================================================================

  /** 读取 MRB 的处置明细（含「其他」三类的 otherType / 关联单号 / 复核日期） */
  async getDispositions(mrbId: string): Promise<MrbDisposition[]> {
    const rows = await this.db
      .select()
      .from(mrbDisposition)
      .where(eq(mrbDisposition.mrbId, mrbId))
      .orderBy(mrbDisposition.sortOrder);

    const returnOrders = await this.db
      .select({
        id: supplierReturnOrder.id,
        no: supplierReturnOrder.returnNo,
        dispositionId: supplierReturnOrder.dispositionId,
      })
      .from(supplierReturnOrder)
      .where(eq(supplierReturnOrder.mrbId, mrbId));
    const reworkOrders = await this.db
      .select({
        id: reworkOrder.id,
        no: reworkOrder.reworkNo,
        dispositionId: reworkOrder.dispositionId,
      })
      .from(reworkOrder)
      .where(eq(reworkOrder.mrbId, mrbId));

    return rows.map((r: any) => {
      const ret = returnOrders.find((o) => o.dispositionId === r.id);
      const rw = reworkOrders.find((o) => o.dispositionId === r.id);
      return {
        id: r.id,
        mrbId: r.mrbId,
        dispositionType: r.dispositionType,
        quantity: Number(r.quantity),
        unit: r.unit,
        fromLocationId: r.fromLocationId ?? undefined,
        toLocationId: r.toLocationId ?? undefined,
        execStatus: r.execStatus,
        execTime: r.execTime instanceof Date ? r.execTime.toISOString() : r.execTime ?? undefined,
        remark: r.remark ?? undefined,
        sortOrder: Number(r.sortOrder || 0),
        // refNo/refId 保持原语义：下游单据（退货单 / 返工单）
        refNo: ret?.no ?? rw?.no ?? undefined,
        refId: ret?.id ?? rw?.id ?? undefined,
        // 「其他」三类的附加信息
        otherType: r.otherType ?? undefined,
        otherRefNo: r.refNo ?? undefined,
        holdUntil: r.holdUntil ?? undefined,
      };
    });
  }

  async getMrbDetail(id: string): Promise<MrbReview> {
    const result = await this.db
      .select(this.mrbRowSelection())
      .from(mrbReview)
      .leftJoin(iqcLot, eq(mrbReview.lotId, iqcLot.id))
      .leftJoin(material, eq(mrbReview.materialId, material.id))
      .leftJoin(supplier, eq(mrbReview.supplierId, supplier.id))
      .where(eq(mrbReview.id, id))
      .limit(1);

    if (result.length === 0) {
      throw new NotFoundException('MRB评审单不存在');
    }

    const mrb = this.mapMrbRow(result[0] as any);

    const reviewersResult = await this.db
      .select({
        id: mrbReviewer.id,
        mrbId: mrbReviewer.mrbId,
        reviewerId: mrbReviewer.reviewerId,
        reviewerName: sql<string>`COALESCE((SELECT sa.name FROM sys_account sa WHERE sa.id::text = (mrb_reviewer.reviewer_id).user_id), (SELECT sa.name FROM sys_account sa WHERE sa.account = (mrb_reviewer.reviewer_id).user_id), (mrb_reviewer.reviewer_id).user_id)`.as('reviewer_name'),
        reviewerRole: mrbReviewer.reviewerRole,
        reviewOpinion: mrbReviewer.reviewOpinion,
        reviewResult: mrbReviewer.reviewResult,
        reviewTime: mrbReviewer.reviewTime,
        sortOrder: mrbReviewer.sortOrder,
      })
      .from(mrbReviewer)
      .where(eq(mrbReviewer.mrbId, id))
      .orderBy(mrbReviewer.sortOrder);

    mrb.reviewers = reviewersResult.map((r: any) => this.mapReviewerRow(r));
    mrb.dispositions = await this.getDispositions(id);

    return mrb;
  }
}
