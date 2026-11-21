// External data sources ("data from the other plant"). The API half lives in
// services/api/src/routes/datasources.js: providers are rows, a sync copies remote tables
// into a staging schema `ext_<code>` on this database, and progress is a run + per-table row.
import { apiClient, type ListEnvelope, type MutateEnvelope } from "./client";

export type DataSourceKind = "postgres" | "mysql";

export interface DataSourceConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** Masked to "********" once stored; leave blank to keep the saved password. */
  password?: string;
  schema?: string;
  ssl?: boolean;
}

export interface DataSourceProvider {
  id: number;
  code: string;
  name_zh: string;
  kind: DataSourceKind;
  config: DataSourceConfig;
  enabled: boolean;
  last_test_at?: string | null;
  last_test_ok?: boolean | null;
  last_test_message?: string | null;
  last_run?: DataSourceSyncRun | null;
  running?: boolean;
}

export interface DataSourceSyncRun {
  id: number;
  provider_id: number;
  mode: "replace" | "append";
  status: "running" | "done" | "failed";
  tables_total: number;
  tables_done: number;
  rows_copied: number | string;
  started_at: string;
  finished_at?: string | null;
  message?: string | null;
}

export interface DataSourceSyncTable {
  table_name: string;
  target_schema: string;
  rows_copied: number | string;
  status: "running" | "done" | "failed" | "skipped";
  message?: string | null;
  finished_at?: string | null;
}

export interface RemoteTable {
  name: string;
  estRows: number;
}

export const dataSourceApi = {
  list: () => apiClient.get<ListEnvelope<DataSourceProvider>>("/api/datasources"),
  create: (body: { code: string; nameZh: string; kind: DataSourceKind; config: DataSourceConfig; enabled?: boolean }) =>
    apiClient.post<MutateEnvelope<DataSourceProvider>>("/api/datasources", body),
  update: (id: number, body: Partial<{ nameZh: string; kind: DataSourceKind; config: DataSourceConfig; enabled: boolean }>) =>
    apiClient.patch<MutateEnvelope<DataSourceProvider>>(`/api/datasources/${id}`, body),
  remove: (id: number) => apiClient.delete<MutateEnvelope<{ code: string }>>(`/api/datasources/${id}`),
  test: (id: number) => apiClient.post<MutateEnvelope<{ ok: boolean; message: string }>>(`/api/datasources/${id}/test`),
  tables: (id: number) => apiClient.get<ListEnvelope<RemoteTable>>(`/api/datasources/${id}/tables`),
  sync: (id: number, body: { tables?: string[]; mode: "replace" | "append"; all?: boolean }) =>
    apiClient.post<MutateEnvelope<{ runId: number; tables: number }>>(`/api/datasources/${id}/sync`, body),
  runs: (id: number) => apiClient.get<ListEnvelope<DataSourceSyncRun>>(`/api/datasources/${id}/runs`),
  run: (runId: number) =>
    apiClient.get<MutateEnvelope<{ run: DataSourceSyncRun; tables: DataSourceSyncTable[] }>>(
      `/api/datasources/runs/${runId}`,
    ),
};
