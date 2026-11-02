export type LanguageCode = 'zh' | 'vi' | 'en';

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Warehouse {
  id: string;
  whCode: string;
  whNameZh: string;
  whNameVi?: string;
  whNameEn?: string;
  whType: string;
  status: string;
  address?: string;
  description?: string;
}

export interface WarehouseLocation {
  id: string;
  locationCode: string;
  warehouseId: string;
  warehouseName?: string;
  areaCode?: string;
  shelfCode?: string;
  layerCode?: string;
  positionCode?: string;
  locationType: string;
  status: string;
  description?: string;
}

export interface Supplier {
  id: string;
  supplierCode: string;
  supplierName: string;
  supplierNameZh?: string;
  supplierNameVi?: string;
  supplierNameEn?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  status: string;
  description?: string;
}

export interface Material {
  id: string;
  materialCode: string;
  materialName: string;
  specification?: string;
  unit: string;
  materialType?: string;
  /** normal=普通包装，reel=盘装料（必须扫盘号收发） */
  packagingType?: string;
  /** 物料等级（与 MSL 防潮等级是两个维度，主数据导入必填） */
  grade?: string;
  mslLevel: string;
  vietnamCode?: string;
  inspectionStandard?: string;
  status: string;
  description?: string;
  expiryDays?: number;
  forceScrapDays?: number;
  unitPrice?: number;
  overIssueRatio?: number;
  supplementRatio?: number;
  supplierCode?: string;
  supplierName?: string;
  materialSource?: string;
}

export interface MaterialSubstitution {
  id: string;
  materialId: string;
  materialCode: string;
  materialName?: string;
  substituteMaterialId: string;
  substituteMaterialCode: string;
  substituteMaterialName?: string;
  remark?: string;
  status: string;
  substitutionType?: string;
  createdAt?: string;
}

export interface SubstituteMaterialInfo {
  materialId: string;
  materialCode: string;
  materialName: string;
  specification?: string;
  unit: string;
  stockQty: number;
}

export interface SubstitutionCheckResult {
  originalMaterialCode: string;
  originalMaterialName: string;
  originalStockQty: number;
  requiredQty: number;
  originalSufficient: boolean;
  substitutes: SubstituteMaterialInfo[];
}

/** 导入校对：单个字段的新旧值对比 */
export interface ImportFieldChange {
  /** 字段名（中文，直接展示） */
  field: string;
  oldValue: string;
  newValue: string;
}

/** 导入校对：一条主数据的处理动作 */
export interface ImportPreviewItem {
  code: string;
  name: string;
  /** create=新增 update=有变更 unchanged=无变化 */
  action: 'create' | 'update' | 'unchanged';
  changes: ImportFieldChange[];
}

/** 导入校对：供应商名称与系统库不一致 */
export interface SupplierNameConflict {
  supplierCode: string;
  /** 系统库中已有的名称 */
  existingName: string;
  /** 待导入文件中的名称 */
  incomingName: string;
  /** 物料导入时：该供应商被多少行物料引用 */
  affectedRows: number;
}

/** 物料导入校对结果：只做比对，不写任何数据 */
export interface MaterialImportPreviewResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: string[];
  /** 将新增的物料 */
  created: ImportPreviewItem[];
  /** 将更新的物料（仅列出有字段变化的） */
  updated: ImportPreviewItem[];
  /** 与系统完全一致、不会产生任何变更的条数 */
  unchangedCount: number;
  /** 供应商名称冲突（Excel 与系统库不一致） */
  supplierNameConflicts: SupplierNameConflict[];
  /** Excel 中引用、但系统供应商档案里不存在、将新建的供应商 */
  newSuppliers: { code: string; name: string }[];
  /** 因不在 Excel 中、将被标记为已归档的物料 */
  archivedMaterials: { code: string; name: string }[];
  /** 系统从文件表头实际识别到的列名（用于排查「缺少必填列」） */
  detectedHeaders?: string[];
  /** 文件里找不到的必填列；有值时整批不可导入 */
  missingColumns?: string[];
}

/** 供应商导入校对结果：只做比对，不写任何数据 */
export interface SupplierImportPreviewResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: string[];
  created: ImportPreviewItem[];
  updated: ImportPreviewItem[];
  unchangedCount: number;
  /** 名称冲突：Excel 想改、但系统库已有不同名称的供应商 */
  nameConflicts: SupplierNameConflict[];
  /** 因不在 Excel 中、将被标记为已归档的供应商 */
  archivedSuppliers: { code: string; name: string }[];
}

/** 名称被改写的供应商（导入后回报，便于用户复核） */
export interface ImportNameChange {
  supplierCode: string;
  oldName: string;
  newName: string;
}

export interface SubstitutionImportResult {
  successCount: number;
  errorCount: number;
  errors: string[];
  totalRows: number;
  skippedCount: number;
}

export interface SupplierMaterial {
  id: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  mslLevel: string;
  status: string;
}

export interface ReceiptOrder {
  id: string;
  receiptNo: string;
  receiptDate: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: string;
  productionDate?: string;
  batchNo?: string;
  serialNo?: string;
  locationId?: string;
  locationCode?: string;
  keeperId?: string;
  keeperName?: string;
  qrContent?: string;
  remark?: string;
  status: string;
}

export interface IqcLot {
  id: string;
  lotNo: string;
  /** 检验编号（仓库提交报检时生成，如 JY202610020001），IQC 报告编号即使用该字段 */
  inspectionNo?: string | null;
  receiptDate: string;
  /** 报检时间（仓库提交待检清单的时间） */
  submittedAt?: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  totalQty: number;
  unit: string;
  productionDate?: string;
  batchNo?: string;
  locationCodes?: string;
  boxCount?: number;
  materialSource?: string;
  inspectorId?: string;
  inspectorName?: string;
  approverId?: string;
  approverName?: string;
  inspectionResult: string;
  inspectionTime?: string;
  status: string;
  remark?: string;
  /** 该批次选定的检验模板（检验员重新进入时用于认回模板） */
  templateId?: string | null;
  lastTemplateId?: string | null;
  locationDetails?: IqcLocationDetail[];
  /**
   * 检验属性是否为免检（外观 + 尺寸功能两个类型都为免检时为 true）。
   * 待检清单据此显示「免检确认」入口：只核对物料编号/供应商等信息，维护合格即可，不做检验记录。
   */
  isExempt?: boolean;
}

export interface IqcLocationDetail {
  locationId: string;
  locationCode: string;
  quantity: number;
}

export interface SubmitIqcResult {
  createdLotCount: number;
  submittedReceiptCount: number;
  lotNos: string[];
  /** 本次报检新生成的检验编号（合并进已有批次的不会出现在这里） */
  inspectionNos?: string[];
}

export interface IqcInspectionItem {
  id: string;
  materialId: string;
  itemName: string;
  standard?: string;
  specMin?: string;
  specMax?: string;
  unit?: string;
  sortOrder: number;
  status: string;
}

export interface IqcInspectionRecord {
  id: string;
  lotId: string;
  itemId?: string;
  templateItemId?: string;
  sectionType?: string;
  itemName: string;
  standard?: string;
  specMin?: string;
  specMax?: string;
  /** 规格表达式（历史拼写 spc 已废弃，统一为 spec） */
  spec?: string;
  unit?: string;
  lsl?: string;
  usl?: string;
  measuredValue?: string;
  measuredValues?: string[];
  defectDescription?: string;
  defectQty: number;
  isPass?: boolean;
  sortOrder: number;
  samplingPlanText?: string;
  /** GB/T 2828.1 抽样方案的 AQL 值（如 0.40 / 1.0） */
  aql?: string;
  sampleSize?: number;
  ac?: number;
  re?: number;
}

export interface IqcReport {
  id: string;
  lotId: string;
  reportNo: string;
  finalResult: string;
  inspectorId?: string;
  inspectorName?: string;
  inspectionTime?: string;
  reviewerId?: string;
  reviewerName?: string;
  reviewTime?: string;
  reviewRemark?: string;
  reviewStatus?: 'pending' | 'approved' | 'rejected';
  rejectReason?: string;
  rejectTime?: string;
  rejectorId?: string;
  rejectorName?: string;
  remark?: string;
  /**
   * 判定方式（2026-10-18）：
   * - inspection：结论由检验小项推导（唯一正常路径）
   * - manual：批次无任何小项，由 IQC 主管/质量经理人工判定（原因必填）
   */
  judgeMode?: 'inspection' | 'manual';
  judgeReason?: string;
  judgedBy?: string;
  judgedByName?: string;
  judgedAt?: string;
  records?: IqcInspectionRecord[];
}

/** IQC 漏提报告异常项（待检超期 / 草稿超时） */
export interface IqcAnomalyItem {
  lotId: string;
  inspectionNo?: string;
  batchNo?: string;
  materialCode?: string;
  materialName?: string;
  supplierName?: string;
  submittedAt?: string;
  /** 已等待天数（待检超期） */
  days?: number;
  /** 草稿停留小时数（草稿超时） */
  hours?: number;
  draftUpdatedAt?: string;
}

/** 已出结论但没有任何检验小项的报告 */
export interface IqcZeroRecordReportItem {
  reportId: string;
  reportNo: string;
  inspectionNo?: string;
  materialCode?: string;
  materialName?: string;
  finalResult: string;
  judgeMode?: string;
  judgeReason?: string;
  judgedAt?: string;
  reviewStatus?: string;
}

export interface IqcAnomalyResult {
  thresholds: { pendingDays: number; draftHours: number };
  counts: { pendingOverdue: number; draftStale: number; zeroRecordJudged: number };
  pendingOverdue: IqcAnomalyItem[];
  draftStale: IqcAnomalyItem[];
  zeroRecordJudged: IqcZeroRecordReportItem[];
}

/** 人工判定台账行 */
export interface IqcManualJudgmentItem {
  reportId: string;
  reportNo: string;
  inspectionNo?: string;
  materialCode?: string;
  materialName?: string;
  supplierName?: string;
  finalResult: 'pass' | 'fail';
  judgeReason?: string;
  judgedByName?: string;
  judgedAt?: string;
  reviewStatus?: string;
  reviewName?: string;
}

export interface Inventory {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  locationId: string;
  locationCode: string;
  batchNo?: string;
  supplierId?: string;
  supplierName?: string;
  quantity: number;
  unit: string;
  stockStatus: string;
  productionDate?: string;
  expiryDate?: string;
  locked: boolean;
  lockReason?: string;
  /**
   * 是否为 MRB 特采放行入库的库存（帮助文档「特采放行后续影响」承诺的可查标记）。
   * ⚠️ 发料选料**不识别**该标记：特采件就是普通可用库存，任何拦截都是需求偏差。
   */
  isSpecialAdmit?: boolean;
  /** 产生该特采库存的 MRB 单号 */
  specialAdmitRef?: string;
}

export interface StockTransfer {
  id: string;
  transferNo: string;
  transferDate: string;
  fromLocationId: string;
  fromLocationCode: string;
  toLocationId: string;
  toLocationCode: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  batchNo?: string;
  quantity: number;
  unit: string;
  operatorId?: string;
  operatorName?: string;
  status: string;
  remark?: string;
}

export interface Bom {
  id: string;
  bomCode: string;
  productCode: string;
  productName: string;
  version: string;
  status: string;
  description?: string;
}

export interface BomItem {
  id: string;
  bomId: string;
  materialId?: string;
  materialCode: string;
  vietnamCode?: string;
  materialName: string;
  specification?: string;
  unit: string;
  quantity: number;
  workSection: string;
  sortOrder: number;
  remark?: string;
}

export interface WorkOrder {
  id: string;
  workOrderNo: string;
  bomId: string;
  bomCode: string;
  productCode: string;
  productName: string;
  planQty: number;
  actualQty: number;
  workOrderDate: string;
  isSupplement: boolean;
  parentOrderId?: string;
  parentOrderNo?: string;
  status: string;
  plannerId?: string;
  plannerName?: string;
  remark?: string;
  /** 来源：manual = WMS 自建，mes = 从 MES 同步（状态生命周期由 MES 主导） */
  source?: string;
  /** MES 工单号（source=mes 时有值） */
  mesMoNo?: string;
  /** MES 侧原始状态文本，仅展示用 */
  mesStatus?: string;
  /**
   * 是否由 MES 管控（领料单来自 MES，结案也在 MES）。
   * true 时前端不渲染下发/撤回/结案/取消按钮；WMS 自己开单的工单为 false，功能不变。
   */
  mesControlled?: boolean;
}

export interface MaterialRequirement {
  id: string;
  reqNo: string;
  workOrderId: string;
  workOrderNo: string;
  workSection?: string;
  totalQty: number;
  status: string;
  applicantId?: string;
  applicantName?: string;
  approverId?: string;
  approverName?: string;
  approvalTime?: string;
  approvalRemark?: string;
  remark?: string;
  items?: MaterialRequirementItem[];
}

export interface MaterialRequirementItem {
  id: string;
  reqId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  specification?: string;
  unit: string;
  unitUsage: number;
  requiredQty: number;
  baseQty?: number;
  overIssueQty?: number;
  supplementQty?: number;
  issuedQty: number;
  workSection?: string;
}

export interface PickingOrder {
  id: string;
  pickingNo: string;
  workOrderId: string;
  workOrderNo: string;
  /** 工单产品编码（随工单带出，便于按产品管理领料单） */
  productCode?: string;
  productName?: string;
  reqId?: string;
  workSection: string;
  isSupplement: boolean;
  totalQty: number;
  status: string;
  applicantId?: string;
  applicantName?: string;
  approverId?: string;
  approverName?: string;
  approvalTime?: string;
  approvalRemark?: string;
  pickerId?: string;
  pickerName?: string;
  pickTime?: string;
  /** OA 电子流实例与状态（领料完成确认） */
  oaInstanceId?: number;
  oaStatus?: string;
  /** 领料签收：实收确认人与时间 */
  receivedById?: string;
  receivedByName?: string;
  receivedTime?: string;
  receiveRemark?: string;
  remark?: string;
  /** manual = WMS 手工/工单下发，mes = 按 MES 用料自动生成 */
  source?: string;
  /** MES 侧领料单号（source=mes 时有值），对单用 */
  mesIssueNo?: string;
  items?: PickingOrderItem[];
}

export interface PickingOrderItem {
  id: string;
  pickingId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  pickQty: number;
  actualQty: number;
  /** 签收时确认的实收数量；未签收时为 0/undefined */
  receivedQty?: number;
  receiveRemark?: string;
  cumulativeQty?: number;
  diffQty?: number;
  actualMaterialId?: string;
  actualMaterialCode?: string;
  /**
   * 该物料「可用良品库存」所在的库位（PDA 领料拣货页展示，让现场知道去哪里取料）。
   * 筛选与排序条件与发料取料逻辑一致（良品 + 未锁定 + 良品仓 + 未超期，按生产日期/入库时间 FIFO），
   * 因此列表顺序即系统实际取料的先后顺序。
   */
  locations?: Array<{ locationCode: string; batchNo?: string; quantity: number }>;
}

export interface TailLabel {
  labelNo: string;
  materialCode: string;
  materialName: string;
  specification?: string;
  unit: string;
  supplierCode?: string;
  supplierName?: string;
  batchNo?: string;
  productionDate?: string;
  quantity: number;
  locationCode?: string;
  locationName?: string;
  direction: 'remain' | 'issue';
}

export interface PickMaterialResult {
  order: PickingOrder;
  tailLabels: TailLabel[];
}

export interface MrbReview {
  id: string;
  mrbNo: string;
  /** 来源 IQC 检验单号（MRB 单号前缀与之同源：JY...-MRB） */
  inspectionNo?: string;
  lotId: string;
  lotNo: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  batchNo?: string;
  quantity: number;
  unit: string;
  failReason?: string;
  status: string;
  finalDecision?: string;
  sqeId?: string;
  sqeName?: string;
  qualityManagerId?: string;
  qualityManagerName?: string;
  finalApprovalTime?: string;
  finalRemark?: string;
  remark?: string;
  createdAt?: string;
  reviewers?: MrbReviewer[];
  /** 拆分处置明细（旧数据可能为空） */
  dispositions?: MrbDisposition[];
  // ---- MRB v2.1 增量（全部可选，避免前端大面积改） ----
  /** 进入当前状态的时间（巡检 SLA 唯一基准） */
  statusSince?: string;
  /** 急件 */
  isUrgent?: boolean;
  urgentReason?: string;
  /** 资料齐全性预审结果 */
  completeness?: {
    result?: MrbCompletenessResult;
    by?: string;
    byName?: string;
    time?: string;
    remark?: string;
  };
  /** 急件跳过预审 或 admin 人工跳过 */
  skippedApproval?: boolean;
  /** 预审人 == 终审人（单人审批，列表/详情显示红标） */
  isSingleApprover?: boolean;
  /** 单人审批代审说明（2~200 字） */
  separationRemark?: string;
  /** 作废信息 */
  cancel?: { reason?: string; by?: string; byName?: string; time?: string };
  /** 撤回信息（评审中 → 待制定方案，v3.1） */
  withdraw?: { reason?: string; by?: string; byName?: string; time?: string };
  /** 驳回信息（预审 / 终审退回 SQE 改方案，v3.1） */
  returnBack?: {
    reason?: string;
    by?: string;
    byName?: string;
    time?: string;
    /** 退回来路：pending_approval=IQC主管审核 / pending_final=质量经理审批 */
    from?: string;
  };
  /** 停留小时数（终态为 null） */
  stuckHours?: number | null;
  /** 巡检等级 */
  slaLevel?: MrbSlaLevel;
  /** 「当前待办」推导结果（按状态） */
  currentTodo?: string;
}

/**
 * 可发起 MRB 的 IQC 批次
 * 条件：IQC 判定 fail，且该批次尚未发起过 MRB（驳回 / 取消的批次允许重新发起）
 */
export interface MrbPendingLot {
  /** IQC 批次 ID（iqc_lot.id，发起 MRB 时用这个值） */
  lotId: string;
  lotNo: string;
  inspectionNo?: string;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  supplierId?: string;
  supplierCode?: string;
  supplierName?: string;
  batchNo?: string;
  /** 报检数量 */
  quantity: number;
  unit: string;
  receiptDate?: string;
  inspectionTime?: string;
  defectType?: string;
  /** 可评审库存数量（不良品仓未占用 + 良品仓锁定），为 0 时无法发起 */
  reviewableQty: number;
  /** 不良品仓仍未处理的库存数量（>0 表示即使已完成过 MRB 也允许重新发起） */
  defectiveQty?: number;
  /** 仓内剩余未处理量（= 未被「其他」处置占用的不良品量，与 defectiveQty 同口径） */
  remainingDefectiveQty?: number;
  /** 历史评审次数（不含「驳回 / 取消」） */
  mrbCount?: number;
  /** 最近一次评审的单号 */
  lastMrbNo?: string;
  /** 最近一次评审的终审结论 */
  lastDecision?: string;
  /** 最近一次评审的终审时间 */
  lastMrbAt?: string;
  /** 是否为重新发起（该批次已完成过 MRB，且不良品仓仍有剩余库存） */
  isReopen?: boolean;
}

/**
 * 已处理 MRB 按 IQC 批次折叠后的分组
 * 同一批次多次评审（重新发起）合并为一行，展开可查看该批次全部历史单据
 */
export interface MrbLotGroup {
  /** IQC 批次 ID */
  lotId: string;
  batchNo?: string;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  supplierId?: string;
  supplierName?: string;
  unit: string;
  /** 该批次已归档的 MRB 单数（即评审次数，**不含** rejected / cancelled） */
  reviewCount: number;
  /** 该批次全部已归档子单数（含 rejected / cancelled，用于「另有 N 次驳回/作废」提示） */
  totalCount?: number;
  /** 该批次不良品仓未被「其他」处置占用的余量 */
  remainingDefectiveQty?: number;
  /** 是否可再次发起（无进行中单 + 仍有未占用不良品余量） */
  canReinitiate?: boolean;
  /** 最近一次评审（列表行展示用） */
  latest: MrbReview;
  /** 其余历史单据（不含 latest），按时间倒序 */
  history: MrbReview[];
}

export interface MrbReviewer {
  id: string;
  mrbId: string;
  reviewerId: string;
  reviewerName?: string;
  reviewerRole?: string;
  reviewOpinion?: string;
  reviewResult?: string;
  reviewTime?: string;
  sortOrder: number;
}

/** MRB 处置方式（v2.1 起纳入 other，具体去向由 otherType 决定） */
export type MrbDispositionType = 'special_admit' | 'return' | 'rework' | 'scrap' | 'other';

/** 「其他」处置的三类去向 */
export type MrbOtherType = 'customer_return' | 'sample' | 'hold';

/** 资料齐全性预审结果 */
export type MrbCompletenessResult = 'complete' | 'incomplete' | 'skipped';

/** 巡检等级 */
export type MrbSlaLevel = 'ok' | 'warn' | 'overdue';

/** 终审提交的处置明细行 */
export interface MrbDispositionInput {
  dispositionType: MrbDispositionType;
  quantity: number;
  remark?: string;
  /** dispositionType='other' 时必填 */
  otherType?: MrbOtherType;
  /** customer_return / sample 必填 */
  refNo?: string;
  /** hold 必填，YYYY-MM-DD，≥ 明天 且 ≤ 今天+90 天 */
  holdUntil?: string;
}

/** MRB 处置明细（终审后落库） */
export interface MrbDisposition {
  id: string;
  mrbId: string;
  dispositionType: MrbDispositionType;
  quantity: number;
  unit: string;
  fromLocationId?: string;
  toLocationId?: string;
  execStatus: string;
  execTime?: string;
  remark?: string;
  sortOrder: number;
  /** 下游单据号（退货单 / 返工单） */
  refNo?: string;
  refId?: string;
  /** 「其他」处置去向：customer_return / sample / hold */
  otherType?: MrbOtherType;
  /** 「其他」处置的关联单号 / 留样编号（对应 mrb_disposition.ref_no） */
  otherRefNo?: string;
  /** 「其他-待定暂存」的复核日期 YYYY-MM-DD */
  holdUntil?: string;
}

export type SupplierReturnStatus = 'pending_out' | 'out' | 'cancelled';

export interface SupplierReturnItem {
  id: string;
  orderId: string;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  batchNo?: string;
  locationId?: string;
  locationCode?: string;
  inventoryId?: string;
  quantity: number;
  outQty: number;
  unit: string;
  dispositionId?: string;
  sortOrder: number;
}

export interface SupplierReturnOrder {
  id: string;
  returnNo: string;
  mrbId?: string;
  mrbNo?: string;
  dispositionId?: string;
  supplierId?: string;
  supplierCode?: string;
  supplierName?: string;
  batchNo?: string;
  status: SupplierReturnStatus;
  totalQty: number;
  outQty: number;
  unit: string;
  outTime?: string;
  outBy?: string;
  remark?: string;
  createdAt?: string;
  items?: SupplierReturnItem[];
}

export type ReworkOrderStatus =
  | 'pending'
  | 'reworking'
  | 'pending_reinspect'
  | 'passed'
  | 'failed'
  | 'closed';

export interface ReworkOrder {
  id: string;
  reworkNo: string;
  mrbId?: string;
  mrbNo?: string;
  dispositionId?: string;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  supplierId?: string;
  supplierCode?: string;
  supplierName?: string;
  batchNo?: string;
  quantity: number;
  unit: string;
  status: ReworkOrderStatus;
  sourceLocationId?: string;
  sourceLocationCode?: string;
  targetLocationId?: string;
  targetLocationCode?: string;
  finishTime?: string;
  finishBy?: string;
  finishRemark?: string;
  reinspectTime?: string;
  reinspectBy?: string;
  reinspectResult?: string;
  reinspectRemark?: string;
  remark?: string;
  createdAt?: string;
}

export interface RoleUser {
  id: string;
  roleCode: string;
  userId: string;
  userName: string;
  workSection?: string;
  status: string;
}

export interface OperationLog {
  id: string;
  bizType: string;
  bizId?: string;
  bizNo?: string;
  action: string;
  actionDetail?: string;
  operatorId?: string;
  operatorName?: string;
  createdAt: string;
}

export interface SysParam {
  id: string;
  paramKey: string;
  paramValue: string;
  paramNameZh?: string;
  paramNameVi?: string;
  paramNameEn?: string;
  description?: string;
}

export interface QrParseResult {
  supplierCode: string;
  materialCode: string;
  productionDate: string;
  quantity: number;
  batchNo: string;
  serialNo: string;
}

export type WorkSection = 'smt' | 'dip' | 'assembly' | 'packing';

export interface SysRole {
  id: string;
  roleCode: string;
  roleName: string;
  description?: string;
  menuPermissions: string[];
  status: string;
  createdAt?: string;
}

export interface SysAccount {
  id: string;
  account: string;
  name: string;
  roleCode: string;
  workSection?: string;
  status: string;
  isFirstLogin: boolean;
  lastLoginAt?: string;
  createdAt?: string;
}

/**
 * 账号批量导入结果。
 *
 * `atomicRejected = true` 表示**本次一个账号都没建**——只要文件里有任何一行不合法，
 * 就整体拒绝。原因是：若允许"导入一半"，管理员改完错误行再传一次，
 * 已经建好的行会全部撞上「账号已存在」，反而无从下手。
 */
export interface SysAccountImportResult {
  /** 文件中的数据行数（不含表头、不含尾部的幽灵空行） */
  totalRows: number;
  /** 实际新建的账号数 */
  successCount: number;
  /** 校验失败的行数（= errors.length） */
  errorCount: number;
  /** 逐行错误明细，形如「第 3 行：角色编码『xxx』不存在」 */
  errors: string[];
  /** 新建成功的账号（登录名），供管理员核对/分发初始密码 */
  createdAccounts: string[];
  /** 是否因校验不通过而整体拒绝（true 时 successCount 恒为 0） */
  atomicRejected: boolean;
}

export interface LoginResult {
  id?: string;
  account: string;
  name: string;
  roleCode: string;
  workSection?: string;
  isFirstLogin: boolean;
  menuPermissions: string[];
  token: string;
}

export interface BatchCreateLocationResult {
  total: number;
  created: number;
  skipped: number;
  skippedCodes: string[];
}

export interface IqcTemplate {
  id: string;
  templateName: string;
  templateCode?: string;
  version: string;
  status: string;
  description?: string;
  packagingAql?: string;
  appearanceLevel?: string;
  appearanceAql?: string;
  dimensionLevel?: string;
  dimensionAql?: string;
  reliabilitySampleSize?: number;
  environmentalSampleSize?: number;
  rowCount?: number;
  colCount?: number;
  fileName?: string;
  sheetName?: string;
  materialCount?: number;
  itemCount?: number;
  /** 模板启用的检验分类 */
  selectedSections?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface IqcRawTemplateCell {
  r: number;
  c: number;
  v: string;
}

export interface IqcRawTemplateMerge {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

export interface IqcRawTemplate {
  id: string;
  templateName: string;
  /** Excel 导出的工作表名（可选，缺省用 Sheet1） */
  sheetName?: string;
  rowCount: number;
  colCount: number;
  cells: IqcRawTemplateCell[];
  merges: IqcRawTemplateMerge[];
  colWidths: number[];
}

export interface IqcTemplateItem {
  id: string;
  templateId: string;
  sectionType: string;
  itemName: string;
  itemNameVi?: string;
  itemNameEn?: string;
  standard?: string;
  standardVi?: string;
  standardEn?: string;
  /** 规格表达式（历史拼写 spc 已废弃） */
  spec?: string;
  lsl?: string;
  usl?: string;
  unit?: string;
  aql?: string;
  samplingPlanText?: string;
  sampleSize?: number;
  ac?: number;
  re?: number;
  sortOrder: number;
  isRequired?: boolean;
}

export interface IqcTemplateWithItems extends IqcTemplate {
  items: IqcTemplateItem[];
}

/** 标准检验项目库（全局共享，与模板解耦的快照源） */
export interface IqcStandardItem {
  id?: string;
  sectionType: string;
  itemName: string;
  itemNameVi?: string;
  itemNameEn?: string;
  standard?: string;
  standardVi?: string;
  standardEn?: string;
  /** 规格表达式（历史拼写 spc 已废弃） */
  spec?: string;
  lsl?: string;
  usl?: string;
  unit?: string;
  aql?: string;
  samplingPlanText?: string;
  sampleSize?: number;
  ac?: number;
  re?: number;
  sortOrder?: number;
  isRequired?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SamplingPlanResult {
  sampleSize: number;
  ac: number;
  re: number;
  level: string;
  aql: string;
  lotSize: number;
  codeLetter?: string;
  actualSampleSize?: number;
}

// ===== IQC 检验严格度 =====

export type StrictnessState = 'normal' | 'tightened' | 'reduced' | 'exempt' | 'suspended';
/**
 * 严格度账本维度。
 * 2026-10-19 起统一为 'material'：按物料维护一条，不再区分外观/尺寸；
 * 保留前两个值仅为兼容历史数据与历史转移日志。
 */
export type InspectionType = 'appearance' | 'dimensional' | 'material';

export interface IqcInspectionStrictness {
  id: string;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  inspectionType: InspectionType;
  strictness: StrictnessState;
  inspectionLevel: string;
  aql: string;
  consecutiveAccepted: number;
  recentRejectedIn5: number;
  tightenedRejectedTotal: number;
  tightenedConsecutiveAccepted: number;
  exceptionSource?: string;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IqcStrictnessTransferLog {
  id: string;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  inspectionType: InspectionType;
  fromStrictness: string;
  toStrictness: string;
  transferType: 'auto' | 'manual';
  reportId?: string;
  lotId?: string;
  reason?: string;
  operatorId?: string;
  operatorName?: string;
  createdAt: string;
}

export interface StrictnessConfigInput {
  materialId: string;
  inspectionType: InspectionType;
  inspectionLevel?: string;
  aql?: string;
}

export interface StrictnessManualAction {
  action: 'to_exempt' | 'to_normal_from_exempt' | 'to_tightened_from_suspended';
  operatorId: string;
  operatorName: string;
  reason?: string;
  exceptionSource?: string;
}

export interface IqcTemplateImportResult {
  templateId: string;
  templateName: string;
  rowCount: number;
  colCount: number;
  sheetName: string;
}

export interface ExpiryInventory {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  locationId: string;
  locationCode: string;
  batchNo?: string;
  productionDate?: string;
  expiryDate: string;
  remainingDays: number;
  quantity: number;
  unit: string;
  stockStatus: string;
  locked: boolean;
  lockReason?: string;
  supplierName?: string;
  /** 物料主数据的强制报废期（天，从生产日期起算）；为空表示该物料不限报废期 */
  forceScrapDays?: number | null;
  /** 强制报废截止日 = 生产日期 + 强制报废期天数；为空表示无上限 */
  scrapDate?: string | null;
}

export interface ExpiryReinspectionResult {
  lotIds: string[];
  count: number;
}

export interface DashboardStats {
  warehouseCount: number;
  materialCount: number;
  supplierCount: number;
  pendingIqcCount: number;
}

// ===== Dashboard 新增类型 =====

export interface DashboardOverview {
  todayReceiptLots: number;
  todayReceiptQty: number;
  todayIssueLots: number;
  todayIssueQty: number;
  stockSkuCount: number;
  stockTotalQty: number;
  pendingIqcCount: number;
  pendingIqcOver24hCount: number;
  todayPickingOrders: number;
  todayPickedQty: number;
}

export interface IqcSummary {
  totalLots: number;
  passedLots: number;
  passRate: number;
  targetPassRate: number;
}

export interface IqcTrendPoint {
  date: string;
  totalLots: number;
  passedLots: number;
  passRate: number;
  groupKey?: string;
}

/** 合格率排行条目（物料 / 供应商通用） */
export interface IqcRankItem {
  /** 识别键：物料编码 或 供应商编码 */
  key: string;
  /** 显示名：物料名称 或 供应商名称 */
  name: string;
  totalLots: number;
  passedLots: number;
  passRate: number;
}

/** IQC 检验看板聚合数据：一次请求返回汇总 + 趋势 + 排行 + 物料类型选项 */
export interface IqcStatsBundle {
  summary: {
    totalLots: number;
    passedLots: number;
    failedLots: number;
    passRate: number;
    targetPassRate: number;
  };
  trend: IqcTrendPoint[];
  topMaterials: IqcRankItem[];
  topSuppliers: IqcRankItem[];
  /** 筛选用物料类型选项（取自 material 表真实值） */
  materialTypes: string[];
}

export interface IqcDefectTypeItem {
  type: string;
  count: number;
}

export interface IqcDefectMaterialTypeItem {
  materialType: string;
  count: number;
}

/**
 * 不合格明细下钻（饼图点击后弹出的台账）
 *
 * 口径与饼图严格一致，统一按「合并后的 IQC 检验批数」统计：
 *   - 范围：iqc_lot.inspection_result IN ('pass','fail')
 *   - 不合格：inspection_result='fail' 或 (inspection_result='pass' AND status='rejected')
 * 因此一行的 lotId 即一个批次，明细行数 = 饼图扇区数值。
 */
export interface IqcDefectDetailItem {
  lotId: string;
  lotNo: string;
  receiptDate: string | null;
  batchNo: string | null;
  materialCode: string | null;
  materialName: string | null;
  materialType: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  totalQty: string | null;
  unit: string | null;
  inspectionResult: string | null;
  status: string | null;
  reportId: string | null;
  reportNo: string | null;
  /** 仅「按不良类型」维度：该批次的主不良类型 */
  mainDefectType?: string | null;
  /** 仅「按不良类型」维度：该批次不良项条数 */
  defectItemCount?: number;
  /** 仅「按不良类型」维度：该批次不良数量合计 */
  defectQtyTotal?: number | string | null;
  /** 仅「按不良类型」维度：该批次全部不良描述（去重后的清单，供台账展示） */
  defectDescriptions?: string[];
}

export interface IqcDefectDetailResult {
  items: IqcDefectDetailItem[];
  total: number;
  page: number;
  pageSize: number;
  /** 当前下钻维度 */
  dimension: 'type' | 'materialType';
  /** 当前下钻值 */
  value: string;
  startDate: string;
  endDate: string;
}

export interface IqcOverdueStats {
  warningCount: number;
  overdueCount: number;
}

export interface PendingStats {
  pendingCount: number;
  pendingOver24hCount: number;
  pendingCleared: boolean;
  over24hCleared: boolean;
}

export interface SupplementTopMaterial {
  materialCode: string;
  materialName: string;
  supplementQty: number;
  supplementRatio: number;
}

export interface SupplementRecentRecord {
  workOrderNo: string;
  pickingNo: string;
  materialCode: string;
  materialName: string;
  supplementQty: number;
  createdAt: string;
}

export interface SupplementSummary {
  supplementWorkOrderCount: number;
  supplementPickingCount: number;
  supplementTotalQty: number;
  topMaterials: SupplementTopMaterial[];
  recentRecords: SupplementRecentRecord[];
}

// ===== 产线退料 =====

export interface ProductionReturnIqc {
  id: string;
  returnId: string;
  goodQty: number;
  incomingDefectQty: number;
  operationDefectQty: number;
  inspectorId?: string;
  inspectorName?: string;
  inspectionTime?: string;
  remark?: string;
}

export interface ProductionReturn {
  id: string;
  returnNo: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  supplierId?: string;
  supplierCode?: string;
  supplierName?: string;
  quantity: number;
  unit: string;
  productionDate?: string;
  batchNo?: string;
  returnReason?: string;
  workOrderNo?: string;
  status: 'draft' | 'submitted_iqc' | 'iqc_completed' | 'received';
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  receivedGoodQty?: number;
  receivedIncomingDefectQty?: number;
  receivedOperationDefectQty?: number;
  iqcResult?: ProductionReturnIqc;
}

export interface ProductionReturnLabel {
  labelNo: string;
  /** 第 6 段短流水号 TL{yyyyMMdd}{3位流水}（打印在二维码下方） */
  serialNo: string;
  returnNo: string;
  materialCode: string;
  materialName: string;
  supplierCode?: string;
  supplierName?: string;
  quantity: number;
  stockStatus: 'good' | 'incoming_defect' | 'operation_defect';
  productionDate?: string;
  batchNo?: string;
}

// ===== 业务枚举（此处只放类型；运行时常量数组见 server/common/constants/business-enums.ts
//       与 client/src/constants/business-enums.ts —— 因为 nest build 不会把 shared/*.ts
//       编译进 dist，值导入 @shared/* 会在运行时 MODULE_NOT_FOUND）=====

/**
 * IQC 不合格类型（不良类型）固定八项。
 * 用户口径（2026-10-18）：包装、外观、尺寸、功能、安规、可靠性、环保、无检验资料。
 * 判定为 fail 时必填且只能取这些值；判定为 pass 时必须清空。
 */
export type IqcDefectType = '包装' | '外观' | '尺寸' | '功能' | '安规' | '可靠性' | '环保' | '无检验资料';

/**
 * MRB 评审结论（评审员意见）。
 * 用户口径（2026-10-18）：只能是 特采 / 返工 / 退货 / 报废 四项，
 * 旧的 同意(accept) / 否决(reject) / 偏差(deviation) 已废弃——
 * 「否决」与终审处置口径无关，下游无法据以执行。
 */
export type MrbReviewResult = 'special_admit' | 'return' | 'rework' | 'scrap';
