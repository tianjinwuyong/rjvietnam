import { apiGet, apiPost, apiPut } from './request';
import type {
  DashboardStats,
  DashboardOverview,
  IqcSummary,
  IqcTrendPoint,
  IqcStatsBundle,
  IqcDefectTypeItem,
  IqcDefectMaterialTypeItem,
  IqcDefectDetailResult,
  IqcOverdueStats,
  PendingStats,
  SupplementSummary,
} from '@shared/api.interface';

export function getDashboardStats() {
  return apiGet<DashboardStats>('/api/dashboard/stats');
}

export function getOverview() {
  return apiGet<DashboardOverview>('/api/dashboard/overview');
}

export function getIqcSummary(params: { startDate: string; endDate: string }) {
  return apiGet<IqcSummary>('/api/dashboard/iqc-summary', params);
}

export function getIqcTrend(params: {
  startDate: string;
  endDate: string;
  granularity: 'month' | 'week' | 'day';
  groupBy: 'overall' | 'supplier' | 'materialType';
  supplier?: string;
  materialType?: string;
}) {
  return apiGet<IqcTrendPoint[]>('/api/dashboard/iqc-trend', params);
}

/** IQC 检验看板聚合数据：汇总 + 趋势 + 排行 + 物料类型选项（单次请求，单一口径） */
export function getIqcStats(params: {
  startDate: string;
  endDate: string;
  granularity: 'month' | 'week' | 'day';
  groupBy: 'overall' | 'supplier' | 'materialType';
  dimensionValue?: string;
  materialCode?: string;
}) {
  return apiGet<IqcStatsBundle>('/api/dashboard/iqc-stats', params);
}

export function getIqcDefectByType(params: { startDate: string; endDate: string }) {
  return apiGet<IqcDefectTypeItem[]>('/api/dashboard/iqc-defect-by-type', params);
}
export function getIqcDefectByMaterialType(params: { startDate: string; endDate: string }) {
  return apiGet<IqcDefectMaterialTypeItem[]>('/api/dashboard/iqc-defect-by-material-type', params);
}

/** 饼图下钻：不合格明细台账（一行 = 一个批次，行数 = 饼图扇区数值） */
export function getIqcDefectDetail(params: {
  startDate: string;
  endDate: string;
  dimension: 'type' | 'materialType';
  value: string;
  page?: number;
  pageSize?: number;
}) {
  return apiGet<IqcDefectDetailResult>('/api/dashboard/iqc-defect-detail', params);
}

export function getIqcOverdue() {
  return apiGet<IqcOverdueStats>('/api/dashboard/iqc-overdue');
}

export function getPendingStats() {
  return apiGet<PendingStats>('/api/dashboard/pending-stats');
}

export function getSupplementSummary() {
  return apiGet<SupplementSummary>('/api/dashboard/supplement-summary');
}

export function setTargetPassRate(targetPassRate: number) {
  return apiPut<{ success: boolean }>('/api/dashboard/target-pass-rate', { targetPassRate });
}

export interface TargetConfig {
  overall: number;
  byType: Record<string, number | null>;
}

export function getTargetConfig() {
  return apiGet<TargetConfig>('/api/dashboard/target-config');
}

export function verifyAdmin(account: string, password: string) {
  return apiPost<{ success: boolean; name?: string }>('/api/dashboard/verify-admin', { account, password });
}

export function updateTargetConfig(account: string, password: string, config: TargetConfig) {
  return apiPut<{ success: boolean }>('/api/dashboard/target-config', { account, password, ...config });
}
