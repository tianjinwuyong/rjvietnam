export const VIRTUAL_EMPLOYEE_CHANNELS = [
  { id: "manager-chat", purpose: "Manager instructions, questions and priorities." },
  { id: "task-queue", purpose: "Assigned, scheduled, overdue, active and completed work." },
  { id: "execution-stream", purpose: "Live execution steps, status, tool calls and blockers." },
  { id: "evidence-input", purpose: "Real documents, measurements, scans, photos and operator inputs." },
  { id: "approval-gate", purpose: "Human approvals and controlled exception decisions." },
  { id: "exception-incident", purpose: "Abnormalities, failures, safety issues and escalation." },
  { id: "department-coordination", purpose: "Traceable requests and handoffs between departments." },
  { id: "learning-review", purpose: "Review candidate knowledge before it becomes approved knowledge." },
  { id: "cron-monitor", purpose: "Recurring work, reminders, health checks and scheduled reports." },
];

export const VIRTUAL_EMPLOYEE_DEPARTMENTS = [
  "management", "sales", "pmc", "purchasing", "quality", "warehouse", "production",
  "engineering", "maintenance", "finance", "hr", "it",
];

export function createVirtualEmployeeDefinition({ id, name, department, role, skills = [], knowledge = [], permissions = [] }) {
  if (!id || !department || !VIRTUAL_EMPLOYEE_DEPARTMENTS.includes(department)) throw new Error("virtual employee id and valid department are required");
  return { id, name: name || id, department, role: role || "Virtual Employee", channels: VIRTUAL_EMPLOYEE_CHANNELS, skills, knowledge, permissions, memoryScope: `${department}:${id}`, status: "CONTROLLED" };
}
