import { apiGet, apiPost } from './request';

export interface OverPickingItem {
  id?: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  specification?: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  workSection?: string;
  reason?: string;
}

export interface OverPickingOrder {
  oaInstanceId?: number;
  oaStatus?: string;
  id: string;
  orderNo: string;
  workOrderId: string;
  workOrderNo: string;
  status: string;
  totalQty: number;
  totalAmount: number;
  applicantId?: string;
  applicantName?: string;
  approverName?: string;
  approvalTime?: string;
  approvalRemark?: string;
  pickingId?: string;
  pickingNo?: string;
  remark?: string;
  createdAt?: string;
  items?: OverPickingItem[];
}

export function createOverPickingOrder(data: {
  workOrderNo: string;
  items: Array<{ materialId?: string; materialCode?: string; quantity: number; workSection?: string; reason?: string }>;
  remark?: string;
}) {
  return apiPost<OverPickingOrder>('/api/over-picking', data);
}

export function getOverPickingList(params: {
  page?: number;
  pageSize?: number;
  orderNo?: string;
  workOrderNo?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}) {
  return apiGet<{ items: OverPickingOrder[]; total: number; page: number; pageSize: number }>(
    '/api/over-picking/list',
    params,
  );
}

export function getOverPickingDetail(id: string) {
  return apiGet<OverPickingOrder>(`/api/over-picking/detail/${id}`);
}

export function approveOverPickingOrder(id: string, data: { pass: boolean; approvalRemark?: string }) {
  return apiPost<OverPickingOrder>(`/api/over-picking/${id}/approve`, data);
}

export function cancelOverPickingOrder(id: string) {
  return apiPost<OverPickingOrder>(`/api/over-picking/${id}/cancel`, {});
}

export function getOverPickingStats(params: { startDate?: string; endDate?: string }) {
  return apiGet<{
    orderCount: number;
    totalQty: number;
    totalAmount: number;
    byWorkOrder: Array<{ workOrderNo: string; orderCount: number; totalQty: number; totalAmount: number }>;
  }>('/api/over-picking/stats', params);
}
