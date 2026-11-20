import { apiGet, apiPost } from './request';
import type { PaginatedResponse, SupplierReturnOrder } from '@shared/api.interface';

export interface SupplierReturnListParams {
  page?: number;
  pageSize?: number;
  returnNo?: string;
  status?: string;
  supplierCode?: string;
  startDate?: string;
  endDate?: string;
}

export function getSupplierReturnList(params: SupplierReturnListParams) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<SupplierReturnOrder> }>(
    '/api/supplier-return/list',
    params,
  );
}

export function getSupplierReturnDetail(id: string) {
  return apiGet<{ code: number; message: string; data: SupplierReturnOrder }>(
    `/api/supplier-return/detail/${id}`,
  );
}

export function confirmSupplierReturnOutbound(data: {
  orderId: string;
  operatorId?: string;
  remark?: string;
}) {
  return apiPost<{ code: number; message: string; data: SupplierReturnOrder }>(
    '/api/supplier-return/outbound',
    data,
  );
}

export function cancelSupplierReturn(data: {
  orderId: string;
  operatorId?: string;
  remark?: string;
}) {
  return apiPost<{ code: number; message: string; data: SupplierReturnOrder }>(
    '/api/supplier-return/cancel',
    data,
  );
}
