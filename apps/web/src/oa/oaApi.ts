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
  flow_nodes?: OaFlowNode[] | null;
  tasks?: OaTask[];
  ccs?: OaCcRow[];
  logs?: OaLogRow[];
  attachments?: OaAttachmentRow[];
  executions?: OaExecutionRow[];
  myTask?: OaTask | null;
  currentNode?: OaFlowNode | null;
  current_index?: number | null;
  canApprove?: boolean;
  canWithdraw?: boolean;
  canReturn?: boolean;
  canUrge?: boolean;
  canTerminate?: boolean;
  canArchive?: boolean;
  canAssignNode?: boolean;
  warnings?: Array<Record<string, unknown>>;
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
  publisher_id?: number | string | null;
  publisher_name?: string | null;
  publish_at?: string | null;
  expire_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  is_read?: boolean;
  read_count?: number;
  top?: boolean;
}

export interface OaAnnouncementReadRow {
  user_id: number | string;
  real_name?: string | null;
  dept_name?: string | null;
  read_at: string;
}

export interface OaAnnouncementUnreadRow {
  user_id: number | string;
  real_name?: string | null;
  dept_name?: string | null;
}

export interface OaAnnouncementListResult {
  list: OaAnnouncement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OaAnnouncementSaveBody {
  title: string;
  titleVi?: string | null;
  content?: string | null;
  contentVi?: string | null;
  category?: string;
  top?: boolean;
  publishAt?: string | null;
  expireAt?: string | null;
  status?: "draft" | "published";
}

export interface OaProfile {
  id: number | string;
  username: string;
  real_name?: string | null;
  isAdmin?: boolean;
  permissions?: string[];
  counts?: { todo: number; drafts: number; cc: number; notifications: number };
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
}export type OaApproveAction = "approve" | "reject";

// ---- 流程定义与动态表单（发起申请） ----

export interface OaFormFieldColumn {
  key: string;
  type: string;
  label: string;
  label_vi?: string | null;
  required?: boolean;
  options?: OaFieldOption[];
}

export interface OaFieldOption {
  label: string;
  value: string | number | boolean;
  label_vi?: string | null;
}

export interface OaFormField {
  key: string;
  type: string;
  label: string;
  label_vi?: string | null;
  required?: boolean;
  placeholder?: string | null;
  placeholder_vi?: string | null;
  hint?: string | null;
  hint_vi?: string | null;
  options?: OaFieldOption[];
  columns?: OaFormFieldColumn[];
  min?: number;
  step?: number;
  sum_key?: string | null;
  readonly?: boolean;
}

export interface OaFlowNode {
  name: string;
  name_vi?: string | null;
  type?: string;
  assign?: string;
  temp_addable?: boolean;
  condition?: Record<string, unknown> | null;
}

export interface OaFlowDef {
  id: number | string;
  code: string;
  name: string;
  name_vi?: string | null;
  category?: string | null;
  icon?: string | null;
  description?: string | null;
  closure_required?: boolean;
  active?: boolean;
  hide_in_apply?: boolean;
  form_schema?: OaFormField[] | null;
  flow_nodes?: OaFlowNode[] | null;
  ledger_columns?: unknown;
}

export interface OaUserOption {
  id: number | string;
  username: string;
  real_name: string;
  employee_no?: string | null;
  position?: string | null;
  position_code?: string | null;
  dept_name?: string | null;
  department_id?: number | string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
  is_admin?: boolean;
  is_external?: boolean;
  is_system?: boolean;
  manager_name?: string | null;
  hire_date?: string | null;
  last_login_at?: string | null;
}

export interface OaUploadResult {
  fileName: string;
  tempRelPath: string;
  filePath?: string;
  fileSize: number;
  mimeType: string;
}

export interface OaAttachmentRow {
  id: number | string;
  file_name: string;
  file_path?: string;
  file_size?: number | string | null;
  mime_type?: string | null;
}

export interface OaLogRow {
  id: number | string;
  action?: string | null;
  detail?: string | null;
  node_index?: number | null;
  actor_id?: number | string | null;
  real_name?: string | null;
  created_at: string;
}

export interface OaCcRow {
  id: number | string;
  user_id?: number | string | null;
  real_name?: string | null;
  read_at?: string | null;
  created_at?: string;
}

export interface OaExecutionRow {
  id: number | string;
  status?: string | null;
  reply_by_name?: string | null;
  verified_by_name?: string | null;
  [key: string]: unknown;
}

export const oaApi = {
  statsOverview: () => apiClient.get<OaStatsOverview>("/api/stats/overview"),

  /** 可发起的流程类型（forApply=1：剔除 hide_in_apply，按发起权限过滤） */
  flows: () => apiClient.get<OaFlowDef[]>("/api/flows", { forApply: 1 }),

  /** 单个流程类型的表单结构 + 审批节点（渲染动态表单用） */
  flow: (id: number | string) => apiClient.get<OaFlowDef>(`/api/flows/${id}`),

  createInstance: (body: {
    definitionId: number | string;
    title: string;
    formData?: Record<string, unknown>;
    submitNow?: boolean;
  }) => apiClient.post<{ id: number | string; instance_no?: string; advance?: unknown }>("/api/instances", body),

  submitDraft: (id: number | string, comment?: string) =>
    apiClient.post<unknown>(`/api/instances/${id}/submit`, comment ? { comment } : {}),

  users: (query: { keyword?: string; departmentId?: number | string; organization?: string; scope?: string } = {}) =>
    apiClient.get<OaUserOption[]>("/api/users", query),

  /** 当前用户档案（isAdmin / permissions，用于管理员功能显隐） */
  profile: () => apiClient.get<OaProfile>("/api/auth/profile"),

  /** 暂存上传（返回 tempRelPath），随后用 addAttachment 关联到单据 */
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiClient.postForm<OaUploadResult>("/api/upload", form);
  },

  addAttachment: (instanceId: number | string, body: { fileName: string; filePath: string; fileSize?: number; mimeType?: string }) =>
    apiClient.post<OaAttachmentRow>(`/api/instances/${instanceId}/attachments`, body),

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

  announcements: (query: { keyword?: string; status?: string; category?: string; page?: number; pageSize?: number } = {}) =>
    apiClient.get<OaAnnouncementListResult>("/api/announcements", query),

  announcement: (id: number | string) => apiClient.get<OaAnnouncement>(`/api/announcements/${id}`),

  createAnnouncement: (body: OaAnnouncementSaveBody) =>
    apiClient.post<OaAnnouncement>("/api/announcements", body),

  updateAnnouncement: (id: number | string, body: OaAnnouncementSaveBody) =>
    apiClient.put<OaAnnouncement>(`/api/announcements/${id}`, body),

  publishAnnouncement: (id: number | string) =>
    apiClient.post<{ id: number | string; status: string; alreadyPublished?: boolean }>(`/api/announcements/${id}/publish`, {}),

  deleteAnnouncement: (id: number | string) => apiClient.delete<{ id: number | string }>(`/api/announcements/${id}`),

  markAnnouncementRead: (id: number | string) => apiClient.post<unknown>(`/api/announcements/${id}/read`, {}),

  /** 阅读回执明细（仅发布者/管理员）：已读人员 + 未读人员 */
  announcementReads: (id: number | string) =>
    apiClient.get<{ read: OaAnnouncementReadRow[]; unread: OaAnnouncementUnreadRow[] }>(`/api/announcements/${id}/reads`),

  departments: () => apiClient.get<OaDepartment[]>("/api/departments"),
};
