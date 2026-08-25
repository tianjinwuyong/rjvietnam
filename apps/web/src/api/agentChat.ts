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

// Demo counterpart for each agent (from agentData.counterpartName)
const DEMO_COUNTERPARTS: Array<{ agentId: string; cp: Omit<Counterpart, "authenticated" | "lastLoginAt"> }> = [
  {
    agentId: "ceo-001",
    cp: {
      id: "cp-ceo-001", name_zh: "张厂长", name_en: "Zhang Director", name_vi: "Giám đốc Trương",
      employeeId: "EMP-001", department: "管理层", phone: "内线 8001", email: "zhang.d@ruijing.vn",
      permissions: ["chat", "task.assign", "task.view", "task.update", "report.view", "report.export", "admin"],
    },
  },
  {
    agentId: "dir-mes-001",
    cp: {
      id: "cp-mes-001", name_zh: "王调度", name_en: "Wang Scheduler", name_vi: "Điều phối Wang",
      employeeId: "EMP-002", department: "MES调度", phone: "内线 8102", email: "wang.s@ruijing.vn",
      permissions: ["chat", "task.assign", "task.view", "task.update", "report.view"],
    },
  },
  {
    agentId: "dir-wms-001",
    cp: {
      id: "cp-wms-001", name_zh: "陈仓管", name_en: "Chen Warehouse", name_vi: "Kho Chen",
      employeeId: "EMP-003", department: "仓储", phone: "内线 8201", email: "chen.w@ruijing.vn",
      permissions: ["chat", "task.assign", "task.view", "task.update", "report.view"],
    },
  },
  {
    agentId: "dir-pmc-001",
    cp: {
      id: "cp-pmc-001", name_zh: "林计划", name_en: "Lin Planner", name_vi: "Quy hoạch Linh",
      employeeId: "EMP-004", department: "PMC", phone: "内线 8301", email: "lin.p@ruijing.vn",
      permissions: ["chat", "task.assign", "task.view", "report.view"],
    },
  },
  {
    agentId: "dir-quality-001",
    cp: {
      id: "cp-qa-001", name_zh: "质控主管", name_en: "QA Manager", name_vi: "Quản lý QA",
      employeeId: "EMP-005", department: "品质", phone: "内线 8401", email: "qa.m@ruijing.vn",
      permissions: ["chat", "task.assign", "task.view", "task.update", "report.view"],
    },
  },
  {
    agentId: "dir-sales-001",
    cp: {
      id: "cp-sales-001", name_zh: "销售主管", name_en: "Sales Manager", name_vi: "Quản lý Bán hàng",
      employeeId: "EMP-006", department: "销售", phone: "内线 8501", email: "sales.m@ruijing.vn",
      permissions: ["chat", "task.assign", "task.view", "report.view"],
    },
  },
  {
    agentId: "mes-line1-001",
    cp: {
      id: "cp-mes-line1", name_zh: "李班长", name_en: "Li Supervisor", name_vi: "Giám sát Lý",
      employeeId: "EMP-011", department: "SMT-1线", phone: "内线 8111", email: "li.s@ruijing.vn",
      permissions: ["chat", "task.view", "task.update"],
    },
  },
  {
    agentId: "wms-receiving-001",
    cp: {
      id: "cp-wms-recv", name_zh: "收料员", name_en: "Receiver", name_vi: "Nhân viên tiếp nhận",
      employeeId: "EMP-012", department: "仓储", phone: "内线 8211", email: "recv@ruijing.vn",
      permissions: ["chat", "task.view"],
    },
  },
  {
    agentId: "iqc-001",
    cp: {
      id: "cp-iqc-001", name_zh: "IQC检验员", name_en: "IQC Inspector", name_vi: "Kiểm tra viên IQC",
      employeeId: "EMP-013", department: "品质", phone: "内线 8411", email: "iqc@ruijing.vn",
      permissions: ["chat", "task.view", "task.update"],
    },
  },
  {
    agentId: "hr-agent-001",
    cp: {
      id: "cp-hr-001", name_zh: "HR专员", name_en: "HR Specialist", name_vi: "Chuyên viên HR",
      employeeId: "EMP-014", department: "HR", phone: "内线 8601", email: "hr@ruijing.vn",
      permissions: ["chat", "task.assign", "task.view", "task.update", "report.view"],
    },
  },
  {
    agentId: "finance-agent-001",
    cp: {
      id: "cp-fin-001", name_zh: "财务专员", name_en: "Finance Specialist", name_vi: "Chuyên viên Tài chính",
      employeeId: "EMP-015", department: "财务", phone: "内线 8701", email: "fin@ruijing.vn",
      permissions: ["chat", "task.assign", "task.view", "report.view", "report.export"],
    },
  },
];

// Init demo counterparts
function initCounterparts() {
  for (const { agentId, cp } of DEMO_COUNTERPARTS) {
    counterpartStore.set(agentId, { ...cp, authenticated: false });
  }
}
initCounterparts();

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

const AI_RESPONSES: Record<string, string[]> = {
  default: [
    "收到，我将处理这个任务。",
    "好的，我已经记录。有什么进一步的要求吗？",
    "了解，我会跟进这个事项。",
    "明白，稍后给您反馈。",
    "收到请求，正在分析处理中……",
  ],
  "dir-mes-001": [
    "MES 调度主管：我已收到工单请求，正在分析产线状态。",
    "当前 SMT-1 线效率 97.2%，SMT-2 线效率 94.8%。",
    "换线时间压降计划：我已优化了 3 个关键节点，目标 18 分钟。",
  ],
  "dir-wms-001": [
    "WMS 仓储主管：库存状态已更新，当前在库物料 1,247 项。",
    "IQC 待检批次：12 批，预警 3 批效期不足 30 天。",
    "发料记录已同步，最近 1 小时发料 8 次。",
  ],
  "dir-pmc-001": [
    "PMC 计划主管：MPS 已重新排程，考虑物料到位时间和产能约束。",
    "7月交期承诺已评估：可达成率 91.3%。",
    "紧急订单绿色通道已启动，24h 内给出交期评估。",
  ],
  dir: [
    "厂长视角：当前整体产能利用率 88.5%，本周目标 90%。",
    "整体 KPI 正常，暂无紧急异常需要处理。",
    "Q3 产能提升项目进展顺利，已完成 35%。",
  ],
};

function generateAIResponse(agentId: string, userText: string): string {
  const key = Object.keys(AI_RESPONSES).find((k) => agentId.startsWith(k));
  const responses = AI_RESPONSES[key ?? "default"];
  const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const base = responses[Math.floor(Math.random() * responses.length)];
  // Simulate some context-awareness
  const lowerText = userText.toLowerCase();
  if (lowerText.includes("状态") || lowerText.includes("status")) {
    return `${base}\n\n[${now}] 系统状态查询完成。`;
  }
  if (lowerText.includes("任务") || lowerText.includes("task")) {
    return `${base}\n\n[${now}] 当前进行中任务 2 项，请查看任务面板。`;
  }
  if (lowerText.includes("帮助") || lowerText.includes("help")) {
    return `我可以帮助您：\n• 查询工单/库存/交期状态\n• 协调产线调度\n• 生成报表摘要\n• 任务进度跟踪\n\n请描述您的需求。`;
  }
  return `${base}`;
}

export async function sendAgentMessage(
  agentId: string,
  text: string,
  _userId: string,
): Promise<AgentMessage> {
  // Save user message
  const userMsg = addChatMessage(agentId, { agentId, role: "user", text });

  // Simulate AI thinking delay
  await new Promise((resolve) => setTimeout(resolve, 600 + Math.random() * 800));

  // Generate response
  const responseText = generateAIResponse(agentId, text);
  const agentMsg = addChatMessage(agentId, { agentId, role: "agent", text: responseText });

  return agentMsg;
}
