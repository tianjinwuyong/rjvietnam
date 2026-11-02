import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './request';
import type { Bom, BomItem, PaginatedResponse } from '@shared/api.interface';

export interface BomItemInput {
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

export function getBomList(params: {
  page?: number;
  pageSize?: number;
  bomCode?: string;
  productCode?: string;
  productName?: string;
  status?: string;
}) {
  return apiGet<PaginatedResponse<Bom>>('/api/bom/list', params);
}

export function getBomDetail(id: string) {
  return apiGet<Bom & { items: BomItem[] }>(`/api/bom/list/${id}`);
}

export function createBom(data: {
  bomCode: string;
  productCode: string;
  productName: string;
  version?: string;
  description?: string;
  items: BomItemInput[];
}) {
  return apiPost<Bom & { items: BomItem[] }>('/api/bom/list', data);
}

export function updateBom(
  id: string,
  data: {
    bomCode?: string;
    productCode?: string;
    productName?: string;
    version?: string;
    description?: string;
    status?: string;
    items?: BomItemInput[];
  },
) {
  return apiPut<Bom & { items: BomItem[] }>(`/api/bom/list/${id}`, data);
}

export function deleteBom(id: string) {
  return apiDelete<{ success: boolean }>(`/api/bom/list/${id}`);
}

export function updateBomStatus(id: string, status: 'active' | 'inactive') {
  return apiPatch<{ success: boolean }>(`/api/bom/list/${id}/status`, { status });
}

export function getAllActiveBoms() {
  return apiGet<Bom[]>('/api/bom/all');
}
