import { useState, useMemo } from "react";
import { Users, Bell, AlertTriangle, CheckCircle, Clock, MessageSquare, ArrowRight } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type CardPriority = "urgent" | "normal";
type CardStatus = "open" | "inProgress" | "resolved";

interface CollabCard {
  id: number;
  title: string;
  department: string;
  priority: CardPriority;
  status: CardStatus;
  timestamp: string;
  description: string;
}

const deptColors: Record<string, string> = {
  "warehouse": "var(--info)",
  "production": "#8b5cf6",
  "quality": "var(--ok)",
  "pmc": "var(--warn)",
  "purchasing": "#ec4899",
  "engineering": "#14b8a6",
};

const emptyCards: Record<string, CollabCard[]> = { urgent: [], quality: [], expiry: [], tasks: [] };

const statusBadge: Record<CardStatus, { bg: string; label: string }> = {
  open: { bg: "var(--warn)", label: "待处理" },
  inProgress: { bg: "var(--info)", label: "处理中" },
  resolved: { bg: "var(--ok)", label: "已解决" },
};

export function WmsCollaborationDashboard({ locale }: { locale: Locale }) {
  const [cards] = useState(emptyCards);

  const colHeaders = [
    { key: "urgent", icon: Bell, label: t("wms.collaborationBoard", locale) + " — " + t("wms.urgentMark", locale), color: "var(--danger)" },
    { key: "quality", icon: AlertTriangle, label: t("wms.msdAlert", locale) + " / IQC", color: "var(--warn)" },
    { key: "expiry", icon: Clock, label: t("wms.expiryMonitor", locale), color: "#f59e0b" },
    { key: "tasks", icon: MessageSquare, label: t("wms.collaborationBoard", locale), color: "var(--info)" },
  ];

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Users size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.collaboration", locale)}</h2>
            <p>{t("wms.collaborationBoard", locale)}</p>
          </div>
        </div>
      </section>

      {/* Kanban columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, alignItems: "start" }}>
        {colHeaders.map(({ key, icon: Icon, label, color }) => (
          <section key={key} className="surface-panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, paddingBottom: 8, borderBottom: `2px solid ${color}` }}>
              <Icon size={16} color={color} />
              <strong style={{ fontSize: 13, flex: 1 }}>{label}</strong>
              <span className="badge" style={{ background: color, color: "#fff", fontSize: 10 }}>{cards[key]?.length || 0}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(cards[key] || []).map((card) => (
                <div key={card.id} style={{
                  padding: "10px 12px", borderRadius: 8, background: "var(--item-bg)",
                  borderLeft: `3px solid ${card.priority === "urgent" ? "var(--danger)" : deptColors[card.department] || "var(--muted)"}`,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  cursor: "default",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <strong style={{ fontSize: 12, lineHeight: 1.3 }}>{card.title}</strong>
                    {card.priority === "urgent" && <AlertTriangle size={12} color="var(--danger)" style={{ flexShrink: 0 }} />}
                  </div>
                  <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0", lineHeight: 1.3 }}>{card.description}</p>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 10, color: "var(--muted)" }}>
                    <span>
                      <span style={{
                        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                        background: deptColors[card.department] || "var(--muted)", marginRight: 4,
                      }} />
                      {card.department}
                    </span>
                    <span className={`badge`} style={{
                      background: statusBadge[card.status].bg, color: "#fff", fontSize: 9, padding: "1px 6px",
                    }}>
                      {statusBadge[card.status].label}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                    <Clock size={10} style={{ marginRight: 2 }} />{card.timestamp}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
