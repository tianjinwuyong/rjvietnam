import { apiGet, apiPost } from './request';
import type { PaginatedResponse, ReworkOrder } from '@shared/api.interface';

export interface ReworkListParams {
  page?: number;
  pageSize?: number;
  reworkNo?: string;
  status?: string;
  materialCode?: string;
}

export function getReworkList(params: ReworkListParams) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<ReworkOrder> }>(
    '/api/rework/list',
    params,
  );
}

export function getReworkDetail(id: string) {
  return apiGet<{ code: number; message: string; data: ReworkOrder }>(`/api/rework/detail/${id}`);
}

export function startRework(data: { id: string; operatorId?: string; remark?: string }) {
  return apiPost<{ code: number; message: string; data: ReworkOrder }>('/api/rework/start', data);
}

export function finishRework(data: { id: string; operatorId?: string; remark?: string }) {
  return apiPost<{ code: number; message: string; data: ReworkOrder }>('/api/rework/finish', data);
}

export function reinspectRework(data: {
  id: string;
  operatorId?: string;
  result: 'pass' | 'fail';
  remark?: string;
}) {
  return apiPost<{ code: number; message: string; data: ReworkOrder }>('/api/rework/reinspect', data);
}
