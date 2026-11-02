import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './request';
import request from './http';
import { logger } from '@client/src/utils/logger';
import type {
  IqcLot,
  IqcInspectionItem,
  IqcInspectionRecord,
  IqcReport,
  IqcTemplate,
  IqcTemplateItem,
  IqcTemplateWithItems,
  IqcTemplateImportResult,
  IqcRawTemplate,
  IqcStandardItem,
  SamplingPlanResult,
  PaginatedResponse,
  IqcLocationDetail,
  IqcInspectionStrictness,
  IqcStrictnessTransferLog,
  IqcAnomalyResult,
  IqcManualJudgmentItem,
} from '@shared/api.interface';

// 供页面直接从 '@client/src/api/iqc' 引用（此前只是本地导入未再导出，导致 TS2459）
export type { IqcRawTemplate };

export interface IqcInspectionRecordInput {
  itemId?: string;
  templateItemId?: string;
  sectionType?: string;
  itemName: string;
  standard?: string;
  /** 规格表达式（历史拼写 spc 已废弃） */
  spec?: string;
  specMin?: string;
  specMax?: string;
  unit?: string;
  lsl?: string;
  usl?: string;
  measuredValue?: string;
  measuredValues?: string[];
  defectDescription?: string;
  defectQty?: number;
  isPass?: boolean;
  sortOrder?: number;
  samplingPlanText?: string;
  /** GB/T 2828.1 抽样方案的 AQL 值（如 0.40 / 1.0） */
  aql?: string;
  sampleSize?: number;
  ac?: number;
  re?: number;
}

export interface IqcLotWithReceipts extends IqcLot {
  receipts?: any[];
  locationDetails?: IqcLocationDetail[];
}

export interface IqcReportWithDetail extends IqcReport {
  lot?: IqcLot;
  records?: IqcInspectionRecord[];
}

export async function getPendingList(params: {
  page: number;
  pageSize: number;
  materialCode?: string;
  supplierCode?: string;
  batchNo?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  /** 多状态筛选（逗号分隔） */
  statuses?: string;
}): Promise<PaginatedResponse<IqcLot>> {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<IqcLot> }>(
    '/api/iqc/pending',
    params,
  );
  return res.data;
}

/**
 * 人工判定（仅 IQC 主管 / 质量经理 / 管理员可用）。
 * 只允许用于「完全没有检验小项」的批次，且必须填写原因，服务端会二次校验。
 */
export async function judgeLot(
  lotId: string,
  result: 'pass' | 'fail',
  options: { reason?: string; defectType?: string } = {},
): Promise<IqcLot> {
  const res = await apiPost<{ code: number; message: string; data: IqcLot }>(
    `/api/iqc/lot/${lotId}/judge`,
    { finalResult: result, reason: options.reason, defectType: options.defectType },
  );
  return res.data;
}

/** 漏提报告异常清单：待检超期 / 草稿超时 / 已出结论但零小项 */
export async function getIqcAnomalies(params: { pendingDays?: number; draftHours?: number } = {}) {
  const res = await apiGet<{ code: number; message: string; data: IqcAnomalyResult }>(
    '/api/iqc/anomalies',
    params,
  );
  return res.data;
}

/** 人工判定台账（仅主管角色可查） */
export async function getManualJudgments(params: {
  page?: number;
  pageSize?: number;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}) {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<IqcManualJudgmentItem> }>(
    '/api/iqc/manual-judgments',
    params,
  );
  return res.data;
}

/**
 * 免检确认：检验属性（外观 + 尺寸功能）均为免检的批次，
 * IQC 核对物料编号、供应商等信息后直接维护为合格并放行（不生成检验报告与检验记录）。
 */
export async function exemptConfirmLot(
  lotId: string,
  data: { operatorId?: string; operatorName?: string; remark?: string } = {},
): Promise<IqcLot> {
  const res = await apiPost<{ code: number; message: string; data: IqcLot }>(
    `/api/iqc/lot/${lotId}/exempt-confirm`,
    data,
  );
  return res.data;
}

export async function saveInspectionRecords(
  lotId: string,
  params: {
    records: IqcInspectionRecordInput[];
    inspectorId: string;
    inspectorName: string;
    remark?: string;
  },
): Promise<IqcLot> {
  const res = await apiPost<{ code: number; message: string; data: IqcLot }>(
    `/api/iqc/lot/${lotId}/save-records`,
    params,
  );
  return res.data;
}

/** 检验草稿：检验员填写过程中的暂存内容（含选定模板） */
export interface IqcInspectDraft {
  version?: number;
  lotId?: string;
  templateId?: string | null;
  records: IqcInspectionRecordInput[];
  remark?: string;
  defectType?: string;
  updatedAt?: string;
}

/** 读取服务端草稿（没有则 null） */
export async function getInspectionDraft(lotId: string): Promise<IqcInspectDraft | null> {
  const res = await apiGet<{ code: number; message: string; data: IqcInspectDraft | null }>(
    `/api/iqc/lot/${lotId}/draft`,
  );
  return res.data;
}

/** 保存服务端草稿 */
export async function saveInspectionDraft(
  lotId: string,
  payload: Partial<IqcInspectDraft> & { inspectorId?: string },
): Promise<{ updatedAt: string }> {
  const res = await apiPut<{ code: number; message: string; data: { updatedAt: string } }>(
    `/api/iqc/lot/${lotId}/draft`,
    payload,
  );
  return res.data;
}

/**
 * 离页兜底保存：用 fetch keepalive，保证 beforeunload/pagehide 时请求也能发出。
 * axios 在页面卸载时请求会被中断，这里单独走原生 fetch。
 */
export function saveInspectionDraftBeacon(lotId: string, payload: Record<string, any>): void {
  try {
    const saved = localStorage.getItem('wms-user');
    const token = saved ? JSON.parse(saved)?.token : null;
    void fetch(`/api/iqc/lot/${lotId}/draft`, {
      method: 'PUT',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // 兜底逻辑失败不影响用户操作
  }
}

/** 清除服务端草稿（提交成功后调用） */
export async function clearInspectionDraft(lotId: string): Promise<void> {
  await apiDelete<void>(`/api/iqc/lot/${lotId}/draft`);
}

/** 读取该批次已落库的检验记录（驳回重检再进入时回填） */
export async function getLotRecords(lotId: string): Promise<IqcInspectionRecordInput[]> {
  const res = await apiGet<{ code: number; message: string; data: IqcInspectionRecordInput[] }>(
    `/api/iqc/lot/${lotId}/records`,
  );
  return res.data || [];
}

export async function getLotDetail(id: string): Promise<IqcLotWithReceipts> {
  const res = await apiGet<{ code: number; message: string; data: IqcLotWithReceipts }>(
    `/api/iqc/lot/${id}`,
  );
  return res.data;
}

export async function getInspectionItems(materialId: string): Promise<IqcInspectionItem[]> {
  const res = await apiGet<{ code: number; message: string; data: IqcInspectionItem[] }>(
    `/api/iqc/inspection-items/${materialId}`,
  );
  return res.data;
}

export async function submitInspection(
  lotId: string,
  params: {
    records: IqcInspectionRecordInput[];
    finalResult: 'pass' | 'fail';
    inspectorId: string;
    inspectorName: string;
    remark?: string;
    /** 不合格类型：finalResult=fail 时必填（八项之一） */
    defectType?: string;
  },
): Promise<IqcLot> {
  const res = await apiPost<{ code: number; message: string; data: IqcLot }>(
    `/api/iqc/inspect/${lotId}`,
    params,
  );
  return res.data;
}

export async function getRecordList(params: {
  page: number;
  pageSize: number;
  batchNo?: string;
  materialCode?: string;
  supplierCode?: string;
  inspectorId?: string;
  startDate?: string;
  endDate?: string;
  reviewStatus?: string;
  finalResult?: string;
  reportNo?: string;
}): Promise<PaginatedResponse<IqcReportWithDetail>> {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<IqcReportWithDetail> }>(
    '/api/iqc/records',
    params,
  );
  return res.data;
}

export async function getReportDetail(id: string): Promise<IqcReportWithDetail> {
  const res = await apiGet<{ code: number; message: string; data: IqcReportWithDetail }>(
    `/api/iqc/report/${id}`,
  );
  return res.data;
}

export async function reviewReport(
  id: string,
  params: { reviewerId: string; reviewerName: string; reviewRemark?: string },
): Promise<IqcReport> {
  const res = await apiPost<{ code: number; message: string; data: IqcReport }>(
    `/api/iqc/report/${id}/review`,
    params,
  );
  return res.data;
}

export async function rejectReport(
  id: string,
  params: { rejectorId: string; rejectorName: string; rejectReason: string },
): Promise<IqcReport> {
  const res = await apiPost<{ code: number; message: string; data: IqcReport }>(
    `/api/iqc/report/${id}/reject`,
    params,
  );
  return res.data;
}

export async function batchApproveReports(params: {
  ids: string[];
  reviewerId: string;
  reviewerName: string;
}): Promise<{ success: number; failed: number; failedDetails: { id: string; reason: string; reportNo?: string }[] }> {
  const res = await apiPost<{ code: number; message: string; data: { success: number; failed: number; failedDetails: { id: string; reason: string; reportNo?: string }[] } }>(
    '/api/iqc/report/batch-approve',
    params,
  );
  return res.data;
}

// ========== Template ==========

export async function getTemplateList(params: {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}): Promise<PaginatedResponse<IqcTemplate>> {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<IqcTemplate> }>(
    '/api/iqc/templates',
    params,
  );
  return res.data;
}

export async function getTemplateDetail(id: string): Promise<IqcTemplateWithItems> {
  const res = await apiGet<{ code: number; message: string; data: IqcTemplateWithItems }>(
    `/api/iqc/templates/${id}`,
  );
  return res.data;
}

export async function createTemplate(
  // copyFromStandard 是服务端支持的扩展参数，未出现在 IqcTemplate 主体上
  data: Partial<IqcTemplate> & { copyFromStandard?: boolean },
): Promise<IqcTemplate> {
  const res = await apiPost<{ code: number; message: string; data: IqcTemplate }>(
    '/api/iqc/templates',
    data,
  );
  return res.data;
}

export async function updateTemplate(id: string, data: Partial<IqcTemplate>): Promise<IqcTemplate> {
  const res = await apiPatch<{ code: number; message: string; data: IqcTemplate }>(
    `/api/iqc/templates/${id}`,
    data,
  );
  return res.data;
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiDelete<void>(`/api/iqc/templates/${id}`);
}

export async function saveTemplateItems(id: string, items: IqcTemplateItem[]): Promise<void> {
  await apiPut<void>(`/api/iqc/templates/${id}/items`, { items });
}

export async function getTemplateMaterials(id: string): Promise<{ id: string; materialCode: string; materialName: string }[]> {
  const res = await apiGet<{ code: number; message: string; data: { id: string; materialCode: string; materialName: string }[] }>(
    `/api/iqc/templates/${id}/materials`,
  );
  return res.data;
}

export async function bindTemplateMaterials(id: string, materialIds: string[]): Promise<void> {
  await apiPut<void>(`/api/iqc/templates/${id}/materials`, { materialIds });
}

export async function getTemplateByMaterial(materialId: string): Promise<IqcTemplateWithItems | null> {
  const res = await apiGet<{ code: number; message: string; data: IqcTemplateWithItems | null }>(
    `/api/iqc/templates/by-material/${materialId}`,
  );
  return res.data;
}

export async function calculateSampling(params: {
  lotSize: number;
  level: string;
  aql: string;
}): Promise<SamplingPlanResult> {
  const res = await apiGet<{ code: number; message: string; data: SamplingPlanResult }>(
    '/api/iqc/templates/sampling/calculate',
    params,
  );
  return res.data;
}

/** 国标抽样计算（支持严格度） */
export async function calculateSamplingPlanApi(params: {
  lotSize: number;
  level: string;
  aql: string;
  strictness?: string;
}): Promise<SamplingPlanResult> {
  const res = await apiGet<{ code: number; message: string; data: SamplingPlanResult }>(
    '/api/iqc/sampling/calculate',
    params,
  );
  return res.data;
}

/** 批量抽样计算结果（服务端按物料当前严格度计算） */
export interface SamplingPlanItemResult {
  sampleSize: number;
  ac: number;
  re: number;
  /** normal / tightened / reduced / fixed */
  strictness: string;
  /** true = 按严格度重算；false = 沿用模板固定值 */
  applied: boolean;
  codeLetter?: string;
}

/**
 * 批量取检验项目的抽样方案（严格度驱动）。
 * 检验单打开时一次调用，避免逐项请求；服务端是唯一口径来源。
 */
export async function getSamplingPlans(params: {
  materialId?: string;
  lotSize: number;
  items: Array<{
    sectionType?: string;
    samplingPlanText?: string;
    aql?: string;
    sampleSize?: number;
    ac?: number;
    re?: number;
  }>;
}): Promise<{
  items: SamplingPlanItemResult[];
  strictness: { appearance: string; dimensional: string };
}> {
  const res = await apiPost<{
    code: number;
    message: string;
    data: { items: SamplingPlanItemResult[]; strictness: { appearance: string; dimensional: string } };
  }>('/api/iqc/sampling/plans', params);
  return res.data;
}

export async function importTemplate(file: File, customName?: string): Promise<IqcTemplateImportResult> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (customName) formData.append('templateName', customName);
    const response = await request.post<{ code: number; message: string; data: IqcTemplateImportResult }>(
      '/api/iqc/templates/import',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
    );
    return response.data.data;
  } catch (error) {
    logger.error('API POST import template failed', error);
    throw error;
  }
}

export async function getRawTemplate(id: string): Promise<IqcRawTemplate> {
  const res = await apiGet<{ code: number; message: string; data: IqcRawTemplate }>(
    `/api/iqc/templates/raw/${id}`,
  );
  return res.data;
}

export async function getLastUsedTemplate(materialId: string): Promise<IqcTemplate | null> {
  const res = await apiGet<{ code: number; message: string; data: IqcTemplate | null }>(
    `/api/iqc/templates/last-used/${materialId}`,
  );
  return res.data;
}

export async function setLotTemplate(lotId: string, templateId: string): Promise<IqcLot> {
  // 服务端路由是 @Put('lot/:id/template')，这里必须用 PUT（原来用 POST 一直 404，
  // 导致「选定的模板」根本没存到批次上，下次进入只能重选）
  const res = await apiPut<{ code: number; message: string; data: IqcLot }>(
    `/api/iqc/lot/${lotId}/template`,
    { templateId },
  );
  return res.data;
}

export async function exportTemplate(id: string): Promise<Blob> {
  try {
    const response = await request.get(
      `/api/iqc/templates/export/${id}`,
      { responseType: 'blob' },
    );
    return response.data;
  } catch (error) {
    logger.error('API GET export template failed', error);
    throw error;
  }
}

// ========== Standard item library ==========

export async function getStandardItems(sectionType?: string): Promise<IqcStandardItem[]> {
  const res = await apiGet<{ code: number; message: string; data: IqcStandardItem[] }>(
    '/api/iqc/standard-items',
    sectionType ? { sectionType } : {},
  );
  return res.data;
}

export async function createStandardItem(data: Partial<IqcStandardItem>): Promise<IqcStandardItem> {
  const res = await apiPost<{ code: number; message: string; data: IqcStandardItem }>(
    '/api/iqc/standard-items',
    data,
  );
  return res.data;
}

export async function updateStandardItem(id: string, data: Partial<IqcStandardItem>): Promise<IqcStandardItem> {
  const res = await apiPut<{ code: number; message: string; data: IqcStandardItem }>(
    `/api/iqc/standard-items/${id}`,
    data,
  );
  return res.data;
}

export async function deleteStandardItem(id: string): Promise<void> {
  await apiDelete<void>(`/api/iqc/standard-items/${id}`);
}

/** 从标准库重新导入某个分类的项目到模板 */
export async function importTemplateSection(templateId: string, sectionType: string): Promise<{ count: number }> {
  const res = await apiPost<{ code: number; message: string; data: { count: number } }>(
    `/api/iqc/templates/${templateId}/import-section`,
    { sectionType },
  );
  return res.data;
}

// ========== Strictness management ==========

export async function getStrictnessList(params: {
  page: number;
  pageSize: number;
  materialCode?: string;
  materialName?: string;
  strictness?: string;
}): Promise<PaginatedResponse<IqcInspectionStrictness>> {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<IqcInspectionStrictness> }>(
    '/api/iqc/strictness/list',
    params,
  );
  return res.data;
}

export async function getStrictnessTransferLogs(params: {
  materialId?: string;
  page: number;
  pageSize: number;
}): Promise<PaginatedResponse<IqcStrictnessTransferLog>> {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<IqcStrictnessTransferLog> }>(
    '/api/iqc/strictness/transfer-logs',
    params,
  );
  return res.data;
}

export async function configureStrictness(data: {
  materialId: string;
  inspectionLevel: string;
  aql: string;
  operatorId?: string;
}): Promise<IqcInspectionStrictness> {
  const res = await apiPost<{ code: number; message: string; data: IqcInspectionStrictness }>(
    '/api/iqc/strictness/configure',
    data,
  );
  return res.data;
}

export async function manualStrictnessAction(data: {
  materialId: string;
  action:
    | 'to_normal'
    | 'to_tightened'
    | 'to_exempt'
    | 'to_reduced_from_exempt'
    | 'to_normal_from_exempt'
    | 'to_tightened_from_exempt'
    | 'to_tightened_from_suspended';
  operatorId: string;
  operatorName: string;
  reason?: string;
  exceptionSource?: string;
}): Promise<IqcInspectionStrictness> {
  const res = await apiPost<{ code: number; message: string; data: IqcInspectionStrictness }>(
    '/api/iqc/strictness/manual-action',
    data,
  );
  return res.data;
}

/**
 * 当前物料的严格度（物料级一条账，不再区分外观/尺寸）。
 */
export async function getCurrentStrictness(
  materialId: string,
): Promise<{ strictness: string; inspectionLevel: string; aql: string; isExempt: boolean; isSuspended: boolean } | null> {
  const res = await apiGet<{ code: number; message: string; data: any }>(
    '/api/iqc/strictness/current',
    { materialId },
  );
  return res.data;
}

// ========== Production Return Inspection (产线退料检验) ==========

export interface ProductionReturnPendingItem {
  id: string;
  returnNo?: string;
  materialId?: string;
  materialCode?: string;
  materialName?: string;
  supplierCode?: string;
  supplierName?: string;
  quantity?: number;
  unit?: string;
  productionDate?: string;
  batchNo?: string;
  returnReason?: string;
  status?: string;
  submittedAt?: string;
  workOrderNo?: string;
  remark?: string;
}

export async function getProductionReturnPendingList(params: {
  page: number;
  pageSize: number;
  returnNo?: string;
  materialCode?: string;
  supplierCode?: string;
  startDate?: string;
  endDate?: string;
}): Promise<PaginatedResponse<ProductionReturnPendingItem>> {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<ProductionReturnPendingItem> }>(
    '/api/iqc/production-return/pending',
    params,
  );
  return res.data;
}

export async function inspectProductionReturn(
  id: string,
  data: {
    goodQty: number;
    incomingDefectQty: number;
    operationDefectQty: number;
    remark?: string;
  },
): Promise<ProductionReturnPendingItem> {
  const res = await apiPost<{ code: number; message: string; data: ProductionReturnPendingItem }>(
    `/api/iqc/production-return/${id}/inspect`,
    data,
  );
  return res.data;
}

/**
 * 根据物料编码查询最近一次检验各项目的 Spec/LSL/USL，用于自动带出
 */
export async function getLastSpecs(materialCode: string): Promise<Array<{ itemName: string; spec: string | null; lsl: string | null; usl: string | null }>> {
  const res = await apiGet<{ code: number; message: string; data: Array<{ itemName: string; spec: string | null; lsl: string | null; usl: string | null }> }>(
    `/api/iqc/last-specs/${encodeURIComponent(materialCode)}`,
  );
  return res.data;
}

/**
 * 手动触发一次「超期 / 预警物料推送待检清单」扫描。
 * 正常由后端 ExpiryScanService 每天 08:30 自动执行，这里用于当天例外补推。
 */
export async function scanExpiryStock(): Promise<{ created: number; skipped: boolean }> {
  const res = await apiPost<{ code: number; message: string; data: { created: number; skipped: boolean } }>(
    '/api/iqc/expiry/scan',
    {},
  );
  return res.data;
}

/** 超期扫描调度状态（下次执行时间 / 是否正在执行） */
export async function getExpiryScanStatus(): Promise<{
  enabled: boolean;
  scanTime: string;
  nextRunAt: string | null;
  running: boolean;
  lastRunDate: string | null;
}> {
  const res = await apiGet<{
    code: number;
    message: string;
    data: { enabled: boolean; scanTime: string; nextRunAt: string | null; running: boolean; lastRunDate: string | null };
  }>('/api/iqc/expiry/scan/status');
  return res.data;
}
