import { apiGet, apiPost } from './request';

/**
 * 不良品调拨单（统一单据：MRB 派生 + 良品手工制单）。
 *
 * 流程：
 *  - MRB 判退货 / 报废 / 否决 → 终审自动生成（待执行），仓库直接扫码执行；
 *  - 良品仓发现不良 → 仓管员制单（待确认）→ 仓库主管确认生效（待执行）→ 仓管员扫码执行。
 *
 * 执行接口只接受「扫描到的货物标签」+「扫描到的库位码」，不再接受库位 ID 直传。
 */
export interface DefectiveMoveTask {
  id: string;
  moveNo?: string | null;
  /** 来源 IQC 检验单号；手工制单为空 */
  sourceInspectionNo?: string | null;
  lotId?: string | null;
  mrbId?: string | null;
  mrbNo?: string | null;
  /** mrb_return / mrb_scrap / mrb_reject / manual */
  source?: string | null;
  reason?: string | null;
  materialId?: string;
  materialCode?: string | null;
  materialName?: string | null;
  supplierId?: string | null;
  supplierCode?: string | null;
  supplierName?: string | null;
  batchNo?: string | null;
  quantity: number;
  unit?: string | null;
  fromLocationId?: string;
  fromLocationCode?: string | null;
  toLocationId?: string | null;
  toLocationCode?: string | null;
  inventoryId?: string | null;
  fromStockStatus?: string | null;
  /** pending_confirm / pending / completed / cancelled */
  status: string;
  remark?: string | null;
  confirmRemark?: string | null;
  confirmedAt?: string | null;
  scanToCode?: string | null;
  scanAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  operatorId?: string | null;
  operatorName?: string | null;
  createdById?: string | null;
  createdByName?: string | null;
  confirmedByName?: string | null;
}

export interface DefectiveMoveListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  materialCode?: string;
  mrbNo?: string;
  source?: string;
  keyword?: string;
}

export interface DefectiveLocation {
  id: string;
  locationCode: string;
  whCode: string;
  whNameZh: string;
  whNameEn?: string | null;
  stockRows: number;
}

/** 制单可选的来源库存（良品仓） */
export interface DefectiveSourceStock {
  inventoryId: string;
  materialCode: string;
  materialName: any;
  batchNo: string;
  availableQty: number;
  unit: string;
  supplierId?: string | null;
  supplierName?: string | null;
  productionDate?: string | null;
  locationId: string;
  locationCode: string;
  whCode: string;
  whNameZh: string;
}

export interface ScanResult {
  matched: boolean;
  code: string;
  materialCode: string;
  materialName: any;
  batchNo: string;
  qty: number | null;
  unit: string;
  expectQty: number;
  expectMaterial: string;
  expectBatch: string;
}

export function getDefectiveMoveList(params: DefectiveMoveListParams) {
  return apiGet<{
    items: DefectiveMoveTask[];
    total: number;
    page: number;
    pageSize: number;
  }>('/api/defective-move/list', params as Record<string, any>);
}

export function getDefectiveMovePendingCount() {
  return apiGet<{ pending: number; pendingConfirm: number; total: number }>(
    '/api/defective-move/pending-count',
  );
}

export function getDefectiveLocations() {
  return apiGet<DefectiveLocation[]>('/api/defective-move/locations');
}

export function getDefectiveSourceStock(params: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  return apiGet<{ items: DefectiveSourceStock[]; total: number; page: number; pageSize: number }>(
    '/api/defective-move/source-stock',
    params,
  );
}

export function getDefectiveMoveDetail(id: string) {
  return apiGet<DefectiveMoveTask>(`/api/defective-move/detail/${id}`);
}

/** 制单（仓管员）：良品仓库存 → 不良品仓 */
export function createDefectiveMove(payload: {
  inventoryId: string;
  quantity: number;
  reason: string;
  remark?: string;
}) {
  return apiPost<{ id: string; moveNo: string; status: string }>(
    '/api/defective-move/create',
    payload,
  );
}

/** 仓库主管确认生效 / 驳回 */
export function confirmDefectiveMove(id: string, approve: boolean, remark?: string) {
  return apiPost<{ status: string; moveNo: string }>(`/api/defective-move/${id}/confirm`, {
    approve,
    remark,
  });
}

export function cancelDefectiveMove(id: string, reason?: string) {
  return apiPost<{ success: boolean }>(`/api/defective-move/${id}/cancel`, { reason });
}

/** 扫描货物标签，校验是否属于本单 */
export function scanDefectiveMoveCode(id: string, code: string) {
  return apiPost<ScanResult>(`/api/defective-move/${id}/scan`, { code });
}

/** 执行调拨：必须传扫码得到的货物标签与目标库位码 */
export function completeDefectiveMove(
  id: string,
  payload: { scannedCodes: string[]; toLocationCode: string },
) {
  return apiPost<{
    success: boolean;
    message: string;
    quantity: number;
    stockStatus: string;
    toLocationCode: string;
  }>(`/api/defective-move/${id}/complete`, payload);
}
