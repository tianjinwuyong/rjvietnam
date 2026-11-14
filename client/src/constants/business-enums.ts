/**
 * 前后端共用的业务枚举常量（前端副本）。
 *
 * ⚠️ 必须与 server/common/constants/business-enums.ts 保持一致：
 * nest build 不会把 shared/*.ts 编译进 dist，因此前后端各存一份。
 * 类型统一放在 shared/api.interface.ts（纯类型，编译期擦除）。
 */

/**
 * IQC 不合格类型（不良类型）固定八项。
 * 用户口径（2026-10-18）：包装、外观、尺寸、功能、安规、可靠性、环保、无检验资料。
 */
export const IQC_DEFECT_TYPES = [
  '包装',
  '外观',
  '尺寸',
  '功能',
  '安规',
  '可靠性',
  '环保',
  '无检验资料',
] as const;

/**
 * MRB 评审结论（评审员意见）。
 *
 * v3 起只保留两种表态：**同意(agree) / 有异议(disagree)**。
 * 为什么废掉原来的「特采/退货/返工/报废」四选一：
 *   评审员并不掌握收货箱二维码，选出来的处置只有方向没有落点，
 *   而且四个人可能选出四个不同方向，最终还是要质量经理再猜一次。
 *   现在处置方案由 SQE 统一制定（带二维码分摊），评审员只对方案表态。
 * 旧值仍兼容（服务端把 legacy 四值映射成 agree），但前端**不得再发送**旧值。
 */
export const MRB_REVIEW_RESULTS = ['agree', 'disagree'] as const;

/** 评审结论文案映射；旧数据里可能残留处置值，用 MRB_DISPOSITION_LABEL_KEYS 兜底 */
export const MRB_REVIEW_RESULT_LABEL_KEYS: Record<string, string> = {
  agree: 'mrb.reviewAgree',
  disagree: 'mrb.reviewDisagree',
};

// ============================================================================
// MRB 状态机 / 处置枚举（v2.1）
// ⚠️ 唯一来源是 server/modules/mrb/mrb.status.ts，本文件是前端镜像，
//    两边改动必须同步；页面里禁止再各写一套状态数组或标签映射。
// ============================================================================

/** MRB 的 10 个状态（帮助文档口径） */
export const MRB_STATUSES = [
  'draft',
  'pending_review',
  'reviewing',
  'pending_approval',
  'pending_final',
  'pending_execute',
  'approved',
  'closed',
  'rejected',
  'cancelled',
] as const;

export type MrbStatus = (typeof MRB_STATUSES)[number];

/** 终态（已归档）：不计入进行中、不阻塞同批次再次发起、SLA 不再计算 */
export const MRB_DONE_STATUSES = ['closed', 'approved', 'rejected', 'cancelled'] as const;

/** 状态 → i18n 键（Badge 文案统一走这里，避免各页面重复写映射） */
export const MRB_STATUS_LABEL_KEYS: Record<string, string> = {
  draft: 'mrb.status_draft',
  pending_review: 'mrb.status_pending_review',
  reviewing: 'mrb.status_reviewing',
  pending_approval: 'mrb.status_pending_approval',
  pending_final: 'mrb.status_pending_final',
  pending_execute: 'mrb.status_pending_execute',
  approved: 'mrb.status_approved',
  closed: 'mrb.status_closed',
  rejected: 'mrb.status_rejected',
  cancelled: 'mrb.status_cancelled',
};

/** 状态 Badge 的视觉变体 */
export const MRB_STATUS_BADGE_VARIANT: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  pending_review: 'secondary',
  reviewing: 'default',
  pending_approval: 'outline',
  pending_final: 'outline',
  pending_execute: 'outline',
  approved: 'default',
  closed: 'secondary',
  rejected: 'destructive',
  cancelled: 'destructive',
};

/** 终审可用的处置方式（v2.1 起纳入 other，去向由 otherType 决定） */
export const MRB_DISPOSITION_TYPES = ['special_admit', 'return', 'rework', 'scrap', 'other'] as const;

export type MrbDispositionTypeValue = (typeof MRB_DISPOSITION_TYPES)[number];

/** 处置方式 → i18n 键 */
export const MRB_DISPOSITION_LABEL_KEYS: Record<string, string> = {
  special_admit: 'mrb.specialAdoption',
  return: 'mrb.returnGoods',
  rework: 'mrb.supplierRework',
  scrap: 'mrb.scrap',
  other: 'mrb.other',
  mixed: 'mrb.mixedDisposition',
};

/** 「其他」处置的三类去向（本期不做特批流程） */
export const MRB_OTHER_TYPES = ['customer_return', 'sample', 'hold'] as const;

export type MrbOtherTypeValue = (typeof MRB_OTHER_TYPES)[number];

/** 「其他」去向 → i18n 键 */
export const MRB_OTHER_TYPE_LABEL_KEYS: Record<string, string> = {
  customer_return: 'mrb.otherCustomerReturn',
  sample: 'mrb.otherSample',
  hold: 'mrb.otherHold',
};

/** 执行状态 → i18n 键 */
export const MRB_EXEC_STATUS_LABEL_KEYS: Record<string, string> = {
  /** MRB v3：SQE 已定方案但还没终审，尚未产生任何库存动作 */
  planned: 'mrb.exec_planned',
  pending: 'mrb.exec_pending',
  done: 'mrb.exec_done',
  cancelled: 'mrb.exec_cancelled',
};

/** 有权限做「预审」的角色（与后端 @NeedRoles 一致） */
export const MRB_PRE_APPROVE_ROLES = ['iqc_manager', 'admin'] as const;
/**
 * 有权限做「终审 / 驳回」的角色（与后端 MRB_FINAL_ROLES 一致）。
 *
 * MRB v3 起移除 `iqc_manager`：终审要判「整批退货」并生成退货单 + 供应商欠料，
 * 这是质量经理的决策权；IQC 主管已在报告审批环节把过一次关，再让他终审等于自己监督自己。
 */
export const MRB_FINAL_ROLES = ['quality_manager', 'admin'] as const;
/** 有权限发起 / 提交 / 指派 / 作废的角色 */
export const MRB_WRITE_ROLES = ['sqe', 'iqc_manager', 'quality_manager', 'admin'] as const;
/** 有权限对「其他-退回客户」明细做「确认已提走」的角色 */
export const MRB_CONFIRM_OUT_ROLES = ['wh_keeper', 'wh_manager', 'admin'] as const;
/**
 * 有权限对「报废」明细做「销毁核销」的角色（与后端 MRB_SCRAP_DESTROY_ROLES 一致）。
 *
 * v3 起报废 = 先调拨进不良品仓、再销毁，销毁是**减账**动作：
 * 仓管现场执行，质量经理可代确认（质量经理常驻现场、仓管不在时也能结单）。
 */
export const MRB_SCRAP_DESTROY_ROLES = [
  'wh_keeper',
  'wh_manager',
  'quality_manager',
  'admin',
] as const;

/* ============================================================================
   3.2 状态字典统一注册表
   ----------------------------------------------------------------------------
   此前"状态 → 标签 + Badge 变体"散落在 7 个页面里，各写一份 buildStatusMap。
   后果不是代码难看，而是**同一状态在不同页面显示不同文案/不同颜色**，
   用户学到的是"这个绿色代表合格，那个绿色代表已生效"。

   ＊ 注册表只存 **i18n 键 + 语义变体**，不存翻译结果 —— 翻译由调用方传 t 进来，
     这样语言切换时不需要重建字典。
   ＊ 未登记的状态**退化为原值 + secondary**，与各页面原来的兜底行为一致。
   ============================================================================ */

/** 与 ui/badge 的 variant 对齐 */
export type StatusVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning';

export interface StatusMeta {
  /** i18n 键（原样保存，翻译交给调用方） */
  labelKey: string;
  variant: StatusVariant;
  /**
   * 少数页面需要自定义配色（如 IQC 报告的审批状态、退料标签的库存状态）。
   * 这些规则暂时保留在这里而不是散回页面 —— 等 3.3 颜色清理时统一换成语义色。
   */
  colorClass?: string;
}

/** 库存状态（inventory.status_*） */
export const STOCK_STATUS: Record<string, StatusMeta> = {
  good: { labelKey: 'inventory.status_good', variant: 'default' },
  pending_qc: { labelKey: 'inventory.status_pending_qc', variant: 'secondary' },
  defective: { labelKey: 'inventory.status_defective', variant: 'destructive' },
  blocked: { labelKey: 'inventory.status_blocked', variant: 'secondary' },
  pending: { labelKey: 'inventory.status_pending', variant: 'secondary' },
};

/** 生产退料单状态 */
export const PRODUCTION_RETURN_STATUS: Record<string, StatusMeta> = {
  draft: { labelKey: 'ui.草稿', variant: 'secondary' },
  submitted_iqc: { labelKey: 'ui.已提交IQC', variant: 'default' },
  iqc_completed: { labelKey: 'ui.检验完成', variant: 'warning' },
  received: { labelKey: 'ui.已入库', variant: 'success' },
};

/** 生产退料「收货」单状态：只出现后两个阶段，与退料单共用同一套文案 */
export const RETURN_RECEIPT_STATUS: Record<string, StatusMeta> = {
  iqc_completed: { labelKey: 'ui.检验完成', variant: 'warning' },
  received: { labelKey: 'ui.已入库', variant: 'success' },
};

/** 超补领料单状态 */
export const OVER_PICKING_STATUS: Record<string, StatusMeta> = {
  pending_approval: { labelKey: 'iqc.reviewStatus.pending', variant: 'secondary' },
  approved: { labelKey: 'ui.已生效', variant: 'default' },
  rejected: { labelKey: 'workorder.rejected', variant: 'destructive' },
  cancelled: { labelKey: 'workorder.cancelled', variant: 'outline' },
};

/** 取某个状态的展示元数据；未登记的退化处理与各页面原行为一致 */
export function statusMeta(
  map: Record<string, StatusMeta>,
  status: string,
  t: (key: string) => string,
): { label: string; variant: StatusVariant } {
  const meta = map[status];
  if (!meta) return { label: status, variant: 'secondary' };
  return { label: t(meta.labelKey), variant: meta.variant };
}

/** IQC 报告审批状态（自定义配色：pending 紫 / approved 绿 / rejected 橙） */
export const IQC_REVIEW_STATUS: Record<string, StatusMeta> = {
  pending: { labelKey: 'iqc.reviewStatus.pending', variant: 'secondary', colorClass: 'bg-purple-100 text-purple-800' },
  approved: { labelKey: 'ui.已审批', variant: 'success', colorClass: 'bg-green-100 text-green-800' },
  rejected: { labelKey: 'workorder.rejected', variant: 'warning', colorClass: 'bg-orange-100 text-orange-800' },
};

/** 生产退料标签的库存状态（自定义配色用于标签卡片描边） */
export const LABEL_STOCK_STATUS: Record<string, StatusMeta> = {
  good: { labelKey: 'ui.良品', variant: 'success', colorClass: 'border-green-300 bg-green-50' },
  incoming_defect: { labelKey: 'ui.来料不良', variant: 'destructive', colorClass: 'border-red-300 bg-red-50' },
  operation_defect: { labelKey: 'ui.作业不良', variant: 'warning', colorClass: 'border-orange-300 bg-orange-50' },
};
