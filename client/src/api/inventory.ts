import { apiGet, apiPost } from './request';
import request from './http';
import type { Inventory, StockTransfer, PaginatedResponse } from '@shared/api.interface';

export function getInventoryList(params: {
  page?: number;
  pageSize?: number;
  materialCode?: string;
  /** 库位 UUID */
  locationId?: string;
  /** 库位编码（模糊匹配） */
  locationCode?: string;
  batchNo?: string;
  warehouseId?: string;
  stockStatus?: string;
  /** 效期筛选：expired=已超期 / warning=超期预警（30 天内到期）；与 stockStatus 互斥 */
  expiryStatus?: 'expired' | 'warning';
  /** '1' = 仅看特采（后端同时兼容 onlySpecialAdmit） */
  specialAdmitOnly?: string;
}) {
  return apiGet<PaginatedResponse<Inventory>>('/api/inventory/list', params);
}

export function getInventorySummary() {
  return apiGet<Array<{ materialId: string; materialCode: string; materialName: string; totalQty: number; unit: string }>>(
    '/api/inventory/summary',
  );
}

/** 库存现有量统计行：仓库 + 物料 维度 */
export interface StockSummaryItem {
  warehouseCode: string;
  warehouseName?: string;
  whType?: string;
  materialCode: string;
  materialName?: string;
  unit?: string;
  /** 涉及库位数 */
  locations: number;
  /** 涉及批次数 */
  batches: number;
  /** 库存数量合计 */
  qty: number;
  /** 库存行数 */
  lines: number;
}

export interface StockSummaryResult {
  items: StockSummaryItem[];
  total: number;
  /** 当前筛选条件下的总数量（不分页） */
  grandQty: number;
  page: number;
  pageSize: number;
}

/** 库存现有量统计（含不良品仓） */
export function getStockSummary(params: {
  page?: number;
  pageSize?: number;
  warehouseCode?: string;
  materialCode?: string;
  includeDefective?: boolean;
  stockStatus?: string;
}): Promise<StockSummaryResult> {
  return apiGet<StockSummaryResult>('/api/inventory/stock-summary', {
    ...params,
    includeDefective: params.includeDefective === false ? '0' : '1',
  });
}

/**
 * 库存现有量统计 → 导出 Excel（.xlsx）
 *
 * 服务端按同一筛选条件导出**全部明细**（不分页），带合计行与筛选。
 * 用 blob 取回是因为该接口直接返回二进制文件、需要带上 JWT。
 */
export async function exportStockSummary(params: {
  warehouseCode?: string;
  materialCode?: string;
  includeDefective?: boolean;
  stockStatus?: string;
  /** 导出表头语言，跟随界面语言 */
  lang?: string;
}): Promise<Blob> {
  const res = await request.get('/api/inventory/stock-summary/export', {
    params: {
      warehouseCode: params.warehouseCode || undefined,
      materialCode: params.materialCode || undefined,
      includeDefective: params.includeDefective === false ? '0' : '1',
      stockStatus: params.stockStatus || undefined,
      lang: params.lang || 'zh',
    },
    responseType: 'blob',
  });
  return res.data;
}

export function transferStock(data: {
  fromLocationId: string;
  toLocationId: string;
  materialId: string;
  batchNo?: string;
  quantity: number;
  remark?: string;
}) {
  return apiPost<StockTransfer>('/api/inventory/transfer', data);
}

export function getTransferList(params: {
  page?: number;
  pageSize?: number;
  transferNo?: string;
  materialCode?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}) {
  return apiGet<PaginatedResponse<StockTransfer>>('/api/inventory/transfer/list', params);
}

export function intraTransfer(data: {
  warehouseId: string;
  fromLocationId: string;
  toLocationId: string;
  materialId: string;
  batchNo?: string;
  quantity: number;
  remark?: string;
}) {
  return apiPost<StockTransfer>('/api/inventory/intra-transfer', data);
}

export interface ScannedMoveItem {
  qrContent: string;
  supplierCode: string;
  materialCode: string;
  materialName: string;
  unit: string;
  productionDate: string;
  batchNo: string;
  serialNo: string;
  quantity: number;
  materialId: string;
  supplierId: string;
}

export function verifySourceLocation(data: {
  locationCode: string;
  items: Array<{ qrContent: string; supplierCode: string; materialCode: string; productionDate: string; batchNo: string; serialNo: string; quantity: number }>;
}) {
  return apiPost<{
    valid: boolean;
    errorCode?: string;
    errorMessage?: string;
    locationId?: string;
    locationCode?: string;
    warehouseId?: string;
    whCode?: string;
    items?: ScannedMoveItem[];
    failedItems?: Array<{ materialCode: string; batchNo: string; serialNo: string; reason: string }>;
  }>('/api/inventory/intra-transfer/verify-source', data);
}

export function verifyTargetLocation(data: {
  targetLocationCode: string;
  sourceWarehouseId: string;
}) {
  return apiPost<{
    valid: boolean;
    errorCode?: string;
    errorMessage?: string;
    locationId?: string;
    locationCode?: string;
    warehouseId?: string;
    whCode?: string;
  }>('/api/inventory/intra-transfer/verify-target', data);
}

export function batchIntraTransfer(data: {
  fromLocationId: string;
  toLocationId: string;
  warehouseId: string;
  items: ScannedMoveItem[];
  remark?: string;
}) {
  return apiPost<StockTransfer[]>('/api/inventory/intra-transfer/batch', data);
}

export function lockInventory(data: { inventoryId: string; lockReason: string }) {
  return apiPost<Inventory>('/api/inventory/lock', data);
}

export function unlockInventory(data: { inventoryId: string }) {
  return apiPost<Inventory>('/api/inventory/unlock', data);
}

export function getExpiryInventory(params: {
  type: 'warning' | 'expired';
  page?: number;
  pageSize?: number;
  materialCode?: string;
}) {
  return apiGet<PaginatedResponse<ExpiryInventoryItem>>('/api/inventory/expiry', params);
}

export function submitExpiryReinspection(data: { inventoryIds: string[] }) {
  return apiPost<{ count: number }>('/api/inventory/expiry/reinspect', data);
}

/** 某物料（可限定批次）在良品仓的超期 / 预警库存（IQC 检验页处置超期物料用） */
export function getMaterialExpiryStock(materialId: string, batchNo?: string) {
  return apiGet<ExpiryInventoryItem[]>('/api/inventory/expiry/by-material', {
    materialId,
    batchNo: batchNo || undefined,
  });
}

export function extendExpiry(data: {
  inventoryId: string;
  /** 检验员填写的延长天数（服务端按「当前有效期 + 天数」算截止日，并卡住强制报废期） */
  extendDays?: number;
  newExpiryDate?: string;
  remark?: string;
}) {
  return apiPost<{
    success: boolean;
    newExpiryDate: string;
    extendedDays: number;
    scrapDate: string | null;
    maxExtendDays: number | null;
  }>('/api/inventory/expiry/extend', data);
}

/**
 * 按「物料 + 物理批次」批量延期（IQC 待检清单用）。
 * 一个检验批次对应多个库位行时，服务端一次事务写完，避免前端循环半成功。
 * 只传 extendDays：截止日由服务端计算，且不得超过物料强制报废期。
 * @param batchNo 物理批次（去掉 -R01 之类复检后缀）
 */
export function extendExpiryByBatch(data: {
  materialId: string;
  batchNo: string;
  extendDays?: number;
  newExpiryDate?: string;
  remark?: string;
}) {
  return apiPost<{
    success: boolean;
    affected: number;
    extendedDays: number;
    earliestExpiryDate: string | null;
    newExpiryDate: string;
    scrapDate: string | null;
    maxExtendDays: number | null;
  }>('/api/inventory/expiry/extend-by-batch', data);
}

export interface ExpiryInventoryItem {
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
  /** 物料强制报废期（天，从生产日期起算）；null 表示不限 */
  forceScrapDays?: number | null;
  /** 强制报废截止日 = 生产日期 + 强制报废期天数；null 表示无上限 */
  scrapDate?: string | null;
}
