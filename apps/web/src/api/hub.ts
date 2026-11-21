// Integration hub ("absorbed apps, one list"). The API half lives in
// services/api/src/routes/hub.js: `integration_app` (migration 341) is the registry of
// every app grafted into this system, and v_integration_app_health aggregates 24h
// traffic from itf_api_log by api_path prefix. Config comes from the table, health from
// the view — this client just joins them for the screen.
import { apiClient, type ListEnvelope, type MutateEnvelope } from "./client";

export type HubDirection = "in" | "out" | "both";
export type HubAuthKind = "key" | "hmac" | "jwt" | "none";
export type HubStatus = "active" | "paused" | "retired";

export interface HubApp {
  id: number;
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  direction: HubDirection;
  base_url: string;
  api_path_prefix: string;
  auth_kind: HubAuthKind;
  key_ref: string;
  status: HubStatus;
  notes: string;
  last_seen_at?: string | null;
  last_error: string;
  updated_at: string;
  // health (from the view, may be absent for an empty prefix)
  calls_24h?: number | null;
  calls_ok_24h?: number | null;
  last_call_at?: string | null;
  last_error_at?: string | null;
}

export interface HubAppDraft {
  code: string;
  nameZh: string;
  nameEn?: string;
  nameVi?: string;
  direction?: HubDirection;
  baseUrl?: string;
  apiPathPrefix?: string;
  authKind?: HubAuthKind;
  keyRef?: string;
  notes?: string;
}

export type HubAppPatch = Partial<Omit<HubAppDraft, "code">> & { status?: HubStatus };

export const hubApi = {
  list: () => apiClient.get<ListEnvelope<HubApp>>("/api/hub/apps"),
  create: (body: HubAppDraft) => apiClient.post<MutateEnvelope<HubApp>>("/api/hub/apps", body),
  update: (code: string, body: HubAppPatch) =>
    apiClient.patch<MutateEnvelope<HubApp>>(`/api/hub/apps/${encodeURIComponent(code)}`, body),
};

// Live sync (the dynamic pull from the RUNNING WMS / OA, not the extracts):
// services/api/src/routes/live-sync.js. Data lands in sync_stage.live_* only —
// canonical convergence stays with the one-WMS slice chain (docs/WMS-ONE-PARITY.md).
export interface LiveSyncLastRun {
  task: string;
  status: string;
  pulled: number;
  created: number;
  updated: number;
  message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface LiveSyncApp {
  app: string;
  baseUrl: string;
  account: string;
  hasPassword: boolean;
  autoSync: boolean;
  intervalMinutes: number;
  running: boolean;
  sessionActive: boolean;
  tasks: string[];
  lastRun: LiveSyncLastRun | null;
  lastMenuSnapshot: { kind: string; item_count: number; fetched_at: string } | null;
  menuDrifts7d: number;
}

export interface LiveSyncRunResult {
  app?: string;
  status?: string;
  message?: string;
  results?: Record<string, { pulled?: number; created?: number; updated?: number; drifted?: boolean; error?: string }>;
}

export interface LiveSyncConfigAck {
  app: string;
  baseUrl: string;
  account: string;
  hasPassword: boolean;
  autoSync: boolean;
  intervalMinutes: number;
}

export const liveSyncApi = {
  status: () => apiClient.get<ListEnvelope<LiveSyncApp>>("/api/live-sync/status"),
  run: (code: string, tasks?: string[]) =>
    apiClient.post<LiveSyncRunResult>(`/api/live-sync/run/${encodeURIComponent(code)}`, tasks ? { tasks } : {}),
  config: (code: string, body: { baseUrl?: string; account?: string; password?: string; autoSync?: boolean; intervalMinutes?: number }) =>
    apiClient.put<LiveSyncConfigAck>(`/api/live-sync/config/${encodeURIComponent(code)}`, body),
  logs: (code: string, limit = 20) =>
    apiClient.get<ListEnvelope<LiveSyncLastRun & { id: number; skipped: number; failed: number }>>(
      `/api/live-sync/logs/${encodeURIComponent(code)}?limit=${limit}`),
};
