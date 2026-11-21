// ── Agent Chat & Task API Store ──────────────────────────────────────────────
// In-memory store for MVP: chat history + task assignments + counterpart access

import type { AgentProfile } from "../agents/agentData";

// ── Counterpart / 对接人权限 ───────────────────────────────────────────────

export type AgentPermission =
  | "chat"           // 对话权限
  | "task.assign"    // 指派任务
  | "task.view"       // 查看任务
  | "task.update"     // 更新任务进度
  | "report.view"     // 查看报表
  | "report.export"   // 导出报表
  | "admin";          // 管理对接人权限

export interface Counterpart {
  id: string;               // 员工ID
  name_zh: string;
  name_en: string;
  name_vi: string;
  employeeId: string;       // 员工编号
  department: string;        // 部门
  phone: string;            // 联系方式
  email: string;
  /** 该对接人拥有的权限列表 */
  permissions: AgentPermission[];
  /** 是否已认证（登录） */
  authenticated: boolean;
  lastLoginAt?: string;
}

/** 模拟对接人数据库 key = agentId */
const counterpartStore: Map<string, Counterpart> = new Map();

// Counterparts register themselves through the chat API; nothing is seeded client-side.

export function getCounterpart(agentId: string): Counterpart | null {
  return counterpartStore.get(agentId) ?? null;
}

export function authenticateCounterpart(agentId: string, employeeId: string): Counterpart | null {
  const cp = counterpartStore.get(agentId);
  if (!cp) return null;
  if (cp.employeeId !== employeeId) return null;
  cp.authenticated = true;
  cp.lastLoginAt = new Date().toISOString();
  return { ...cp };
}

export function logoutCounterpart(agentId: string): void {
  const cp = counterpartStore.get(agentId);
  if (cp) cp.authenticated = false;
}

export function updateCounterpartPermissions(
  agentId: string,
  permissions: AgentPermission[],
): Counterpart | null {
  const cp = counterpartStore.get(agentId);
  if (!cp) return null;
  cp.permissions = permissions;
  return { ...cp };
}

export function hasPermission(cp: Counterpart, permission: AgentPermission): boolean {
  return cp.permissions.includes(permission) || cp.permissions.includes("admin");
}

export function getPermissionLabel(p: AgentPermission, locale: string): string {
  const labels: Record<AgentPermission, Record<string, string>> = {
    "chat":         { "zh-CN": "对话", "en-US": "Chat", "vi-VN": "Trò chuyện" },
    "task.assign":  { "zh-CN": "指派任务", "en-US": "Assign Tasks", "vi-VN": "Giao việc" },
    "task.view":    { "zh-CN": "查看任务", "en-US": "View Tasks", "vi-VN": "Xem việc" },
    "task.update":  { "zh-CN": "更新进度", "en-US": "Update Progress", "vi-VN": "Cập nhật tiến độ" },
    "report.view":  { "zh-CN": "查看报表", "en-US": "View Reports", "vi-VN": "Xem báo cáo" },
    "report.export":{ "zh-CN": "导出报表", "en-US": "Export Reports", "vi-VN": "Xuất báo cáo" },
    "admin":        { "zh-CN": "管理员", "en-US": "Admin", "vi-VN": "Quản trị" },
  };
  return labels[p]?.[locale] ?? p;
}

export interface AgentMessage {
  id: string;
  agentId: string;
  role: "user" | "agent";
  text: string;
  timestamp: string;
}

export interface AgentTask {
  id: string;
  agentId: string;
  task: string;        // 任务名称
  description: string; // 详细描述
  plan: string;        // 计划说明
  priority: "low" | "medium" | "high";
  deadline?: string;   // YYYY-MM-DD
  assigneeName: string; // 指派人姓名
  assigneeId: string;   // 指派人 employee ID
  status: "pending" | "in_progress" | "done";
  completion: number;   // 0-100
  createdAt: string;
}

// ── Chat store ──────────────────────────────────────────────────────────────

const chatHistory: Map<string, AgentMessage[]> = new Map(); // key = agentId

export function getChatHistory(agentId: string): AgentMessage[] {
  return chatHistory.get(agentId) ?? [];
}

export function addChatMessage(agentId: string, msg: Omit<AgentMessage, "id" | "timestamp">): AgentMessage {
  const msgs = chatHistory.get(agentId) ?? [];
  const newMsg: AgentMessage = {
    ...msg,
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  };
  msgs.push(newMsg);
  chatHistory.set(agentId, msgs);
  return newMsg;
}

export function clearChat(agentId: string): void {
  chatHistory.set(agentId, []);
}

// ── Task store ──────────────────────────────────────────────────────────────

const taskStore: AgentTask[] = [
  // Demo tasks mapped to agent IDs
  {
    id: "task-001",
    agentId: "dir-mes-001",
    task: "优化换线 SOP",
    description: "将换线时间从 28 分钟压降到 ≤18 分钟，制定标准作业程序。",
    plan: "收集各线换线时间数据，分析瓶颈工步，制定新 SOP 并培训",
    priority: "high",
    assigneeName: "张厂长",
    assigneeId: "emp-001",
    status: "in_progress",
    completion: 45,
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: "task-002",
    agentId: "dir-wms-001",
    task: "库存准确率提升",
    description: "通过每月盘点+系统校验，年底达到 99.5% 库存准确率。",
    plan: "每周循环盘点 20% 库位，差异实时录入系统",
    priority: "medium",
    assigneeName: "陈仓管",
    assigneeId: "emp-002",
    status: "in_progress",
    completion: 55,
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: "task-003",
    agentId: "hr-agent-001",
    task: "6月考勤核对",
    description: "各部门考勤数据汇总，异常提醒。",
    plan: "导出各线考勤记录，核对异常数据，推送提醒",
    priority: "medium",
    assigneeName: "HR主管",
    assigneeId: "emp-003",
    status: "done",
    completion: 100,
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
];

export function getTasksForAgent(agentId: string): AgentTask[] {
  return taskStore.filter((t) => t.agentId === agentId);
}

export function assignTask(task: Omit<AgentTask, "id" | "createdAt" | "status" | "completion">): AgentTask {
  const newTask: AgentTask = {
    ...task,
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    status: "pending",
    completion: 0,
    createdAt: new Date().toISOString(),
  };
  taskStore.push(newTask);
  return newTask;
}

export function updateTaskStatus(taskId: string, status: AgentTask["status"], completion?: number): AgentTask | null {
  const task = taskStore.find((t) => t.id === taskId);
  if (!task) return null;
  task.status = status;
  if (completion !== undefined) task.completion = completion;
  return task;
}

// ── Simulated AI response generator ──────────────────────────────────────────

// The agent chat backend (/agents/chat) does not exist yet. Until it does, replies must say so
// instead of pretending to answer with operational data.
function notConnectedReply(): string {
  return "对话服务尚未接入后端（/agents/chat 无接口）。请通过相应看板查看实时数据。";
}

function generateAIResponse(_agentId: string, _userText: string): string {
  return notConnectedReply();
}

export async function sendAgentMessage(
  agentId: string,
  text: string,
  _userId: string,
): Promise<AgentMessage> {
  // Save user message
  const userMsg = addChatMessage(agentId, { agentId, role: "user", text });

  // Generate response
  const responseText = generateAIResponse(agentId, text);
  const agentMsg = addChatMessage(agentId, { agentId, role: "agent", text: responseText });

  return agentMsg;
}
