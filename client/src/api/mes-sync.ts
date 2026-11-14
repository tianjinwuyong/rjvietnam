import { apiGet, apiPost, apiPut } from './request';

/**
 * MES 接入：配置 / 拉领料单 / 发料回写
 * ------------------------------------------------------------------
 * 2026-11-13 起工单对接下线（原来那套 sync / sync-pending / picking-generate
 * 接口已从后端移除）。现在只有「拉 MES 领料单」和「把发料结果推回 MES」两条链。
 */

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
    /** 已接入 WMS 的 MES 领料单总数 */
    mesIssues: number;
    /** 已审批待发料 */
    mesIssuesOpen: number;
    /** WMS 侧已经发出料的（issued/received/completed） */
    mesIssuesIssued: number;
    /** WMS 里来源于 MES 的工单数（外键依赖，只读） */
    mesWorkOrders: number;
    /** 待发料的领料单数 */
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

/** 已接入 WMS 的 MES 领料单 */
export interface MesIssueRow {
  id: string;
  pickingNo: string;
  mesIssueNo: string;
  moNo: string | null;
  workSection: string;
  status: string;
  totalQty: number;
  lineCount: number;
  issuedLines: number;
  remark: string;
  createdAt: string;
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

/** 拉 MES 领料单（full=true 忽略游标重拉） */
export function syncMesIssues(data?: { full?: boolean }) {
  return apiPost<MesSyncResult & { operator: string }>('/api/mes-sync/issues/sync', data ?? {});
}

/** 已接入的 MES 领料单列表 */
export function getMesIssues(params: { status?: string; keyword?: string; limit?: number } = {}) {
  return apiGet<MesIssueRow[]>('/api/mes-sync/issues', params);
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
