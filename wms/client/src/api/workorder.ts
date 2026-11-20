import { apiGet, apiPost, apiPut, apiDelete } from './request';
import type {
  WorkOrder,
  MaterialRequirement,
  MaterialRequirementItem,
  PickingOrder,
  PaginatedResponse,
  PickMaterialResult,
  SubstitutionCheckResult,
} from '@shared/api.interface';
import { checkSubstitutionAvailability as _checkSubstitutionAvailability } from './material';

// Re-export so workorderApi.checkSubstitutionAvailability is available
export const checkSubstitutionAvailability = _checkSubstitutionAvailability;

// ========== Work Order ==========

export function getWorkOrderList(params: {
  page?: number;
  pageSize?: number;
  workOrderNo?: string;
  productCode?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  isSupplement?: boolean;
}) {
  return apiGet<PaginatedResponse<WorkOrder>>('/api/workorder/list', params);
}

export function createWorkOrder(data: {
  bomId: string;
  planQty: number;
  workOrderDate: string;
  remark?: string;
  /** 自定义工单号：可选，留空由后端自动生成 */
  workOrderNo?: string;
}) {
  return apiPost<WorkOrder>('/api/workorder/list', data);
}

export function getWorkOrderDetail(id: string) {
  return apiGet<WorkOrder>(`/api/workorder/list/${id}`);
}

// ========== Work Order Issue (下发) ==========

export function issueWorkOrder(data: { workOrderNo: string }) {
  return apiPost<PickingOrder[]>('/api/workorder/issue', data);
}

// ========== Work Order Recall/Close/Cancel (撤回/结案/取消) ==========

export function recallWorkOrder(data: { workOrderNo: string }) {
  return apiPost<void>('/api/workorder/recall', data);
}

export function closeWorkOrder(data: { workOrderNo: string }) {
  return apiPost<void>('/api/workorder/close', data);
}

export function cancelWorkOrder(data: { workOrderNo: string }) {
  return apiPost<void>('/api/workorder/cancel', data);
}

// ========== Material Requirement ==========

export function previewMaterialRequirement(data: { workOrderNo: string }) {
  return apiPost<{ items: MaterialRequirementItem[]; workOrderNo: string; sections: string[] }>('/api/workorder/requirement/preview', data);
}

export function generateMaterialRequirement(data: { workOrderNo: string }) {
  return apiPost<MaterialRequirement[]>('/api/workorder/requirement/generate', data);
}

export function getRequirementList(params: {
  page?: number;
  pageSize?: number;
  reqNo?: string;
  workOrderNo?: string;
  workSection?: string;
  status?: string;
}) {
  return apiGet<PaginatedResponse<MaterialRequirement>>(
    '/api/workorder/requirement/list',
    params,
  );
}

export function submitRequirement(id: string) {
  return apiPost<MaterialRequirement>(`/api/workorder/requirement/${id}/submit`, {});
}

export function submitRequirementsByWorkOrder(workOrderId: string) {
  return apiPost<MaterialRequirement[]>('/api/workorder/requirement/submit-by-workorder', { workOrderId });
}

export function batchSubmitRequirements(ids: string[]) {
  return apiPost<MaterialRequirement[]>('/api/workorder/requirement/batch-submit', { ids });
}

export function approveRequirement(id: string, data: {
  approvalRemark?: string;
  pass: boolean;
}) {
  return apiPost<MaterialRequirement>(`/api/workorder/requirement/${id}/approve`, data);
}

// ========== Picking Order ==========

export function getPickingOrderByNo(pickingNo: string) {
  return apiGet<PickingOrder>(`/api/workorder/picking/by-no/${encodeURIComponent(pickingNo)}`);
}

export function getPickingOrderList(params: {
  page?: number;
  pageSize?: number;
  pickingNo?: string;
  workOrderNo?: string;
  workSection?: string;
  status?: string;
}) {
  return apiGet<PaginatedResponse<PickingOrder>>('/api/workorder/picking/list', params);
}

export function getPickingOrdersByWorkOrder(workOrderId: string) {
  return apiGet<PickingOrder[]>(`/api/workorder/picking/by-workorder/${workOrderId}`);
}

export function batchApprovePickingOrders(data: {
  ids: string[];
  approvalRemark?: string;
  pass: boolean;
}) {
  return apiPost<PickingOrder[]>('/api/workorder/picking/batch-approve', data);
}

export function generatePickingOrder(data: { reqId: string }) {
  return apiPost<PickingOrder>('/api/workorder/picking/generate', data);
}

export function approvePickingOrder(id: string, data: {
  approvalRemark?: string;
  pass: boolean;
}) {
  return apiPost<PickingOrder>(`/api/workorder/picking/${id}/approve`, data);
}

export function pickMaterial(id: string, data: {
  items: Array<{ id: string; actualQty: number; labelNo?: string; labelQty?: number }>;
}) {
  return apiPost<PickMaterialResult>(`/api/workorder/picking/${id}/pick`, data);
}

/** 领料签收：发料完成后由领料方确认实收数量 */
export function receivePicking(id: string, data: {
  items?: Array<{ id: string; receivedQty: number; remark?: string }>;
  remark?: string;
}) {
  return apiPost<PickingOrder>(`/api/workorder/picking/${id}/receive`, data);
}

export function pickWithSubstitution(id: string, data: {
  pickerId?: string;
  pickerName?: string;
  items: Array<{ id: string; actualQty: number; labelNo?: string; labelQty?: number }>;
  substitutionMap: Record<string, string>;
}) {
  return apiPost<PickMaterialResult>(`/api/workorder/picking/${id}/pick-with-substitution`, data);
}

// ========== Supplement ==========

export function getSupplementList(params: {
  page?: number;
  pageSize?: number;
  parentOrderNo?: string;
  startDate?: string;
  endDate?: string;
}) {
  return apiGet<PaginatedResponse<WorkOrder>>('/api/workorder/supplement/list', params);
}

export function createSupplement(data: {
  parentOrderNo: string;
  supplementItems: Array<{ materialId: string; materialCode?: string; materialName?: string; unit?: string; quantity: number; workSection: string }>;
  reason: string;
}) {
  return apiPost<{ workOrder: WorkOrder; pickingOrders: PickingOrder[] }>(
    '/api/workorder/supplement/create',
    data,
  );
}

// ========== Production Return (产线退料) ==========

export interface ProductionReturnItem {
  id?: string;
  returnNo?: string;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  supplierCode?: string;
  supplierName?: string;
  quantity: number;
  unit?: string;
  productionDate?: string;
  batchNo?: string;
  returnReason?: string;
  workOrderNo?: string;
  status?: string;
  goodQty?: number;
  incomingDefectQty?: number;
  operationDefectQty?: number;
  remark?: string;
  submittedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export async function getProductionReturnList(params: {
  page: number;
  pageSize: number;
  returnNo?: string;
  materialCode?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}): Promise<PaginatedResponse<ProductionReturnItem>> {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<ProductionReturnItem> }>(
    '/api/workorder/production-return/list',
    params,
  );
  return res.data;
}

export async function getProductionReturnDetail(id: string): Promise<ProductionReturnItem> {
  const res = await apiGet<{ code: number; message: string; data: ProductionReturnItem }>(
    `/api/workorder/production-return/${id}`,
  );
  return res.data;
}

export async function createProductionReturn(data: Partial<ProductionReturnItem>): Promise<ProductionReturnItem> {
  const res = await apiPost<{ code: number; message: string; data: ProductionReturnItem }>(
    '/api/workorder/production-return',
    data,
  );
  return res.data;
}

/**
 * 批量制单：一次提交多个料号，服务端在一个事务里按行各生成一张退料单。
 * 行内数量/物料缺一不可，工单号与退料原因由单头共用。
 */
export async function createProductionReturnBatch(data: {
  workOrderNo: string;
  /** 单头兜底原因；行内 returnReason 优先 */
  returnReason?: string;
  items: Array<{
    materialId: string;
    quantity: number;
    productionDate?: string;
    batchNo?: string;
    supplierCode?: string;
    returnReason?: string;
  }>;
}): Promise<ProductionReturnItem[]> {
  const res = await apiPost<{ code: number; message: string; data: ProductionReturnItem[] }>(
    '/api/workorder/production-return/batch',
    data,
  );
  return res.data;
}

export async function updateProductionReturn(id: string, data: Partial<ProductionReturnItem>): Promise<ProductionReturnItem> {
  const res = await apiPut<{ code: number; message: string; data: ProductionReturnItem }>(
    `/api/workorder/production-return/${id}`,
    data,
  );
  return res.data;
}

export async function submitProductionReturn(id: string): Promise<ProductionReturnItem> {
  const res = await apiPost<{ code: number; message: string; data: ProductionReturnItem }>(
    `/api/workorder/production-return/${id}/submit`,
    {},
  );
  return res.data;
}

export async function deleteProductionReturn(id: string): Promise<void> {
  await apiDelete<void>(`/api/workorder/production-return/${id}`);
}

// ==================== SMT 盘装料 ====================

export interface PickingReelRow {
  id: string;
  pickingId: string;
  workOrderId: string;
  materialCode: string;
  materialName: string;
  unit?: string;
  reelNo: string;
  batchNo?: string;
  issuedQty: number;
  returnedQty: number;
  consumedQty: number;
  status: string;
  issuedAt?: string;
  returnedAt?: string;
}

export function listPickingReels(params: { workOrderNo?: string; reelNo?: string; status?: string }) {
  return apiGet<PickingReelRow[]>('/api/workorder/reel/list', params);
}

export function returnReel(data: {
  reelNo?: string;
  materialCode?: string;
  batchNo?: string;
  quantity: number;
  locationCode?: string;
  remark?: string;
}) {
  return apiPost<{ success: boolean; reelNo: string; quantity: number }>('/api/workorder/reel/return', data);
}

export interface ConsumptionItem {
  materialId?: string;
  materialCode: string;
  materialName: string;
  unit: string;
  standardQty: number;
  issuedQty: number;
  returnedQty: number;
  consumedQty: number;
  overQty: number;
  overRate: number;
  needsApproval: boolean;
}

export function getWorkOrderConsumption(workOrderNo: string) {
  return apiGet<{
    workOrderNo: string;
    status: string;
    planQty: number;
    overallRate: number;
    needsApproval: boolean;
    overConsumeStatus?: string;
    items: ConsumptionItem[];
  }>(`/api/workorder/consumption/${encodeURIComponent(workOrderNo)}`);
}

export function approveOverConsume(data: { workOrderNo: string; approved: boolean; remark?: string }) {
  return apiPost<{ success: boolean; status: string }>('/api/workorder/over-consume/approve', data);
}
