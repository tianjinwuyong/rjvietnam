import { useState, type ReactNode } from "react";
import { AgentProfile, AGENT_PROFILES } from "./agentData";
import { AgentAvatar } from "./AgentAvatar";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface Props {
  agent: AgentProfile;
  locale: Locale;
  children: ReactNode;
  placement?: "top" | "bottom";
}

export function AgentTooltipCard({ agent, locale, children, placement = "top" }: Props) {
  const [visible, setVisible] = useState(false);
  const locale_key = locale as "zh-CN" | "en-US" | "vi-VN";
  const lk = locale_key;

  // Resolve parent name
  const parentName = (() => {
    if (!agent.parentId) return null;
    const parent = AGENT_PROFILES.find((a: AgentProfile) => a.id === agent.parentId);
    return parent ? parent[`name_${lk}` as keyof Pick<AgentProfile, "name_zh" | "name_en" | "name_vi">] as string : null;
  })();

  const levelLabel = agent.level === 1
    ? t("agents.tooltip.level1", locale)
    : agent.level === 2
    ? t("agents.tooltip.level2", locale)
    : t("agents.tooltip.level3", locale);

  const statusColor = agent.status === "active" ? "#22c55e"
    : agent.status === "idle" ? "#f59e0b"
    : agent.status === "error" ? "#ef4444" : "#6b7280";

  const taskCount = agent.currentTasks.length;

  return (
    <div
      style={{ position: "relative", display: "block", width: "100%", minWidth: 0 }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          style={{
            position: "absolute",
            zIndex: 9999,
            [placement === "top" ? "bottom" : "top"]: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: 280,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            padding: "12px 14px",
            pointerEvents: "none",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <AgentAvatar
              name={agent[`name_${lk}` as keyof Pick<AgentProfile, "name_zh" | "name_en" | "name_vi">] as string}
              gender={agent.gender}
              size={44}
              status={agent.status}
              showExpression
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                {agent[`name_${lk}` as keyof Pick<AgentProfile, "name_zh" | "name_en" | "name_vi">] as string}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {agent[`name_en` as keyof Pick<AgentProfile, "name_en">] as string}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <span style={{
                  background: statusColor + "22", color: statusColor,
                  borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 600,
                }}>
                  ● {agent.status}
                </span>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{levelLabel}</span>
              </div>
            </div>
          </div>

          {/* Fields */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: "var(--muted)", minWidth: 56, fontSize: 11 }}>{t("agents.tooltip.position", locale)}:</span>
              <span style={{ fontWeight: 600 }}>{agent.role}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: "var(--muted)", minWidth: 56, fontSize: 11 }}>{t("agents.tooltip.reportsTo", locale)}:</span>
              <span style={{}}>{parentName ?? "—"}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: "var(--muted)", minWidth: 56, fontSize: 11 }}>IP / API:</span>
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--info)" }}>{agent.api}</span>
            </div>
          </div>

          {/* Tasks */}
          {taskCount > 0 ? (
            <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5 }}>
                {t("agents.tooltip.currentTasks", locale)} ({taskCount} {t("agents.tooltip.tasks", locale)})
              </div>
              {agent.currentTasks.slice(0, 3).map((task, i) => (
                <div key={i} style={{ marginBottom: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ fontWeight: 500, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {task.task}
                    </span>
                    <span style={{ color: "var(--muted)" }}>{task.completion}%</span>
                  </div>
                  <div style={{
                    height: 3, background: "var(--border)", borderRadius: 2, marginTop: 2, overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%",
                      width: `${task.completion}%`,
                      background: task.completion >= 80 ? "#22c55e" : task.completion >= 40 ? "#f59e0b" : "#3b82f6",
                      borderRadius: 2,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8, fontSize: 11, color: "var(--muted)" }}>
              {t("agents.tooltip.noTasks", locale)}
            </div>
          )}

          {/* Arrow */}
          <div style={{
            position: "absolute",
            [placement === "top" ? "bottom" : "top"]: -6,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "6px solid transparent",
            borderRight: "6px solid transparent",
            [placement === "top" ? "borderTop" : "borderBottom"]: "6px solid var(--border)",
          }} />
        </div>
      )}
    </div>
  );
}
