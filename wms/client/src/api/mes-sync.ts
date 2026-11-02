import { apiGet, apiPost, apiPut } from './request';

/** MES 接入：配置 / 同步 / 待领料 / 开单 */

export interface MesSyncStatus {
  configured: boolean;
  baseUrl: string;
  autoSync: boolean;
  intervalMinutes: number;
  autoPicking: boolean;
  pickingQtyMode: 'suggest' | 'open';
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  lastRequestId: string | null;
  cursor: string | null;
  counts: {
    mesWorkOrders: number;
    mesWorkOrdersPending: number;
    openMaterials: number;
    openMos: number;
    mesPickingOrders: number;
    /** 已生效、等待仓库发料的 MES 领料单 */
    mesPickingToIssue: number;
    /** 待回写 MES 的发料事件 */
    writebackPending: number;
    /** 超出重试上限、需人工处理的回写 */
    writebackFailed: number;
  };
}

export interface MesSyncConfig {
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  autoSync: boolean;
  intervalMinutes: number;
  autoPicking: boolean;
  /** MES 领料单是否直接生效（免审批） */
  pickingAutoApprove: boolean;
  pickingQtyMode: 'suggest' | 'open';
  /** 对接操作人账号 id（MES 不返回人员时，领料单由他代签） */
  operatorId: string;
  /** 对接操作人显示名，如「张三（zhangsan）」 */
  operatorName: string;
  /** 发料结果是否回写 MES */
  writebackEnabled: boolean;
}

export interface MesSyncResult {
  ok: boolean;
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  cursorFrom: string | null;
  cursorTo: string | null;
  messages: string[];
}

export interface MesPendingMo {
  id: string;
  workOrderNo: string;
  productCode: string;
  productName: string;
  productModel: string | null;
  planQty: number;
  woType: string | null;
  lineCode: string | null;
  poNo: string | null;
  custCode: string | null;
  planStart: string | null;
  planEnd: string | null;
  mesStatus: string | null;
  status: string;
  mesIssueNo: string | null;
  mesIssueStatus: string | null;
  hasBom: boolean;
  materialCount: number;
  openQty: number;
  unmatchedCount: number;
  pickingCount: number;
  pickingPending: number;
  mesSyncedAt: string | null;
}

export interface MesPendingResult {
  items: MesPendingMo[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MesMaterialRow {
  materialCode: string;
  materialName: string;
  specification: string | null;
  unit: string;
  workSection: string;
  qtyPer: number;
  needQty: number;
  issueQty: number;
  openQty: number;
  mpq: number;
  suggestQty: number;
  posRef: string | null;
  altList: string | null;
  isAlt: boolean;
  srcType: string | null;
  segmentRaw: string | null;
  availableQty: number;
  shortageQty: number;
}

export interface MesSyncLogRow {
  id: string;
  task: string;
  status: string;
  pulled: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  message: string | null;
  requestId: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function getMesStatus() {
  return apiGet<MesSyncStatus>('/api/mes-sync/status');
}

export function getMesConfig() {
  return apiGet<MesSyncConfig>('/api/mes-sync/config');
}

export function saveMesConfig(data: {
  baseUrl?: string;
  apiKey?: string;
  autoSync?: boolean;
  intervalMinutes?: number;
  autoPicking?: boolean;
  pickingQtyMode?: 'suggest' | 'open';
  pickingAutoApprove?: boolean;
  operatorId?: string;
  writebackEnabled?: boolean;
}) {
  return apiPut<MesSyncConfig>('/api/mes-sync/config', data);
}

export function testMesConnection() {
  return apiPost<{
    ok: boolean;
    baseUrl: string;
    service: string;
    serverTime: string;
    utcOffset: string;
    latencyMs: number;
    requestId: string | null;
  }>('/api/mes-sync/test');
}

export function syncMesWorkOrders(data?: { full?: boolean; withMaterials?: boolean }) {
  return apiPost<MesSyncResult & { operator: string }>('/api/mes-sync/sync', data ?? {});
}

export function syncMesPending(data?: { autoPicking?: boolean }) {
  return apiPost<MesSyncResult>('/api/mes-sync/sync-pending', data ?? {});
}

export function getMesPending(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  onlyOpen?: boolean;
}) {
  return apiGet<MesPendingResult>('/api/mes-sync/pending', params);
}

export function getMesMaterials(moNo: string) {
  return apiGet<{ moNo: string; items: MesMaterialRow[] }>(
    `/api/mes-sync/materials/${encodeURIComponent(moNo)}`,
  );
}

export function syncMesMaterials(moNo: string) {
  return apiPost<{
    moNo: string;
    source: string;
    bomVersionUsed: string;
    materialCount: number;
    missingMaterialCount: number;
  }>(`/api/mes-sync/materials/${encodeURIComponent(moNo)}/sync`);
}

export function generateMesPicking(moNo: string, data?: { sections?: string[]; includeZero?: boolean }) {
  return apiPost<{
    moNo: string;
    mode: string;
    created: number;
    refreshed: number;
    skipped: number;
    pickingNos: string[];
  }>(`/api/mes-sync/picking/${encodeURIComponent(moNo)}/generate`, data ?? {});
}

export function getMesLogs(limit = 50) {
  return apiGet<MesSyncLogRow[]>('/api/mes-sync/logs', { limit });
}

// ------------------------------------------------------------ 发料回写 MES

export interface MesWritebackRow {
  id: string;
  pickingNo: string;
  mesIssueNo: string | null;
  moNo: string | null;
  workSection: string | null;
  totalQty: number;
  eventType: string;
  status: string;
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface MesWritebackResult {
  skipped: boolean;
  reason?: string;
  pulled: number;
  sent: number;
  failed: number;
  notApplicable?: number;
  messages: string[];
}

export function getMesWriteback(params: { status?: string; keyword?: string; limit?: number } = {}) {
  return apiGet<{
    items: MesWritebackRow[];
    counts: { pending: number; sent: number; failed: number; skipped: number };
  }>('/api/mes-sync/writeback/list', params);
}

export function runMesWriteback(limit = 20) {
  return apiPost<MesWritebackResult>('/api/mes-sync/writeback/run', { limit });
}

export function retryMesWriteback(id: string) {
  return apiPost<MesWritebackResult>(`/api/mes-sync/writeback/${id}/retry`, {});
}
