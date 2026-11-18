import { apiClient } from "../api/client";

/**
 * OA 原生模块 API 客户端 —— 调用 server.js 挂载的合并 OA 路由
 * (services/api/src/oa/routes/*,单一 SMT JWT,Bearer 认证)。
 * OA 响应为 {code:0,msg,data} 信封,apiClient 已剥壳返回 data。
 */

export type OaInstanceStatus = "draft" | "running" | "completed" | "rejected" | "withdrawn" | "terminated" | (string & {});

export interface OaInstanceSummary {
  id: number | string;
  instance_no: string;
  title: string;
  status: OaInstanceStatus;
  applicant_id?: number | string | null;
  organization?: string | null;
  created_at: string;
  submitted_at?: string | null;
  finished_at?: string | null;
  current_index?: number | null;
  closed_loop?: boolean | null;
  applicant_name?: string | null;
  dept_name?: string | null;
  dept_name_en?: string | null;
  def_name: string;
  def_code?: string;
  icon?: string | null;
  category?: string | null;
}

export interface OaPaged<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

export interface OaTask {
  id: number | string;
  instance_id: number | string;
  node_index?: number;
  node_name?: string | null;
  assignee_id?: number | string | null;
  assignee_name?: string | null;
  status: string;
  created_at?: string;
  finished_at?: string | null;
  comment?: string | null;
}

export interface OaInstanceDetail extends OaInstanceSummary {
  def_name_vi?: string | null;
  form_data?: Record<string, unknown> | null;
  form_schema?: unknown;
  flow_nodes?: unknown;
  tasks?: OaTask[];
  ccs?: Array<Record<string, unknown>>;
  logs?: Array<Record<string, unknown>>;
}

export interface OaStatsOverview {
  byStatus: Array<{ status: OaInstanceStatus; n: number }>;
  byDef: Array<{ id: number; code: string; name: string; name_vi: string | null; category: string | null; n: number }>;
  todo: number;
  recent: Array<{
    id: number | string;
    instance_no: string;
    title: string;
    status: OaInstanceStatus;
    created_at: string;
    def_name: string;
    applicant_name: string | null;
  }>;
  statusCounts: Partial<Record<OaInstanceStatus, number>>;
  announcementUnread: number;
  calendarTodoCount: number;
}

export interface OaNotification {
  id: number | string;
  title: string;
  content: string | null;
  link: string | null;
  category: string | null;
  read_at: string | null;
  created_at: string;
}

export interface OaAnnouncement {
  id: number | string;
  title: string;
  title_vi?: string | null;
  content: string | null;
  content_vi?: string | null;
  category?: string | null;
  status?: string | null;
  publisher_name?: string | null;
  publish_at?: string | null;
  created_at: string;
  is_read?: boolean;
  read_count?: number;
  top?: boolean;
}

export interface OaDepartment {
  id: number | string;
  name: string;
  name_en?: string | null;
  code?: string | null;
  parent_id?: number | string | null;
  leader_name?: string | null;
  user_count?: number;
  sort_order?: number | null;
}

export interface OaInstanceQuery extends Record<string, unknown> {
  tab?: "todo" | "mine" | "cc" | "done" | "flow";
  status?: string;
  definitionId?: number | string;
  keyword?: string;
  page?: number;
  size?: number;
}

export type OaApproveAction = "approve" | "reject";

export const oaApi = {
  statsOverview: () => apiClient.get<OaStatsOverview>("/api/stats/overview"),

  instances: (query: OaInstanceQuery = {}) => apiClient.get<OaPaged<OaInstanceSummary>>("/api/instances", query),

  instance: (id: number | string) => apiClient.get<OaInstanceDetail>(`/api/instances/${id}`),

  approveTask: (taskId: number | string, body: { action?: OaApproveAction; comment?: string }) =>
    apiClient.post<{ status: string; waiting?: boolean; required?: number; approved?: number }>(
      `/api/tasks/${taskId}/approve`,
      body,
    ),

  batchApprove: (body: { taskIds: Array<number | string>; action?: OaApproveAction; comment?: string }) =>
    apiClient.post<{ success: unknown[]; failed: unknown[] }>("/api/tasks/batch-approve", body),

  instanceAction: (
    id: number | string,
    action: "return" | "terminate" | "withdraw" | "urge",
    body: { comment?: string } = {},
  ) => apiClient.post<unknown>(`/api/instances/${id}/${action}`, body),

  notifications: (limit = 20, offset = 0) =>
    apiClient.get<{ list: OaNotification[]; unread: number }>("/api/notifications", { limit, offset }),

  markNotificationsRead: (ids: Array<number | string>) =>
    apiClient.post<{ updated: number }>("/api/notifications/read", { ids }),

  announcements: (query: { keyword?: string; category?: string; page?: number; pageSize?: number } = {}) =>
    apiClient.get<OaPaged<OaAnnouncement>>("/api/announcements", query),

  departments: () => apiClient.get<OaDepartment[]>("/api/departments"),
};
