import { useState } from "react";
import { X, AlertTriangle } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { AgentProfile } from "./agentData";
import { assignTask, type AgentTask } from "../api/agentChat";

interface Props {
  agent: AgentProfile;
  locale: Locale;
  currentUser: { username: string; displayName: string; employeeId?: string };
  onClose: () => void;
  onTaskCreated: (task: Pick<AgentTask, "id" | "task" | "plan" | "completion">) => void;
}

const PRIORITIES: Array<{ value: AgentTask["priority"]; label_zh: string; label_en: string; label_vi: string }> = [
  { value: "low",    label_zh: "低",  label_en: "Low",    label_vi: "Thấp" },
  { value: "medium", label_zh: "中",  label_en: "Medium", label_vi: "Trung bình" },
  { value: "high",   label_zh: "高",  label_en: "High",   label_vi: "Cao" },
];

export function TaskAssignDialog({ agent, locale, currentUser, onClose, onTaskCreated }: Props) {
  const locale_key = locale as "zh-CN" | "en-US" | "vi-VN";
  const [taskName, setTaskName] = useState("");
  const [description, setDescription] = useState("");
  const [plan, setPlan] = useState("");
  const [priority, setPriority] = useState<AgentTask["priority"]>("medium");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");

  const priorityLabel = (p: typeof priority) => {
    const found = PRIORITIES.find((x) => x.value === p);
    if (!found) return p;
    return locale_key === "zh-CN" ? found.label_zh : locale_key === "vi-VN" ? found.label_vi : found.label_en;
  };

  const handleSubmit = () => {
    if (!taskName.trim()) {
      setError(locale_key === "zh-CN" ? "请输入任务名称" : "Please enter task name");
      return;
    }
    const newTask = assignTask({
      agentId: agent.id,
      task: taskName.trim(),
      description: description.trim(),
      plan: plan.trim(),
      priority,
      deadline: deadline || undefined,
      assigneeName: currentUser.displayName,
      assigneeId: currentUser.employeeId ?? "",
    });
    onTaskCreated({ id: newTask.id, task: newTask.task, plan: newTask.plan, completion: newTask.completion });
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1060,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxHeight: "80vh",
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 12, display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          background: "var(--surface-2)",
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: "var(--info)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 14 }}>📋</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {locale_key === "zh-CN" ? "指派新任务" : locale_key === "vi-VN" ? "Giao việc mới" : "Assign New Task"}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>
              → {agent.name_zh} ({agent.name_en})
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", display: "flex", padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Task name */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 4 }}>
              {locale_key === "zh-CN" ? "任务名称 *" : locale_key === "vi-VN" ? "Tên công việc *" : "Task Name *"}
            </label>
            <input
              value={taskName}
              onChange={(e) => { setTaskName(e.target.value); setError(""); }}
              placeholder={locale_key === "zh-CN" ? "例如：更新库存数据" : "e.g. Update inventory data"}
              style={{
                width: "100%", padding: "8px 10px", fontSize: 13,
                border: `1px solid ${error ? "#ef4444" : "var(--border)"}`,
                borderRadius: 6, background: "var(--surface-2)", color: "var(--text)", outline: "none",
                boxSizing: "border-box",
              }}
            />
            {error && (
              <div style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                <AlertTriangle size={11} /> {error}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 4 }}>
              {locale_key === "zh-CN" ? "详细描述" : locale_key === "vi-VN" ? "Mô tả chi tiết" : "Description"}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={locale_key === "zh-CN" ? "补充任务的背景和具体要求…" : "Add context and requirements…"}
              rows={2}
              style={{
                width: "100%", padding: "8px 10px", fontSize: 13,
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--surface-2)", color: "var(--text)", outline: "none",
                resize: "vertical", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Plan */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 4 }}>
              {locale_key === "zh-CN" ? "执行计划" : locale_key === "vi-VN" ? "Kế hoạch thực hiện" : "Implementation Plan"}
            </label>
            <textarea
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder={locale_key === "zh-CN" ? "分解步骤：1. … 2. …" : "Steps: 1. … 2. …"}
              rows={2}
              style={{
                width: "100%", padding: "8px 10px", fontSize: 13,
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--surface-2)", color: "var(--text)", outline: "none",
                resize: "vertical", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Priority + Deadline row */}
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 4 }}>
                {locale_key === "zh-CN" ? "优先级" : locale_key === "vi-VN" ? "Mức ưu tiên" : "Priority"}
              </label>
              <div style={{ display: "flex", gap: 5 }}>
                {(["low", "medium", "high"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    style={{
                      flex: 1, padding: "6px 0", fontSize: 11, borderRadius: 6,
                      border: `1px solid ${priority === p ? (p === "high" ? "#ef4444" : p === "medium" ? "#f59e0b" : "#22c55e") : "var(--border)"}`,
                      background: priority === p ? (p === "high" ? "#ef444422" : p === "medium" ? "#f59e0b22" : "#22c55e22") : "var(--surface-2)",
                      color: priority === p ? (p === "high" ? "#ef4444" : p === "medium" ? "#f59e0b" : "#22c55e") : "var(--muted)",
                      fontWeight: priority === p ? 700 : 400, cursor: "pointer",
                    }}
                  >
                    {priorityLabel(p)}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", display: "block", marginBottom: 4 }}>
                {locale_key === "zh-CN" ? "截止日期" : locale_key === "vi-VN" ? "Hạn chót" : "Deadline"}
              </label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                style={{
                  width: "100%", padding: "6px 10px", fontSize: 13,
                  border: "1px solid var(--border)", borderRadius: 6,
                  background: "var(--surface-2)", color: "var(--text)", outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          {/* Assignee info */}
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>
              {locale_key === "zh-CN" ? "指派人" : locale_key === "vi-VN" ? "Người giao" : "Assignor"}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>
              {currentUser.displayName}
              {currentUser.employeeId && (
                <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: 6, fontFamily: "monospace", fontSize: 10 }}>
                  {currentUser.employeeId}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "8px 0", fontSize: 12, borderRadius: 6,
              border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-2)", cursor: "pointer",
            }}
          >
            {locale_key === "zh-CN" ? "取消" : locale_key === "vi-VN" ? "Hủy" : "Cancel"}
          </button>
          <button
            onClick={handleSubmit}
            style={{
              flex: 2, padding: "8px 0", fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: "none", background: "var(--info)", color: "#fff", cursor: "pointer",
            }}
          >
            {locale_key === "zh-CN" ? "确认指派" : locale_key === "vi-VN" ? "Xác nhận giao" : "Confirm Assignment"}
          </button>
        </div>
      </div>
    </div>
  );
}
