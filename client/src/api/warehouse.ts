import { apiGet, apiPost, apiPut, apiDelete } from './request';
import type { Warehouse, WarehouseLocation, PaginatedResponse } from '@shared/api.interface';

// ========== Warehouse ==========

export async function getWarehouseList(params: {
  page: number;
  pageSize: number;
  whCode?: string;
  whName?: string;
  status?: string;
}): Promise<PaginatedResponse<Warehouse>> {
  return apiGet<PaginatedResponse<Warehouse>>('/api/warehouse', params);
}

/**
 * 仓库列表。
 * @param includeInactive 查询筛选类下拉传 true（系统全部仓库，含停用），
 *   业务录入类下拉保持默认 false（只返回启用仓库）。
 */
export async function getAllWarehouses(includeInactive = false): Promise<Warehouse[]> {
  return apiGet<Warehouse[]>('/api/warehouse/all', includeInactive ? { includeInactive: 1 } : undefined);
}

export async function getWarehouse(id: string): Promise<Warehouse> {
  return apiGet<Warehouse>(`/api/warehouse/${id}`);
}

export async function createWarehouse(data: Omit<Warehouse, 'id'>): Promise<Warehouse> {
  return apiPost<Warehouse>('/api/warehouse', data);
}

export async function updateWarehouse(
  id: string,
  data: Partial<Omit<Warehouse, 'id'>>,
): Promise<Warehouse> {
  return apiPut<Warehouse>(`/api/warehouse/${id}`, data);
}

export async function deleteWarehouse(id: string): Promise<void> {
  return apiDelete<void>(`/api/warehouse/${id}`);
}

// ========== Warehouse Location ==========

export async function getLocationList(params: {
  page: number;
  pageSize: number;
  locationCode?: string;
  warehouseId?: string;
  locationType?: string;
  status?: string;
}): Promise<PaginatedResponse<WarehouseLocation>> {
  return apiGet<PaginatedResponse<WarehouseLocation>>('/api/warehouse/location', params);
}

export async function getAllLocations(): Promise<WarehouseLocation[]> {
  return apiGet<WarehouseLocation[]>('/api/warehouse/location/all');
}

export async function getLocation(id: string): Promise<WarehouseLocation> {
  return apiGet<WarehouseLocation>(`/api/warehouse/location/${id}`);
}

export async function createLocation(
  data: Omit<WarehouseLocation, 'id' | 'warehouseName'>,
): Promise<WarehouseLocation> {
  return apiPost<WarehouseLocation>('/api/warehouse/location', data);
}

export async function updateLocation(
  id: string,
  data: Partial<Omit<WarehouseLocation, 'id' | 'warehouseName'>>,
): Promise<WarehouseLocation> {
  return apiPut<WarehouseLocation>(`/api/warehouse/location/${id}`, data);
}

export async function deleteLocation(id: string): Promise<void> {
  return apiDelete<void>(`/api/warehouse/location/${id}`);
}
