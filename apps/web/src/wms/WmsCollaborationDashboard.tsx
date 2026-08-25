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

const mockCards: Record<string, CollabCard[]> = {
  urgent: [
    { id: 1, title: "急料: IC-MCU-STM32 库存不足", department: "warehouse", priority: "urgent", status: "open", timestamp: "2025-06-29 08:30", description: "Line 01 产线急缺 STM32，预计 2 小时内需到料" },
    { id: 2, title: "IQC 积压: 来料 15 批未检", department: "quality", priority: "urgent", status: "open", timestamp: "2025-06-29 07:45", description: "收货区积压 15 批来料，其中 3 批为急料" },
    { id: 3, title: "供应商 002 批次异常需处理", department: "purchasing", priority: "urgent", status: "inProgress", timestamp: "2025-06-28 16:00", description: "电阻批次 LOT-20250625-003 阻值偏差" },
  ],
  quality: [
    { id: 4, title: "IQC 标准更新: 电容 AQL 调整", department: "quality", priority: "normal", status: "open", timestamp: "2025-06-28 14:00", description: "陶瓷电容 AQL 从 0.65 调整为 0.4" },
    { id: 5, title: "MSD 预警: 3 批 IC 即将超期", department: "quality", priority: "urgent", status: "open", timestamp: "2025-06-28 10:00", description: "STM32/FPGA 暴露时间即将超过 MSD-3 限值" },
  ],
  expiry: [
    { id: 6, title: "近效期: 贴片电容 100μF 批次", department: "warehouse", priority: "normal", status: "open", timestamp: "2025-06-28 09:00", description: "LOT-20250115-001 已过期，库存 5000pcs 需处理" },
    { id: 7, title: "锡膏 SP-LOT-20260610-002 回温完成", department: "warehouse", priority: "normal", status: "resolved", timestamp: "2025-06-28 08:00", description: "已回温完毕，可领用" },
    { id: 8, title: "FIFO 违规: 电阻批次出库顺序错误", department: "warehouse", priority: "urgent", status: "inProgress", timestamp: "2025-06-27 15:00", description: "LOT-20250625-003 先出，违反 FIFO" },
  ],
  tasks: [
    { id: 9, title: "跨部门盘点: A 库区本周盘点", department: "pmc", priority: "normal", status: "open", timestamp: "2025-06-27 11:00", description: "PMC+仓库+财务三方盘点 A 库区，需协调时间" },
    { id: 10, title: "产线退料: Line 02 退料 5 项", department: "production", priority: "normal", status: "inProgress", timestamp: "2025-06-27 09:30", description: "5 项多余物料退回仓库" },
    { id: 11, title: "新供应商导入: SUP-005 审厂安排", department: "purchasing", priority: "normal", status: "open", timestamp: "2025-06-26 14:00", description: "品质+工程+采购三方审厂，需预约" },
  ],
};

const statusBadge: Record<CardStatus, { bg: string; label: string }> = {
  open: { bg: "var(--warn)", label: "待处理" },
  inProgress: { bg: "var(--info)", label: "处理中" },
  resolved: { bg: "var(--ok)", label: "已解决" },
};

export function WmsCollaborationDashboard({ locale }: { locale: Locale }) {
  const [cards] = useState(mockCards);

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
