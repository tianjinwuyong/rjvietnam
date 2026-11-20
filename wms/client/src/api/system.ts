import { apiGet, apiPost, apiPut, apiDelete } from './request';
import type {
  SysParam,
  OperationLog,
  RoleUser,
  PaginatedResponse,
  SysRole,
  SysAccount,
  SysAccountImportResult,
  LoginResult,
  BatchCreateLocationResult,
} from '@shared/api.interface';

// ========== 系统参数 ==========

export interface SysParamListParams {
  page?: number;
  pageSize?: number;
  paramKey?: string;
}

export function getSysParamList(params: SysParamListParams) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<SysParam> }>('/api/system/param/list', params);
}

export function createSysParam(data: {
  paramKey: string;
  paramValue: string;
  paramNameZh?: string;
  paramNameVi?: string;
  paramNameEn?: string;
  description?: string;
}) {
  return apiPost<{ code: number; message: string; data: SysParam }>('/api/system/param', data);
}

export function updateSysParam(id: string, data: {
  paramValue?: string;
  paramNameZh?: string;
  paramNameVi?: string;
  paramNameEn?: string;
  description?: string;
}) {
  return apiPut<{ code: number; message: string; data: SysParam }>(`/api/system/param/${id}`, data);
}

export function deleteSysParam(id: string) {
  return apiDelete<{ code: number; message: string; data: null }>(`/api/system/param/${id}`);
}

export function getSysParamByKey(key: string) {
  return apiGet<{ code: number; message: string; data: SysParam }>(`/api/system/param/${key}`);
}

// ========== 操作日志 ==========

export interface OperationLogParams {
  page?: number;
  pageSize?: number;
  module?: string;
  operation?: string;
  operator?: string;
  startDate?: string;
  endDate?: string;
  relatedId?: string;
}

export function getOperationLogList(params: OperationLogParams) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<OperationLog> }>('/api/system/operation-log', params);
}

// ⚠️ 已移除审计补录写接口封装（2026-10-15）
// 后端 `POST /api/system/operation-log` 已一并移除：它允许手工写入任意审计记录，
// 而审计日志现由全局拦截器在业务成功时自动写入，无需补录。
// 查询接口 getOperationLogs（GET）保持不变。

// ========== 角色 ==========

export interface RoleInfo {
  roleCode: string;
  roleNameZh: string;
  roleNameEn: string;
  roleNameVi: string;
}

export function getRoleList() {
  return apiGet<{ code: number; message: string; data: RoleInfo[] }>('/api/system/role/list');
}

export function getRoleUserList(params: { page?: number; pageSize?: number; roleCode?: string }) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<RoleUser> }>('/api/system/role-user/list', params);
}

// ========== 登录 ==========

export function login(params: { account: string; password: string }) {
  return apiPost<{ code: number; message: string; data: LoginResult }>('/api/system/login', params);
}

/**
 * 自助修改自己的密码。
 *
 * 不传账号 id：服务端按登录态识别身份，因此这个接口无法用于修改他人密码。
 */
export function changePassword(params: {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}) {
  return apiPost<{ code: number; message: string; data: null }>('/api/system/change-password', params);
}

/**
 * 当前登录账号的最新状态。
 *
 * 前端启动时用它校正本地缓存的登录态（尤其是 `isFirstLogin`）：
 * 改密是账号级事实，但登录态缓存在各端 localStorage，
 * PC 端改完密码后 PDA 端不会自动感知，会重复弹改密框。
 */
export function getMe() {
  return apiGet<{
    code: number;
    message: string;
    data: {
      id: string;
      account: string;
      name: string;
      roleCode: string;
      workSection?: string;
      isFirstLogin: boolean;
      menuPermissions: string[];
    };
  }>('/api/system/me');
}

// ========== 角色管理 ==========

export function getAllRoles() {
  return apiGet<{ code: number; message: string; data: SysRole[] }>('/api/system/role/all');
}

export function getSysRoleList(params: { page?: number; pageSize?: number; roleName?: string; status?: string }) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<SysRole> }>('/api/system/role/list', params);
}

export function createRole(params: { roleCode: string; roleName: string; description?: string; menuPermissions: string[] }) {
  return apiPost<{ code: number; message: string; data: SysRole }>('/api/system/role', params);
}

export function updateRole(id: string, params: { roleName?: string; description?: string; menuPermissions?: string[]; status?: string }) {
  return apiPut<{ code: number; message: string; data: SysRole }>(`/api/system/role/${id}`, params);
}

// ========== 账号管理 ==========

export function getAccountList(params: { page?: number; pageSize?: number; account?: string; name?: string; roleCode?: string; status?: string }) {
  return apiGet<{ code: number; message: string; data: PaginatedResponse<SysAccount> }>('/api/system/account/list', params);
}

export function createAccount(params: { account: string; name: string; roleCode: string; workSection?: string }) {
  return apiPost<{ code: number; message: string; data: SysAccount }>('/api/system/account', params);
}

export function updateAccount(id: string, params: { name?: string; roleCode?: string; workSection?: string; status?: string }) {
  return apiPut<{ code: number; message: string; data: SysAccount }>(`/api/system/account/${id}`, params);
}

export function resetAccountPassword(id: string) {
  return apiPost<{ code: number; message: string; data: null }>(`/api/system/account/${id}/reset-password`, {});
}

export function deleteAccount(id: string) {
  return apiDelete<{ code: number; message: string; data: null }>(`/api/system/account/${id}`);
}

/**
 * 账号批量导入。
 *
 * 文件不走上传接口，而是读成 base64 放进请求体（与物料/供应商导入一致），
 * 因此服务端不需要 multer，也不需要新增任何依赖。
 */
export function importAccounts(params: { fileBase64: string }) {
  return apiPost<{ code: number; message: string; data: SysAccountImportResult }>(
    '/api/system/account/import',
    params,
  );
}

export function deleteRole(id: string) {
  return apiDelete<{ code: number; message: string; data: null }>(`/api/system/role/${id}`);
}

export function logout() {
  return apiPost<{ code: number; message: string; data: { success: boolean } }>('/api/system/logout', {});
}

// ========== 系统初始化（危险操作，仅系统管理员） ==========

/** 初始化预览：点下去会清空多少张表 / 多少行 / 多少个账号 */
export interface InitializePreview {
  tableCount: number;
  rowCount: number;
  accountCount: number;
  keepTables: string[];
  targets: string[];
}

/** 初始化结果 */
export interface InitializeResult {
  clearedTables: number;
  clearedRows: number;
  deletedAccounts: number;
  resetSequences: number;
  clearedLogs: boolean;
  keepTables: string[];
  adminAccount: string;
}

/** 初始化预览（只读，无副作用） */
export function getInitializePreview() {
  return apiGet<{ code: number; message: string; data: InitializePreview }>(
    '/api/system/initialize/preview',
  );
}

/**
 * 执行系统初始化：清空全部业务数据，仅保留 admin 账号。
 *
 * 服务端会重新校验当前登录密码 —— 前端校验只是防误触，不是安全边界。
 */
export function initializeSystem(params: {
  password: string;
  confirmText: string;
  clearLogs?: boolean;
}) {
  return apiPost<{ code: number; message: string; data: InitializeResult }>(
    '/api/system/initialize',
    params,
  );
}

// ========== 批量库位生成 ==========

export function batchCreateLocations(params: {
  warehouseId: string;
  areaCode: string;
  shelfCode: string;
  layerCode: string;
  startNo: number;
  endNo: number;
  locationType: string;
  digitLen?: number;
}) {
  return apiPost<{ code: number; message: string; data: BatchCreateLocationResult }>('/api/system/location/batch-create', params);
}
