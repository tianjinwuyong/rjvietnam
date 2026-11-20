import { apiGet, apiPost } from './request';
import type {
  MrbReview,
  MrbReviewer,
  MrbDispositionInput,
  MrbPendingLot,
  MrbLotGroup,
  MrbSlaLevel,
  MrbCompletenessResult,
  PaginatedResponse,
} from '@shared/api.interface';

/**
 * MRB 前端契约层（v2.1）。
 *
 * 约定（与 server/modules/mrb/mrb.controller.ts 一一对应）：
 *  - 写端点的**操作人一律取登录态**，前端不再传 `initiatorId` / `approverId`
 *    （传了服务端也会忽略，但传了会让后来人误以为是权威来源，故此处签名里直接删掉）；
 *  - 列表筛选参数名严格按后端：`slaLevel` / `onlyTimeout` / `onlyUrgent`，
 *    值用 `'1'` 表示「仅看」（后端只判断是否等于 `'1'`）；
 *  - 「我的任务」不再接受 `reviewerId`（服务端按 JWT 判定，越权参数已彻底移除）。
 */

export interface MrbListParams {
  page?: number;
  pageSize?: number;
  mrbNo?: string;
  materialCode?: string;
  batchNo?: string;
  status?: string;
  /** 列表范围：pending=待处理，done=已处理（已归档） */
  scope?: 'pending' | 'done';
  startDate?: string;
  endDate?: string;
  /** 巡检等级筛选：ok / warn / overdue */
  slaLevel?: MrbSlaLevel;
  /** '1' = 仅看超时（含 warn + overdue 之外的 overdue 严格口径由后端决定） */
  onlyTimeout?: string;
  /** '1' = 仅看急件 */
  onlyUrgent?: string;
}

/** 巡检汇总（顶部 Tab 角标） */
export interface MrbOverdueSummary {
  /** 预警（黄） */
  warn: number;
  /** 超时（红） */
  overdue: number;
  /** 单人审批（预审人 == 终审人） */
  singleApprover: number;
}

/** 已处理 MRB 按 IQC 批次折叠的列表 */
export function getMrbLotGroups(params: MrbListParams) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<MrbLotGroup> }>(
    '/api/mrb/lot-groups',
    params,
  );
}

export interface PendingLotParams {
  page?: number;
  pageSize?: number;
  materialCode?: string;
  batchNo?: string;
  inspectionNo?: string;
}

export interface MyTaskParams {
  page?: number;
  pageSize?: number;
  status?: string;
}

export interface MrbReviewerInput {
  /** 账号 UUID 或工号（服务端统一规范化为 UUID） */
  reviewerId: string;
  reviewerName?: string;
  reviewerRole?: string;
}

export function getMrbList(params: MrbListParams) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<MrbReview> }>('/api/mrb/list', params);
}

/**
 * 巡检汇总：{ warn, overdue, singleApprover }。
 * 待处理 Tab 角标取 `warn + overdue`，点击角标勾「仅看超时」。
 */
export function getMrbOverdueSummary() {
  return apiGet<{ code: number; message: string; data: MrbOverdueSummary }>('/api/mrb/overdue-summary');
}

/** 待发起 MRB 的 IQC 批次（判定 fail；不良品仓仍有未处理库存的批次支持重新发起） */
export function getPendingLots(params: PendingLotParams) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<MrbPendingLot> }>(
    '/api/mrb/pending-lots',
    params,
  );
}

export interface InitiateMrbInput {
  /** IQC 批次 ID：UUID / 检验编号 / 批次号 三者皆可 */
  iqcLotId: string;
  /** 不合格原因 */
  reason: string;
  /** 本次评审数量 N（1 ≤ N ≤ 可评审量 M），缺省 = M */
  quantity?: number;
  /** 落点：false=存草稿，true=提交评审（缺省 true） */
  submit?: boolean;
  isUrgent?: boolean;
  /** 急件原因（isUrgent=true 时必填，服务端校验） */
  urgentReason?: string;
  /** 评审员（一步到位；存草稿时也可为空） */
  reviewers?: MrbReviewerInput[];
}

/**
 * 发起 MRB。
 * `submit=false` → 落 `draft`（存草稿）；`submit=true` → 按评审员进度推进到
 * pending_review / reviewing / pending_approval / pending_final。
 */
export function initiateMrb(data: InitiateMrbInput) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/initiate', data);
}

export function assignReviewers(data: { mrbId: string; reviewers: MrbReviewerInput[] }) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/assign-reviewers', data);
}

/** 草稿提交（draft → 待指派 / 评审中 / 待预审 / 待终审） */
export function submitMrb(data: { mrbId: string }) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/submit', data);
}

/** 作废（draft / pending_review / reviewing；原因 ≥5 字） */
export function cancelMrb(data: { mrbId: string; reason: string }) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/cancel', data);
}

/**
 * 撤回方案（SQE）：reviewing → pending_review。
 * 与作废不同，单据继续存活、方案保留，改完可重新提交；已投评审意见会清空。
 */
export function withdrawMrb(data: { mrbId: string; reason: string }) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/withdraw', data);
}

/**
 * 审批驳回（IQC 主管审核 / 质量经理审批）→ 退回 SQE 改方案。
 * 与「否决并全批退货（rejectMrb）」不同：不产生库存变动、不生成下游单。
 */
export function returnBackMrb(data: { mrbId: string; reason: string }) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/return-back', data);
}

/**
 * 资料齐全性预审（iqc_manager / admin）。
 * `result='incomplete'` / `'skip'` 时 `remark` 必填且 ≥5 字。
 */
export function preApproveMrb(data: {
  mrbId: string;
  result: Extract<MrbCompletenessResult, 'complete' | 'incomplete'> | 'skip';
  remark?: string;
  /** 单人审批代审说明（2~200 字） */
  separationRemark?: string;
}) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/pre-approve', data);
}

export function getMyTasks(params: MyTaskParams) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<MrbReview & { myReview?: MrbReviewer }> }>(
    '/api/mrb/my-tasks',
    params,
  );
}

/**
 * 提交评审意见。
 * reviewerId 不由前端传入：服务端以登录身份判定评审人，避免冒名与工号/UUID 错配。
 * reviewResult 只能是 特采/退货/返工/报废 四项（服务端兼容旧值 accept/reject/deviation）。
 */
export function submitReview(data: {
  mrbId: string;
  reviewOpinion: string;
  reviewResult: 'special_admit' | 'return' | 'rework' | 'scrap' | string;
}) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/submit-review', data);
}

/**
 * 终审。
 * - 「主处置」由服务端取 `dispositions` 中数量最大的一行，`finalResult` 仅作兼容；
 * - `dispositions` 各行数量之和必须**等于** `mrb.quantity`（服务端整数比较，不做四舍五入）；
 * - 预审人与终审人同一人时 `separationRemark` 必填（2~200 字）。
 */
export function finalApprove(data: {
  mrbId: string;
  /** @deprecated 服务端由 dispositions 推导主处置，仅在未传 dispositions 时有意义 */
  finalResult?: 'special_admit' | 'return' | 'rework' | 'scrap' | 'other' | 'mixed';
  finalRemark?: string;
  separationRemark?: string;
  /** 拆分处置明细；「其他」处置必须走这里（不能只传 finalResult='other'） */
  dispositions?: MrbDispositionInput[];
}) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/final-approve', data);
}

/** 终审驳回（原因 ≥5 字） */
export function rejectMrb(data: { mrbId: string; reason: string; separationRemark?: string }) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/reject', data);
}

/** 「其他-退回客户」确认已提走（仓管） */
export function confirmMrbOut(dispositionId: string) {
  return apiPost<{ code: number; message: string; data: MrbReview }>(
    `/api/mrb/disposition/${dispositionId}/confirm-out`,
    {},
  );
}

/**
 * 报废销毁（MRB v3）：报废量已按调拨任务进入不良品仓后，仓管确认销毁核销。
 * 未入库就调用会被服务端 409 拦住。
 */
export function destroyMrbScrap(dispositionId: string, remark?: string) {
  return apiPost<{ code: number; message: string; data: MrbReview }>(
    `/api/mrb/disposition/${dispositionId}/destroy`,
    { remark },
  );
}

export function getMrbDetail(id: string) {
  return apiGet<{ code: number; message: string; data: MrbReview }>(`/api/mrb/detail/${id}`);
}

/** 评审员候选（「选定评审人员」下拉用；所有 MRB 写角色均可调用） */
export interface MrbReviewerCandidate {
  id: string;
  /** 工号 */
  account: string;
  name: string;
  roleCode: string;
  roleName?: string | null;
}

export function getReviewerCandidates() {
  return apiGet<{ code: number; message: string; data: { items: MrbReviewerCandidate[] } }>(
    '/api/mrb/reviewer-candidates',
  );
}

// ============================================================================
// MRB v3：方案制定（SQE）+ 二维码分摊
// ============================================================================

/** 一个收货箱（= 一张收货单 = 一个二维码） */
export interface MrbLotLabel {
  receiptId: string;
  receiptNo: string;
  qrContent: string | null;
  quantity: number;
  /** 本单已分摊到该箱的数量 */
  allocated: number;
  remaining: number;
  productionDate: string | null;
  batchNo: string | null;
  serialNo: string | null;
}

/** 方案中的一条处置：数量由 labels 汇总，不单独传 */
export interface MrbPlanDispositionInput {
  dispositionType: 'special_admit' | 'return' | 'rework' | 'scrap' | 'other';
  otherType?: string;
  refNo?: string;
  holdUntil?: string;
  remark?: string;
  labels: { receiptId: string; quantity: number }[];
}

export interface MrbPlanDetail {
  mrbId: string;
  status: string;
  quantity: string;
  planBy?: string | null;
  planTime?: string | null;
  dispositions: Array<{
    id: string;
    dispositionType: string;
    otherType?: string | null;
    refNo?: string | null;
    holdUntil?: string | null;
    quantity: number;
    unit: string;
    execStatus: string;
    remark?: string | null;
    labels: Array<{ receiptId: string; receiptNo: string; qrContent: string | null; quantity: number }>;
  }>;
  reviewers: Array<{
    id: string;
    reviewerId: string;
    reviewerName?: string | null;
    reviewerRole?: string | null;
    reviewResult?: string | null;
    reviewOpinion?: string | null;
    reviewTime?: string | null;
  }>;
}

/** 该批次的可分摊收货箱 */
export function getMrbLotLabels(params: { mrbId?: string; lotId?: string }) {
  return apiGet<{ code: number; message: string; data: { items: MrbLotLabel[] } }>(
    '/api/mrb/lot-labels',
    params,
  );
}

/** 读方案 */
export function getMrbPlan(mrbId: string) {
  return apiGet<{ code: number; message: string; data: MrbPlanDetail }>(`/api/mrb/plan/${mrbId}`);
}

/** 保存 / 提交方案（submit=false 存草稿） */
export function saveMrbPlan(data: {
  mrbId: string;
  reviewers?: { reviewerId: string; reviewerName?: string; reviewerRole?: string }[];
  dispositions: MrbPlanDispositionInput[];
  /** 不合格原因：提交时必填 */
  failReason?: string;
  submit?: boolean;
}) {
  return apiPost<{ code: number; message: string; data: MrbReview }>('/api/mrb/plan', data);
}
