import { useState, useCallback, useEffect } from "react";
import { Bot, AlertTriangle, CheckCircle, Clock, ChevronRight, RefreshCw, Zap, MessageSquare } from "lucide-react";
import { AgentDetailModal } from "./AgentDetailModal";
import { AgentChatPanel } from "./AgentChatPanel";
import { AgentTooltipCard } from "./AgentTooltip";
import {
  AGENT_PROFILES,
  getRootAgents,
  getChildAgents,
  getLevelLabel,
  getStatusColor,
  getDomainLabel,
  type AgentProfile,
  type AgentDomain,
} from "./agentData";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { type SignInResult } from "../auth/AuthSignIn";

interface Alert {
  id: number;
  agent_name: string;
  severity: string;
  node: string;
  message: string;
  created_at: string;
}

interface Props {
  locale: Locale;
  currentUser: SignInResult;
}

// ── Domain badge ────────────────────────────────────────────────

function DomainBadge({ domain }: { domain: AgentDomain }) {
  const locale = "zh-CN" as const;
  const colors: Record<AgentDomain, string> = {
    mes: "#3b82f6", wms: "#f59e0b", pmc: "#a78bfa",
    quality: "#22c55e", sales: "#ec4899", hr: "#06b6d4",
    finance: "#f59e0b", it: "#6366f1", cmd: "#ef4444", service: "#888",
  };
  const c = colors[domain] ?? "#6b7280";
  return (
    <span style={{
      background: c + "22", color: c,
      border: `1px solid ${c}44`,
      borderRadius: 4, padding: "1px 6px",
      fontSize: 10, fontWeight: 600, textTransform: "uppercase",
    }}>
      {getDomainLabel(domain, locale)}
    </span>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function roleToTitle(role: string): string {
  return role.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── Agent card ──────────────────────────────────────────────────

function AgentCard({ agent, locale, onClick, onChat }: { agent: AgentProfile; locale: Locale; onClick: () => void; onChat: (a: AgentProfile) => void }) {
  const locale_key = locale as "zh-CN" | "en-US" | "vi-VN";
  const statusColor = getStatusColor(agent.status);
  const children = getChildAgents(agent.id);

  return (
    <AgentTooltipCard agent={agent} locale={locale}>
      <div
        onClick={onClick}
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minWidth: 0,
          overflow: "hidden",
          cursor: "pointer",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--info)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 3px rgba(59,130,246,0.1)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Bot size={16} style={{ color: statusColor }} />
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {agent[`name_${locale_key}` as keyof Pick<AgentProfile, "name_zh" | "name_en" | "name_vi">] as string}
            </strong>
            <span style={{ fontSize: 10, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ color: "var(--text-2)" }}>{roleToTitle(agent.role)}</span>
              <span style={{ margin: "0 3px" }}>|</span>{agent.name_en}
              <span style={{ margin: "0 3px" }}>|</span>{agent.name_vi}
            </span>
          </div>
          <span style={{
            background: statusColor + "22", color: statusColor,
            border: `1px solid ${statusColor}44`,
            borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 600, flexShrink: 0,
          }}>
            {agent.status === "active" ? "●" : agent.status === "idle" ? "◐" : agent.status === "error" ? "!" : "○"}
          </span>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-2)", margin: 0, lineHeight: 1.4 }}>
          {agent[`responsibilities_${locale_key}` as keyof Pick<AgentProfile, "responsibilities_zh" | "responsibilities_en" | "responsibilities_vi">] as string}
        </p>
        <div style={{ display: "flex", gap: 6, fontSize: 10, color: "var(--text-3)", flexWrap: "wrap", alignItems: "center" }}>
          <DomainBadge domain={agent.domain} />
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <Zap size={10} /> {getLevelLabel(agent.level, locale_key)}
          </span>
          {children.length > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <ChevronRight size={10} /> {children.length} 下级
            </span>
          )}
          {agent.currentTasks.length > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <CheckCircle size={10} /> {agent.currentTasks.length} 任务
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onChat(agent); }}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "1px 6px", fontSize: 10,
              background: "var(--info)22", color: "var(--info)",
              border: "1px solid var(--info)44", borderRadius: 4,
              cursor: "pointer", fontWeight: 600,
            }}
            title={locale_key === "zh-CN" ? "对话" : "Chat"}
          >
            <MessageSquare size={10} /> {locale_key === "zh-CN" ? "对话" : locale_key === "vi-VN" ? "Chat" : "Chat"}
          </button>
        </div>
      </div>
    </AgentTooltipCard>
  );
}

// ── Alert row ───────────────────────────────────────────────────

function AlertRow({ alert }: { alert: Alert }) {
  const color = alert.severity === "critical" ? "var(--danger)" : alert.severity === "warn" ? "var(--warn)" : "var(--info)";
  return (
    <tr style={{ fontSize: 12, borderBottom: "1px solid var(--border)" }}>
      <td style={{ padding: "5px 8px" }}>
        <span style={{ background: color + "22", color: color, borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 600 }}>{alert.severity.toUpperCase()}</span>
      </td>
      <td style={{ padding: "5px 8px", color: "var(--text-2)" }}>{alert.agent_name}</td>
      <td style={{ padding: "5px 8px" }}>{alert.node}</td>
      <td style={{ padding: "5px 8px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alert.message}</td>
      <td style={{ padding: "5px 8px", color: "var(--text-3)", fontSize: 10, whiteSpace: "nowrap" }}>{new Date(alert.created_at).toLocaleTimeString()}</td>
    </tr>
  );
}

// ── Org tree node ────────────────────────────────────────────────

function OrgTreeNode({ agent, locale, onSelect, depth = 0 }: { agent: AgentProfile; locale: Locale; onSelect: (a: AgentProfile) => void; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const children = getChildAgents(agent.id);
  const locale_key = locale as "zh-CN" | "en-US" | "vi-VN";
  const statusColor = getStatusColor(agent.status);
  const hasKids = children.length > 0;

  const nameZh = agent[`name_${locale_key}` as keyof Pick<AgentProfile, "name_zh" | "name_en" | "name_vi">] as string;
  const roleLabel = agent.role.replace(/-/g, " ");

  return (
    <div style={{ marginLeft: depth > 0 ? 16 : 0 }}>
      <AgentTooltipCard agent={agent} locale={locale} placement="bottom">
        <div
          onClick={() => { if (hasKids) setOpen(!open); onSelect(agent); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 6px", borderRadius: 4,
            cursor: "pointer",
            background: depth === 0 ? "var(--surface-2)" : "transparent",
            border: depth === 0 ? "1px solid var(--border)" : "none",
            minWidth: 0,
          }}
        >
          {hasKids ? (
            <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : "none", transition: "0.15s", color: "var(--text-3)" }} />
          ) : (
            <span style={{ width: 12, flexShrink: 0, display: "inline-block" }} />
          )}
          <Bot size={depth === 0 ? 18 : 13} style={{ color: statusColor, flexShrink: 0 }} />

          {/* Two-line label: name + subtitle */}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: depth === 0 ? 14 : 12, fontWeight: depth === 0 ? 700 : 500, whiteSpace: "nowrap" }}>
                {nameZh}
              </span>
              {depth === 0 && <DomainBadge domain={agent.domain} />}
            </div>
            <div style={{
              fontSize: 10, color: "var(--text-3)", lineHeight: 1.3,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {depth === 0 ? (
                <>
                  <span style={{ color: "var(--text-2)" }}>{roleToTitle(agent.role)}</span>
                  <span style={{ margin: "0 3px" }}>|</span>{agent.name_en}
                  <span style={{ margin: "0 3px" }}>|</span>{agent.name_vi}
                </>
              ) : (
                <>
                  <span style={{ color: "var(--text-2)" }}>{roleToTitle(agent.role)}</span>
                  <span style={{ margin: "0 3px" }}>|</span>
                  {locale_key === 'zh-CN' ? agent.name_en : agent.name_zh}
                </>
              )}
            </div>
          </div>

          {depth > 0 && hasKids && (
            <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0, marginLeft: 4 }}>
              ({children.length})
            </span>
          )}
        </div>
      </AgentTooltipCard>
      {open && hasKids && (
        <div style={{ borderLeft: "1px solid var(--border)", marginLeft: 8, paddingLeft: 4 }}>
          {children.map((child) => (
            <OrgTreeNode key={child.id} agent={child} locale={locale} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────

export function AgentDashboard({ locale, currentUser }: Props) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProfile | null>(null);
  const [chatAgent, setChatAgent] = useState<AgentProfile | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const locale_key = locale as "zh-CN" | "en-US" | "vi-VN";

  // 模拟告警数据（来自 API /agents/alerts）
  const fetchAlerts = useCallback(async () => {
    // 实际应从 /agents/alerts 获取
    // 模拟告警
    const now = Date.now();
    const mockAlerts: Alert[] = [
      { id: 1, agent_name: "MES虚拟调度主管", severity: "warn", node: "SMT-2", message: "换线时间超过目标 25 分钟，请关注", created_at: new Date(now - 5 * 60000).toISOString() },
      { id: 2, agent_name: "IQC虚拟检验员", severity: "critical", node: "IQC", message: "三星来料不良率 8%，超出 AQL 标准", created_at: new Date(now - 18 * 60000).toISOString() },
      { id: 3, agent_name: "WMS虚拟仓储主管", severity: "info", node: "WMS", message: "效期预警：3 批物料将在 15 天内到期", created_at: new Date(now - 45 * 60000).toISOString() },
      { id: 4, agent_name: "PMC虚拟计划主管", severity: "warn", node: "PMC", message: "LG 紧急订单交期评估：原材料库存不足", created_at: new Date(now - 90 * 60000).toISOString() },
    ];
    setAlerts(mockAlerts);
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts, refreshKey]);

  const rootAgents = getRootAgents();
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warnCount = alerts.filter((a) => a.severity === "warn").length;
  const activeCount = AGENT_PROFILES.filter((a) => a.status === "active").length;

  return (
    <div className="screen-stack" style={{ gap: 16, padding: "16px" }}>
      {/* Stats */}
      <section style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "总虚拟员工", value: AGENT_PROFILES.length, tone: "info" },
          { label: "在岗", value: activeCount, tone: activeCount > 0 ? "ok" : "warning" },
          { label: "Critical", value: criticalCount, tone: criticalCount > 0 ? "danger" : "ok" },
          { label: "Warn", value: warnCount, tone: warnCount > 0 ? "warning" : "ok" },
        ].map(({ label, value, tone }) => (
          <div key={label} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 16px", minWidth: 90, textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: `var(--${tone})` }}>{value}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </section>

      {/* Org tree + Alerts */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,400px) minmax(0,1fr)", gap: 16, minWidth: 0 }}>
        <section className="surface-panel" style={{ minWidth: 0 }}>
          <div className="section-header">
            <div><h2 style={{ fontSize: 14, margin: 0 }}>{locale_key === "zh-CN" ? "组织架构" : "Organization"}</h2><p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>Virtual Agent Team · {locale_key === "zh-CN" ? "点击查看详情" : "Click to view details"}</p></div>
            <button onClick={() => setRefreshKey((k) => k + 1)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: 0 }}>
              <RefreshCw size={12} />{locale_key === "zh-CN" ? "刷新" : "Refresh"}
            </button>
          </div>
          <div style={{ padding: "8px 4px", maxHeight: 460, overflowY: "auto" }}>
            {rootAgents.map((agent) => (
              <OrgTreeNode key={agent.id} agent={agent} locale={locale} onSelect={setSelectedAgent} />
            ))}
          </div>
        </section>

        <section className="surface-panel" style={{ minWidth: 0 }}>
          <div className="section-header">
            <div><h2 style={{ fontSize: 14, margin: 0 }}>{locale_key === "zh-CN" ? "最近告警" : "Recent Alerts"}</h2><p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>{alerts.length} {locale_key === "zh-CN" ? "条" : "items"}</p></div>
            {criticalCount > 0 && <span style={{ background: "var(--danger)", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{criticalCount} CRITICAL</span>}
          </div>
          <div style={{ overflowX: "auto" }}>
            {alerts.length === 0 ? (
              <div style={{ textAlign: "center", padding: 24, color: "var(--text-3)", fontSize: 13 }}>
                <CheckCircle size={20} style={{ display: "block", margin: "0 auto 6px" }} />
                <p style={{ margin: 0 }}>{locale_key === "zh-CN" ? "暂无告警" : "No alerts"}</p>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--text-3)" }}>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>{locale_key === "zh-CN" ? "级别" : "Level"}</th>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>Agent</th>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>{locale_key === "zh-CN" ? "节点" : "Node"}</th>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>{locale_key === "zh-CN" ? "消息" : "Message"}</th>
                    <th style={{ padding: "4px 8px", textAlign: "left" }}>{locale_key === "zh-CN" ? "时间" : "Time"}</th>
                  </tr>
                </thead>
                <tbody>{alerts.map((a) => <AlertRow key={a.id} alert={a} />)}</tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* Agent cards grid */}
      <section className="surface-panel">
        <div className="section-header">
          <h2 style={{ fontSize: 14, margin: 0 }}>{locale_key === "zh-CN" ? "全部虚拟员工" : "All Virtual Staff"}</h2>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{locale_key === "zh-CN" ? "点击卡片查看完整档案" : "Click card to view full profile"}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, padding: "8px 0" }}>
          {AGENT_PROFILES.map((agent) => (
            <AgentCard key={agent.id} agent={agent} locale={locale} onClick={() => setSelectedAgent(agent)} onChat={setChatAgent} />
          ))}
        </div>
      </section>

      {/* Detail modal */}
      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          locale={locale}
          onClose={() => setSelectedAgent(null)}
        />
      )}

      {/* Chat panel */}
      {chatAgent && (
        <AgentChatPanel
          agent={chatAgent}
          locale={locale}
          currentUser={{ username: currentUser.username, displayName: currentUser.displayName, employeeId: undefined }}
          onClose={() => setChatAgent(null)}
        />
      )}
    </div>
  );
}
