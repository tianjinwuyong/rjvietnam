import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, MessageSquare, CheckCircle, Clock, ChevronRight, Plus, Shield } from "lucide-react";
import { AnimatedAvatar } from "./AnimatedAvatar";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { AgentProfile } from "./agentData";
import {
  getChatHistory, getTasksForAgent, updateTaskStatus, sendAgentMessage,
  type AgentMessage, type AgentTask,
} from "../api/agentChat";
import { TaskAssignDialog } from "./TaskAssignDialog";
import { CounterpartAccess } from "./CounterpartAccess";

interface Props {
  agent: AgentProfile;
  locale: Locale;
  currentUser: { username: string; displayName: string; employeeId?: string };
  onClose: () => void;
  onTasksChange?: (agentId: string) => void;
}

type ActiveTab = "chat" | "tasks" | "access";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60000) return "刚刚";
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} 分钟前`;
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

const PRIORITY_COLOR: Record<string, string> = {
  low: "#22c55e", medium: "#f59e0b", high: "#ef4444",
};

const tabLabels = {
  chat: { "zh-CN": "对话", "en-US": "Chat", "vi-VN": "Tin nhắn" },
  tasks: { "zh-CN": "任务", "en-US": "Tasks", "vi-VN": "Việc" },
  access: { "zh-CN": "对接", "en-US": "Access", "vi-VN": "Tiếp cận" },
};

const statusLabel: Record<string, Record<string, string>> = {
  pending:    { "zh-CN": "待处理", "en-US": "Pending",    "vi-VN": "Chờ xử lý" },
  in_progress:{ "zh-CN": "进行中", "en-US": "In Progress","vi-VN": "Đang thực hiện" },
  done:       { "zh-CN": "已完成", "en-US": "Done",       "vi-VN": "Hoàn thành" },
};

export function AgentChatPanel({ agent, locale, currentUser, onClose, onTasksChange }: Props) {
  const locale_key = locale as "zh-CN" | "en-US" | "vi-VN";
  const [activeTab, setActiveTab] = useState<ActiveTab>("chat");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [avatarMessage, setAvatarMessage] = useState("");

  const locale_name_field = `name_${locale_key}` as keyof Pick<AgentProfile, "name_zh" | "name_en" | "name_vi">;

  useEffect(() => {
    setMessages(getChatHistory(agent.id));
    setTasks(getTasksForAgent(agent.id));
  }, [agent.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    try {
      const reply = await sendAgentMessage(agent.id, text, currentUser.username);
      setMessages((prev) => [...prev, reply]);
      // Trigger avatar TTS for agent response
      setAvatarMessage(reply.text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, agent.id, currentUser.username]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleTaskCreated = useCallback((task: { id: string; task: string; plan: string; completion: number }) => {
    setTasks((prev) => [...prev, {
      ...task,
      agentId: agent.id,
      assigneeName: currentUser.displayName,
      assigneeId: currentUser.employeeId ?? "",
      description: "",
      priority: "medium" as const,
      status: "pending" as const,
      createdAt: new Date().toISOString(),
    }]);
    onTasksChange?.(agent.id);
  }, [agent.id, currentUser, onTasksChange]);

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 1050,
          background: "rgba(0,0,0,0.3)",
          display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
          padding: 16,
        }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 420, height: "calc(100vh - 32px)",
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)", overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "12px 16px", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 10,
            background: "var(--surface-2)", flexShrink: 0,
          }}>
            <div style={{ flexShrink: 0 }}>
              <AnimatedAvatar
                name={agent[locale_name_field] as string}
                locale={locale_key}
                size="sm"
                voiceRate={1.0}
                expression="neutral"
                message={avatarMessage}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {agent[locale_name_field] as string}
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>
                {agent.name_en} · {agent.domain.toUpperCase()}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setShowTaskDialog(true)}
                title={locale_key === "zh-CN" ? "指派任务" : "Assign Task"}
                style={{
                  background: "none", border: "1px solid var(--border)",
                  borderRadius: 6, padding: "4px 8px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--text-2)",
                }}
              >
                <Plus size={11} /> {locale_key === "zh-CN" ? "指派" : "Giao"}
              </button>
              <button
                onClick={onClose}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", display: "flex", padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Tab nav */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            {(["chat", "tasks", "access"] as ActiveTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, padding: "7px 0", fontSize: 12,
                  fontWeight: activeTab === tab ? 600 : 400,
                  background: "none", border: "none", cursor: "pointer",
                  color: activeTab === tab ? "var(--info)" : "var(--muted)",
                  borderBottom: activeTab === tab ? "2px solid var(--info)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {tab === "access" && <Shield size={11} style={{ display: "inline", marginRight: 3 }} />}
                {tabLabels[tab][locale_key]}
                {tab === "tasks" && tasks.length > 0 && (
                  <span style={{
                    marginLeft: 4, background: "var(--info)", color: "#fff",
                    borderRadius: 10, padding: "0 5px", fontSize: 10, fontWeight: 700,
                  }}>
                    {tasks.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

            {/* ── Chat tab ─────────────────────────────────────── */}
            {activeTab === "chat" && (
              <>
                <div style={{
                  flex: 1, overflowY: "auto", padding: "12px 14px",
                  display: "flex", flexDirection: "column", gap: 10,
                }}>
                  {messages.length === 0 && (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: 12 }}>
                      <MessageSquare size={24} style={{ display: "block", margin: "0 auto 8px", opacity: 0.5 }} />
                      {locale_key === "zh-CN" ? "开始对话吧" : locale_key === "vi-VN" ? "Bắt đầu cuộc trò chuyện" : "Start chatting"}
                    </div>
                  )}
                  {messages.map((msg) => (
                    <div key={msg.id} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                      <div style={{
                        maxWidth: "82%", padding: "8px 12px", borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                        background: msg.role === "user" ? "var(--info)" : "var(--surface-2)",
                        color: msg.role === "user" ? "#fff" : "var(--text)",
                        fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
                      }}>
                        {msg.text}
                      </div>
                      <span style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>

                {/* Input bar */}
                <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={locale_key === "zh-CN" ? "输入消息，回车发送…" : "Type a message, Enter to send…"}
                    rows={1}
                    style={{
                      flex: 1, padding: "8px 10px", fontSize: 13,
                      border: "1px solid var(--border)", borderRadius: 8,
                      background: "var(--surface-2)", color: "var(--text)",
                      resize: "none", outline: "none", maxHeight: 100,
                    }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || sending}
                    style={{
                      padding: "8px 12px", borderRadius: 8,
                      background: input.trim() && !sending ? "var(--info)" : "var(--surface-2)",
                      color: input.trim() && !sending ? "#fff" : "var(--muted)",
                      border: "none", cursor: input.trim() && !sending ? "pointer" : "default",
                      display: "flex", alignItems: "center", flexShrink: 0,
                    }}
                  >
                    <Send size={14} />
                  </button>
                </div>
              </>
            )}

            {/* ── Tasks tab ─────────────────────────────────────── */}
            {activeTab === "tasks" && (
              <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                {tasks.length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: 12 }}>
                    <CheckCircle size={24} style={{ display: "block", margin: "0 auto 8px", opacity: 0.5 }} />
                    {locale_key === "zh-CN" ? "暂无任务" : locale_key === "vi-VN" ? "Không có việc" : "No tasks"}
                  </div>
                )}
                {tasks.map((task) => (
                  <div key={task.id} style={{
                    background: "var(--surface-2)", border: "1px solid var(--border)",
                    borderRadius: 8, padding: "10px 12px",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{task.task}</div>
                        {task.description && (
                          <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 3 }}>{task.description}</div>
                        )}
                        {task.plan && (
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>
                            <span style={{ fontWeight: 600 }}>计划: </span>{task.plan}
                          </div>
                        )}
                      </div>
                      <span style={{
                        background: PRIORITY_COLOR[task.priority] + "22",
                        color: PRIORITY_COLOR[task.priority],
                        border: `1px solid ${PRIORITY_COLOR[task.priority]}44`,
                        borderRadius: 4, padding: "1px 6px",
                        fontSize: 10, fontWeight: 700, flexShrink: 0,
                      }}>
                        {task.priority.toUpperCase()}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", marginBottom: 3 }}>
                        <span>{statusLabel[task.status]?.[locale_key] ?? task.status}</span>
                        <span>{task.completion}%</span>
                      </div>
                      <div style={{ background: "var(--border)", borderRadius: 4, height: 5, overflow: "hidden" }}>
                        <div style={{
                          width: `${task.completion}%`, height: "100%",
                          background: task.status === "done" ? "#22c55e" : task.completion >= 50 ? "#f59e0b" : "#3b82f6",
                          borderRadius: 4, transition: "width 0.3s",
                        }} />
                      </div>
                    </div>

                    {/* Meta */}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-3)" }}>
                      <span>👤 {task.assigneeName}</span>
                      <span>{formatTime(task.createdAt)}</span>
                    </div>

                    {/* Quick actions */}
                    {task.status !== "done" && (
                      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                        {task.status === "pending" && (
                          <button
                            onClick={() => {
                              updateTaskStatus(task.id, "in_progress");
                              setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: "in_progress" } : t));
                            }}
                            style={{
                              flex: 1, padding: "3px 0", fontSize: 10, border: "1px solid var(--border)",
                              borderRadius: 4, background: "var(--surface)", cursor: "pointer", color: "var(--text-2)",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
                            }}
                          >
                            <Clock size={10} /> {locale_key === "zh-CN" ? "开始" : "Start"}
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const newCompletion = task.completion >= 100 ? 100 : task.completion + 25;
                            updateTaskStatus(task.id, newCompletion >= 100 ? "done" : "in_progress", newCompletion);
                            setTasks((prev) => prev.map((t) => t.id === task.id
                              ? { ...t, completion: newCompletion, status: newCompletion >= 100 ? "done" : "in_progress" }
                              : t));
                          }}
                          style={{
                            flex: 1, padding: "3px 0", fontSize: 10, border: "1px solid var(--border)",
                            borderRadius: 4, background: "var(--surface)", cursor: "pointer", color: "var(--text-2)",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
                          }}
                        >
                          <ChevronRight size={10} /> {locale_key === "zh-CN" ? "推进25%" : "Advance 25%"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Access tab ────────────────────────────────────── */}
            {activeTab === "access" && (
              <CounterpartAccess agent={agent} locale={locale} />
            )}
          </div>
        </div>
      </div>

      {showTaskDialog && (
        <TaskAssignDialog
          agent={agent}
          locale={locale}
          currentUser={currentUser}
          onClose={() => setShowTaskDialog(false)}
          onTaskCreated={handleTaskCreated}
        />
      )}
    </>
  );
}
