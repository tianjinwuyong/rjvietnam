import { apiGet, apiPost } from './request';
import type { ReceiptOrder, PaginatedResponse, QrParseResult, Warehouse, WarehouseLocation, SubmitIqcResult, ProductionReturn, ProductionReturnLabel } from '@shared/api.interface';

export interface VerifyQrResult extends QrParseResult {
  valid: boolean;
  supplierName?: string;
  materialName?: string;
  mslLevel?: string;
  unit?: string;
  errorMessage?: string;
  errorCode?: 'invalid_supplier' | 'unqualified_supplier' | 'unregistered_material' | 'duplicate_serial' | 'invalid_format';
}

export async function getActiveWarehouses(): Promise<Warehouse[]> {
  const res = await apiGet<{ code: number; message: string; data: Warehouse[] }>('/api/receipt/warehouses');
  return res.data;
}

export async function verifyLocationCode(params: {
  locationCode: string;
  warehouseId: string;
}): Promise<WarehouseLocation> {
  const res = await apiPost<{ code: number; message: string; data: WarehouseLocation }>(
    '/api/receipt/verify-location',
    params,
  );
  return res.data;
}

export async function batchReceipt(params: {
  items: Array<{ qrContent: string; quantity?: number }>;
  locationId: string;
}): Promise<ReceiptOrder[]> {
  const res = await apiPost<{ code: number; message: string; data: ReceiptOrder[] }>(
    '/api/receipt/batch-receipt',
    params,
  );
  return res.data;
}

export async function verifyQr(qrContent: string): Promise<VerifyQrResult> {
  const res = await apiPost<{ code: number; message: string; data: VerifyQrResult }>(
    '/api/receipt/verify-qr',
    { qrContent },
  );
  return res.data;
}

export async function scanReceipt(params: {
  qrContent: string;
  locationId?: string;
  actualQty?: number;
}): Promise<ReceiptOrder> {
  const res = await apiPost<{ code: number; message: string; data: ReceiptOrder }>(
    '/api/receipt/scan',
    params,
  );
  return res.data;
}

export async function getReceiptList(params: {
  page: number;
  pageSize: number;
  receiptNo?: string;
  supplierCode?: string;
  materialCode?: string;
  batchNo?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}): Promise<PaginatedResponse<ReceiptOrder>> {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<ReceiptOrder> }>(
    '/api/receipt/list',
    params,
  );
  return res.data;
}

export async function getReceiptDetail(id: string): Promise<ReceiptOrder> {
  const res = await apiGet<{ code: number; message: string; data: ReceiptOrder }>(
    `/api/receipt/list/${id}`,
  );
  return res.data;
}

/** 只读预览：本次「提交 IQC 检验」会覆盖多少张收料单、合并成多少个检验批次 */
export async function previewSubmitIqc(): Promise<{ receiptCount: number; lotCount: number }> {
  const res = await apiPost<{ code: number; message: string; data: { receiptCount: number; lotCount: number } }>(
    '/api/receipt/submit-iqc/preview',
    {},
  );
  return res.data;
}

export async function submitIqc(): Promise<SubmitIqcResult> {
  const res = await apiPost<{ code: number; message: string; data: SubmitIqcResult }>(
    '/api/receipt/submit-iqc',
    {},
  );
  return res.data;
}

// ========== Production Return Receipt (产线退料收料) ==========

export interface ProductionReturnReceiptItem {
  id: string;
  returnNo?: string;
  materialId?: string;
  materialCode?: string;
  materialName?: string;
  supplierCode?: string;
  supplierName?: string;
  quantity?: number;
  goodQty?: number;
  incomingDefectQty?: number;
  operationDefectQty?: number;
  unit?: string;
  productionDate?: string;
  batchNo?: string;
  returnReason?: string;
  status?: string;
  workOrderNo?: string;
  remark?: string;
  inspectedAt?: string;
  receivedAt?: string;
  createdAt?: string;
}

// ProductionReturnLabel is imported from @shared/api.interface

export async function getProductionReturnReceiptList(params: {
  page: number;
  pageSize: number;
  returnNo?: string;
  materialCode?: string;
  status?: string;
}): Promise<PaginatedResponse<ProductionReturnReceiptItem>> {
  const res = await apiGet<{ code: number; message: string; data: PaginatedResponse<ProductionReturnReceiptItem> }>(
    '/api/receipt/production-return/list',
    params,
  );
  return res.data;
}

export async function getProductionReturnReceiptDetail(id: string): Promise<ProductionReturnReceiptItem> {
  const res = await apiGet<{ code: number; message: string; data: ProductionReturnReceiptItem }>(
    `/api/receipt/production-return/${id}`,
  );
  return res.data;
}

export async function generateProductionReturnLabels(id: string): Promise<ProductionReturnLabel[]> {
  const res = await apiPost<{ code: number; message: string; data: ProductionReturnLabel[] }>(
    `/api/receipt/production-return/${id}/generate-labels`,
    {},
  );
  return res.data;
}

export async function scanProductionReturnInbound(data: {
  labelNo: string;
  locationId: string;
  quantity?: number;
}): Promise<ProductionReturn> {
  const res = await apiPost<{ code: number; message: string; data: ProductionReturn }>(
    '/api/receipt/production-return/scan-inbound',
    data,
  );
  return res.data;
}
