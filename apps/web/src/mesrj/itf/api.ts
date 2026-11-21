// MES ⇄ WMS 集成（工单下发 WMS）API 客户端
// 嫁接自 D:\rj\repos\MES-ruijing api/wmsmo.py；信封 {success,msg,data} 由 mesrjApi 统一剥
// 标准: docs/grafting-standards.md §7
import { mesrjApi } from "../api";

export interface ItfOverview {
  apiKey: string;
  baseHint: string;
  wmsBase: string;
  push: { url: string; key: string; enabled: boolean };
  pullCount: number;
  pullOk: number;
  lastPull: { at: string; action: string; mo_no: string; client_ip: string; ok: number; rows: number; msg: string } | null;
  pushed: number;
  pushFail: number;
  openMo: number;
  serverTime: string;
}

export interface MoPushRow {
  moNo: string;
  woType: string;
  productCode: string;
  productName: string;
  planQty: number;
  outQty: number;
  lineCode: string;
  status: string;
  issueNo: string;
  issueStatus: string;
  issueCount: number;
  updatedAt: string;
  push: { at: string; ok: number; tries: number; msg: string } | null;
}

export interface MoListResult {
  items: MoPushRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface LogRow {
  id: number;
  at: string;
  action: string;
  mo_no: string;
  client_ip: string;
  ok: number;
  rows: number;
  msg: string;
}

export interface WritebackRow {
  id: number;
  issue_no: string;
  mo_no: string;
  wms_picking_no: string;
  work_section: string;
  event_type: string;
  issued_at: string;
  issued_by_name: string;
  item_count: number;
  total_qty: number;
  applied: number;
  created_at: string;
}

export interface MoPreview {
  event: string;
  sentAt: string;
  data: Record<string, unknown>;
}

export const itfApi = {
  overview: () => mesrjApi.get<ItfOverview>("/wmsmo/overview"),
  resetKey: () => mesrjApi.post<{ apiKey: string }>("/wmsmo/key/reset"),
  savePushConfig: (body: { url: string; key: string; enabled: boolean }) =>
    mesrjApi.post<{ url: string; key: string; enabled: boolean }>("/wmsmo/push/config", body),
  moList: (query: Record<string, unknown>) => mesrjApi.get<MoListResult>("/wmsmo/mo/list", query),
  pushOne: (moNo: string, force = false) => mesrjApi.post<null>(`/wmsmo/mo/${encodeURIComponent(moNo)}/push`, { force }),
  pushAll: (limit = 50) => mesrjApi.post<{ ok: number; fail: number; detail: { mo_no: string; msg: string }[] }>("/wmsmo/mo/push-all", { limit }),
  preview: (moNo: string) => mesrjApi.get<MoPreview>(`/wmsmo/mo/${encodeURIComponent(moNo)}/preview`),
  logs: (limit = 100) => mesrjApi.get<{ rows: LogRow[]; push: { mo_no: string; at: string; ok: number; tries: number; msg: string }[] }>("/wmsmo/logs", { limit }),
  writebacks: (limit = 100, issueNo = "") =>
    mesrjApi.get<{ rows: WritebackRow[] }>("/wmsmo/writebacks", { limit, issue_no: issueNo }),
};
