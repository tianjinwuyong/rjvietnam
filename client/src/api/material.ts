import { apiGet, apiPost, apiPut, apiDelete } from './request';
import type {
  Material,
  Supplier,
  PaginatedResponse,
  MaterialSubstitution,
  SubstituteMaterialInfo,
  SubstitutionCheckResult,
  SubstitutionImportResult,
  MaterialImportPreviewResult,
  SupplierImportPreviewResult,
  ImportNameChange,
} from '@shared/api.interface';

/** 导入接口返回（含名称变更清单与快照路径，供导入后复核） */
export interface MasterDataImportResponse {
  successCount: number;
  errorCount: number;
  errors: string[];
  totalRows: number;
  removedCount: number;
  nameChanges: ImportNameChange[];
  backupFile?: string;
}

// ========== Material ==========

export async function getMaterialList(params: {
  page: number;
  pageSize: number;
  materialCode?: string;
  materialName?: string;
  materialType?: string;
  packagingType?: string;
  status?: string;
}): Promise<PaginatedResponse<Material>> {
  return apiGet<PaginatedResponse<Material>>('/api/material', params);
}

export async function getAllMaterials(): Promise<Material[]> {
  return apiGet<Material[]>('/api/material/all');
}

export async function getMaterial(id: string): Promise<Material> {
  return apiGet<Material>(`/api/material/${id}`);
}

export async function createMaterial(data: Omit<Material, 'id'>): Promise<Material> {
  return apiPost<Material>('/api/material', data);
}

export async function updateMaterial(
  id: string,
  data: Partial<Omit<Material, 'id'>>,
): Promise<Material> {
  return apiPut<Material>(`/api/material/${id}`, data);
}

export async function deleteMaterial(id: string): Promise<void> {
  return apiDelete<void>(`/api/material/${id}`);
}

/** 物料导入校对：只比对，不写库 */
export async function previewMaterialImport(data: {
  fileBase64: string;
}): Promise<MaterialImportPreviewResult> {
  return apiPost<MaterialImportPreviewResult>('/api/material/import/preview', data);
}

export async function importMaterial(data: {
  fileBase64: string;
  applySupplierNameChanges?: boolean;
}): Promise<MasterDataImportResponse> {
  return apiPost<MasterDataImportResponse>('/api/material/import', data);
}

// ========== Supplier ==========

export async function getSupplierList(params: {
  page: number;
  pageSize: number;
  supplierCode?: string;
  supplierName?: string;
  status?: string;
  includeArchived?: boolean;
}): Promise<PaginatedResponse<Supplier>> {
  return apiGet<PaginatedResponse<Supplier>>('/api/material/supplier', params);
}

export async function getAllSuppliers(includeArchived = false): Promise<Supplier[]> {
  return apiGet<Supplier[]>('/api/material/supplier/all', includeArchived ? { includeArchived: true } : undefined);
}

/** 供应商导入校对：只比对，不写库 */
export async function previewSupplierImport(data: {
  fileBase64: string;
}): Promise<SupplierImportPreviewResult> {
  return apiPost<SupplierImportPreviewResult>('/api/material/supplier/import/preview', data);
}

export async function importSuppliers(data: {
  fileBase64: string;
  applySupplierNameChanges?: boolean;
}): Promise<MasterDataImportResponse> {
  return apiPost<MasterDataImportResponse>('/api/material/supplier/import', data);
}

export async function getSupplier(id: string): Promise<Supplier> {
  return apiGet<Supplier>(`/api/material/supplier/${id}`);
}

export async function createSupplier(data: Omit<Supplier, 'id'>): Promise<Supplier> {
  return apiPost<Supplier>('/api/material/supplier', data);
}

export async function updateSupplier(
  id: string,
  data: Partial<Omit<Supplier, 'id'>>,
): Promise<Supplier> {
  return apiPut<Supplier>(`/api/material/supplier/${id}`, data);
}

export async function deleteSupplier(id: string): Promise<void> {
  return apiDelete<void>(`/api/material/supplier/${id}`);
}

// ========== Material Substitution ==========

export async function importSubstitution(data: {
  fileBase64: string;
  twoWay?: boolean;
}): Promise<SubstitutionImportResult> {
  return apiPost<SubstitutionImportResult>('/api/material/substitution/import', data);
}

export async function getSubstitutionList(params: {
  page: number;
  pageSize: number;
  materialCode?: string;
}): Promise<PaginatedResponse<MaterialSubstitution>> {
  return apiGet<PaginatedResponse<MaterialSubstitution>>(
    '/api/material/substitution/list',
    params,
  );
}

export async function deleteSubstitution(id: string): Promise<void> {
  return apiDelete<void>(`/api/material/substitution/${id}`);
}

export async function getSubstitutesByMaterial(
  materialCode: string,
): Promise<SubstituteMaterialInfo[]> {
  return apiGet<SubstituteMaterialInfo[]>(
    '/api/material/substitution/by-material',
    { materialCode },
  );
}

export async function checkSubstitutionAvailability(
  materialCode: string,
  qty: number,
): Promise<SubstitutionCheckResult> {
  return apiGet<SubstitutionCheckResult>(
    '/api/material/substitution/check-availability',
    { materialCode, qty },
  );
}
