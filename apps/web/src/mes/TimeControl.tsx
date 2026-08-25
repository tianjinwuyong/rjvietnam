import { useState } from "react";
import {
  Clock, AlertTriangle, CheckCircle, Timer, ShieldAlert,
  ArrowRight, Info,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

// Data from MES流程(1).xlsx 时效管控
// PCB开封 → AI → 贴片 → 回流焊 → SMT-AOI → PCBA上料
// 从PCB开封到插件，时间不允许超过168H
// 如果超期，则必须要经过烘烤2H之后才能投入插件
// MES插件（烘烤）：开始时间~结束时间
// 白胶固化≥4H（暂存满足4H）
// FCT PASS → 白胶固化≥4H → OK

interface TimeRule {
  id: string;
  name: string;
  icon: string;
  limit: string;
  unit: string;
  description: string;
  action: string;
  actionColor: string;
  bgColor: string;
  type: "critical" | "warning" | "normal";
}

const TIME_RULES: TimeRule[] = [
  {
    id: "pcb_168",
    name: "PCB开封时效",
    icon: "⏱",
    limit: "≤168",
    unit: "小时",
    description: "从PCB开封到插件，时间不允许超过168小时",
    action: "超期 → 强制烘烤2H",
    actionColor: "var(--danger)",
    bgColor: "rgba(239,68,68,0.08)",
    type: "critical",
  },
  {
    id: "glue_4h",
    name: "白胶固化时间",
    icon: "🔧",
    limit: "≥4",
    unit: "小时",
    description: "白胶固化需要满足最少4小时，暂存区计时",
    action: "不足4H → 暂存等待",
    actionColor: "var(--warn)",
    bgColor: "rgba(245,158,11,0.08)",
    type: "warning",
  },
  {
    id: "bake_2h",
    name: "PCB超期烘烤",
    icon: "🔥",
    limit: "=2",
    unit: "小时",
    description: "超168H的PCB必须经过2小时烘烤后才能投入插件工序",
    action: "烘烤2H → 重新计时",
    actionColor: "var(--info)",
    bgColor: "rgba(59,130,246,0.08)",
    type: "warning",
  },
];

interface TimeFlowNode {
  id: string;
  label: string;
  type: "normal" | "bake" | "pass" | "fail" | "wait";
  timeLimit?: string;
  timeLabel?: string;
}

const PCB_FLOW_NODES: TimeFlowNode[] = [
  { id: "pcb_open",   label: "PCB开封",   type: "normal", timeLimit: "T=0",  timeLabel: "开始计时" },
  { id: "ai",         label: "AI",                type: "normal" },
  { id: "mt",         label: "贴片",               type: "normal" },
  { id: "reflow",     label: "回流焊",             type: "normal" },
  { id: "smtaoi",     label: "SMT-AOI",           type: "normal" },
  { id: "pcbaj",      label: "PCBA上料（插件）",   type: "normal" },
];

const PCB_FAIL_FLOW: TimeFlowNode[] = [
  { id: "overdue",    label: "超过168H",           type: "fail",   timeLimit: ">168H" },
  { id: "bake",       label: "烘烤2H",             type: "bake",   timeLimit: "2H" },
  { id: "restart",    label: "重新开始计时",        type: "normal", timeLimit: "T=0" },
  { id: "ai2",        label: "AI",                type: "normal" },
];

const GLUE_FLOW: TimeFlowNode[] = [
  { id: "fct_pass",   label: "FCT PASS",          type: "pass" },
  { id: "glue_wait",  label: "白胶固化等待",       type: "wait",  timeLimit: "≥4H" },
  { id: "glue_ok",    label: "固化OK → 分板",      type: "pass" },
];

function TimeCard({ rule }: { rule: TimeRule }) {
  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${rule.actionColor}30`,
      background: rule.bgColor,
      padding: "14px 16px",
      marginBottom: 12,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>{rule.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{rule.name}</span>
            <span style={{
              fontSize: 11, padding: "1px 8px", borderRadius: 10,
              background: rule.actionColor + "20",
              color: rule.actionColor,
              fontWeight: 600,
            }}>
              {rule.limit} {rule.unit}
            </span>
          </div>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: 0, lineHeight: 1.5 }}>
            {rule.description}
          </p>
        </div>
      </div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 8,
        background: rule.actionColor + "15",
        fontSize: 12,
        color: rule.actionColor,
        fontWeight: 600,
      }}>
        <ArrowRight size={13} />
        {rule.action}
      </div>
    </div>
  );
}

function TimeFlowRow({ nodes }: { nodes: TimeFlowNode[] }) {
  const nodeStyle = (type: TimeFlowNode["type"]) => {
    switch (type) {
      case "bake":   return { border: "2px solid #f97316",    bg: "rgba(249,115,22,0.12)",  color: "#f97316" };
      case "fail":   return { border: "2px solid var(--danger)", bg: "rgba(239,68,68,0.12)", color: "var(--danger)" };
      case "pass":   return { border: "2px solid var(--ok)",    bg: "rgba(34,197,94,0.12)",  color: "var(--ok)" };
      case "wait":   return { border: "2px solid var(--warn)",  bg: "rgba(245,158,11,0.12)", color: "var(--warn)" };
      default:       return { border: "2px solid var(--info)",   bg: "rgba(59,130,246,0.12)", color: "var(--info)" };
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {nodes.map((node, i) => {
        const s = nodeStyle(node.type);
        return (
          <div key={node.id} style={{ display: "flex", alignItems: "center" }}>
            <div style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: s.border,
              background: s.bg,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              minWidth: 90,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{node.label}</span>
              {node.timeLimit && (
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{node.timeLimit}</span>
              )}
              {node.timeLabel && (
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{node.timeLabel}</span>
              )}
            </div>
            {i < nodes.length - 1 && (
              <ArrowRight size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function TimeControl({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<"pcb" | "glue">("pcb");

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8,
            background: "rgba(245,158,11,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Timer size={17} style={{ color: "var(--warn)" }} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t("mes.time.title", locale)}
              </h2>
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 10,
                background: "rgba(245,158,11,0.15)", color: "var(--warn)", fontWeight: 600,
              }}>
                MES流程
              </span>
            </div>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
              {t("mes.time.subtitle", locale)}
            </p>
          </div>
        </div>

        {/* Alert banner */}
        <div style={{
          display: "flex",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 10,
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.25)",
          marginBottom: 12,
          alignItems: "flex-start",
        }}>
          <AlertTriangle size={16} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.6 }}>
            <strong>关键规则：</strong>PCB开封到插件超过168H，必须经过<strong>2小时烘烤</strong>后才能投入。
            白胶固化必须满足<strong>≥4小时</strong>才能进入下一工序。超时未处理系统自动报警。
          </div>
        </div>

        {/* Tab */}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className={`action-button ${tab === "pcb" ? "active" : ""}`}
            style={{ background: tab === "pcb" ? "var(--info)" : "var(--nav)" }}
            onClick={() => setTab("pcb")}
          >
            <Clock size={13} />
            PCB开封时效（168H）
          </button>
          <button
            type="button"
            className={`action-button ${tab === "glue" ? "active" : ""}`}
            style={{ background: tab === "glue" ? "var(--info)" : "var(--nav)" }}
            onClick={() => setTab("glue")}
          >
            <Timer size={13} />
            白胶固化（≥4H）
          </button>
        </div>
      </div>

      {/* PCB时效 */}
      {tab === "pcb" && (
        <>
          {/* Time rules */}
          {TIME_RULES.slice(0, 2).map((rule) => (
            <TimeCard key={rule.id} rule={rule} />
          ))}

          {/* 正常流程 */}
          <div className="surface-panel">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <CheckCircle size={14} style={{ color: "var(--ok)" }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
                正常时效流程（≤168H）
              </h3>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                PCB开封 → 插件
              </span>
            </div>
            <TimeFlowRow nodes={PCB_FLOW_NODES} />
            <div style={{
              marginTop: 10,
              padding: "6px 12px",
              borderRadius: 8,
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.2)",
              fontSize: 11,
              color: "var(--ok)",
              fontWeight: 600,
            }}>
              ✓ 累计时间 ≤ 168H → 直接进入PCBA上料（插件工序）
            </div>
          </div>

          {/* 超时处理流程 */}
          <div className="surface-panel">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <ShieldAlert size={14} style={{ color: "var(--danger)" }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
                超时处理流程（＞168H）
              </h3>
            </div>
            <TimeFlowRow nodes={PCB_FAIL_FLOW} />
            <div style={{
              marginTop: 10,
              padding: "6px 12px",
              borderRadius: 8,
              background: "rgba(249,115,22,0.1)",
              border: "1px solid rgba(249,115,22,0.2)",
              fontSize: 11,
              color: "#f97316",
              fontWeight: 600,
            }}>
              ⚠ 超过168H → 强制烘烤2H → 重新计时 → 正常流程
            </div>
          </div>

          {/* MES插件烘烤记录要求 */}
          <div className="surface-panel">
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              MES插件烘烤记录要求
            </h3>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 8,
            }}>
              {[
                { label: "记录开始时间", value: "MES系统自动记录", icon: "🕐" },
                { label: "记录结束时间", value: "MES系统自动记录", icon: "🕐" },
                { label: "烘烤时长", value: "2小时（固定）", icon: "⏱" },
                { label: "操作人", value: "工站操作员", icon: "👤" },
                { label: "异常标记", value: "超168H自动触发", icon: "⚠" },
                { label: "烘烤设备", value: "烘烤箱编号", icon: "🔥" },
              ].map((item) => (
                <div key={item.label} style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 12 }}>{item.icon}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{item.label}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* 白胶固化 */}
      {tab === "glue" && (
        <>
          <TimeCard rule={TIME_RULES[1]} />
          <TimeCard rule={TIME_RULES[2]} />

          <div className="surface-panel">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <CheckCircle size={14} style={{ color: "var(--ok)" }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
                白胶固化流程
              </h3>
            </div>
            <TimeFlowRow nodes={GLUE_FLOW} />
            <div style={{
              marginTop: 10,
              padding: "6px 12px",
              borderRadius: 8,
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.2)",
              fontSize: 11,
              color: "var(--warn)",
              fontWeight: 600,
            }}>
              ⏱ FCT PASS → 白胶固化计时开始 → 暂存（满足4H）→ OK → 分板
            </div>
          </div>

          {/* 固化记录字段 */}
          <div className="surface-panel">
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
              白胶固化记录字段
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "固化开始时间", value: "FCT PASS时自动记录", req: "必填" },
                { label: "固化结束时间", value: "MES系统自动计算", req: "必填" },
                { label: "固化累计时长", value: "≥4H判定", req: "必填" },
                { label: "暂存区位置", value: "固化暂存库位", req: "必填" },
                { label: "批次/序列号", value: "PCBA批次号", req: "必填" },
                { label: "判定结果", value: "PASS/FAIL", req: "必填" },
              ].map((field) => (
                <div key={field.label} style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "7px 12px",
                  borderRadius: 8,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--text)" }}>{field.label}</span>
                    <span style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 8,
                      background: "rgba(239,68,68,0.1)",
                      color: "var(--danger)",
                      fontWeight: 600,
                    }}>
                      {field.req}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>{field.value}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
