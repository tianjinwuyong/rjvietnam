import React, { useState } from "react";
import {
  Repeat, CheckCircle, XCircle, AlertTriangle, ArrowRight,
  GitBranch, RefreshCw, Settings2,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

// Data from MES流程(1).xlsx 复测要求
// ICT FAIL → 1st Retest → PASS → Next | FAIL → 2nd Retest → PASS → Next | FAIL → Repair → OK → Next
// FCT FAIL → 1st Retest → PASS → Next | FAIL → 2nd Retest → PASS → Next | FAIL → Repair → OK → Next
// Dispensing glue: Special flow (1st retest → Fail → 2nd retest → Fail → Repair → OK)

interface RetestNode {
  id: string;
  label: string;
  type: "start" | "test" | "retest1" | "retest2" | "pass" | "fail" | "repair" | "decision";
  station: string;
  description?: string;
}

const ICT_NODES: RetestNode[] = [
  { id: "ict_start",   label: "ICT测试",        type: "test",    station: "ICT",    description: "自动测试治具" },
  { id: "ict_result", label: "结果判定",        type: "decision", station: "ICT" },
  { id: "ict_pass",   label: "PASS → FCT",      type: "pass",    station: "ICT" },
  { id: "retest1",    label: "1st Retest",       type: "retest1", station: "ICT" },
  { id: "retest1_result", label: "结果判定",    type: "decision", station: "ICT" },
  { id: "retest1_pass",  label: "PASS → FCT",   type: "pass",    station: "ICT" },
  { id: "retest2",    label: "2nd Retest",       type: "retest2", station: "ICT" },
  { id: "retest2_result", label: "结果判定",    type: "decision", station: "ICT" },
  { id: "retest2_pass",  label: "PASS → FCT",   type: "pass",    station: "ICT" },
  { id: "repair",     label: "维修 → 复测OK",   type: "repair",  station: "ICT" },
  { id: "repair_done", label: "OK → FCT",        type: "pass",    station: "ICT" },
];

const FCT_NODES: RetestNode[] = [
  { id: "fct_start",  label: "FCT测试",         type: "test",    station: "FCT",    description: "功能测试" },
  { id: "fct_result", label: "结果判定",         type: "decision", station: "FCT" },
  { id: "fct_pass",   label: "PASS → 分板",      type: "pass",    station: "FCT" },
  { id: "f_retest1",  label: "1st Retest",       type: "retest1", station: "FCT" },
  { id: "f_retest1_result", label: "结果判定",  type: "decision", station: "FCT" },
  { id: "f_retest1_pass",  label: "PASS → 分板", type: "pass",    station: "FCT" },
  { id: "f_retest2",  label: "2nd Retest",       type: "retest2", station: "FCT" },
  { id: "f_retest2_result", label: "结果判定",  type: "decision", station: "FCT" },
  { id: "f_retest2_pass",  label: "PASS → 分板", type: "pass",    station: "FCT" },
  { id: "f_repair",   label: "维修 → 复测OK",   type: "repair",  station: "FCT" },
  { id: "f_repair_done", label: "OK → 分板",     type: "pass",    station: "FCT" },
];

const DISP_NODES: RetestNode[] = [
  { id: "disp_start", label: "点胶",             type: "test",    station: "Dispensing" },
  { id: "disp_result", label: "结果判定",        type: "decision", station: "Dispensing" },
  { id: "disp_pass",  label: "PASS → 下工序",    type: "pass",    station: "Dispensing" },
  { id: "d_retest1",  label: "1st Retest",       type: "retest1", station: "Dispensing" },
  { id: "d_retest1_result", label: "结果判定",   type: "decision", station: "Dispensing" },
  { id: "d_retest1_pass",  label: "PASS → 下工序", type: "pass",   station: "Dispensing" },
  { id: "d_retest2",  label: "2nd Retest",       type: "retest2", station: "Dispensing" },
  { id: "d_retest2_result", label: "结果判定",   type: "decision", station: "Dispensing" },
  { id: "d_retest2_pass",  label: "PASS → 下工序", type: "pass",  station: "Dispensing" },
  { id: "d_repair",   label: "维修 → OK",        type: "repair",  station: "Dispensing" },
  { id: "d_repair_done", label: "OK → 下工序",   type: "pass",   station: "Dispensing" },
];

const nodeColor: Record<RetestNode["type"], { border: string; bg: string; text: string }> = {
  start:     { border: "var(--nav)",   bg: "rgba(99,102,241,0.12)",  text: "#6366f1" },
  test:      { border: "var(--info)",  bg: "rgba(59,130,246,0.12)",  text: "var(--info)" },
  retest1:   { border: "var(--warn)",  bg: "rgba(245,158,11,0.12)", text: "var(--warn)" },
  retest2:   { border: "#f97316",     bg: "rgba(249,115,22,0.12)", text: "#f97316" },
  pass:      { border: "var(--ok)",    bg: "rgba(34,197,94,0.12)",  text: "var(--ok)" },
  fail:      { border: "var(--danger)",bg: "rgba(239,68,68,0.12)",  text: "var(--danger)" },
  repair:    { border: "#a855f7",     bg: "rgba(168,85,247,0.12)", text: "#a855f7" },
  decision:  { border: "var(--warn)",  bg: "rgba(245,158,11,0.10)", text: "var(--warn)" },
};

function RetestCard({ node }: { node: RetestNode }) {
  const colors = nodeColor[node.type];
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      minWidth: 120,
    }}>
      <div style={{
        padding: "8px 14px",
        borderRadius: 10,
        border: `2px solid ${colors.border}`,
        background: colors.bg,
        textAlign: "center",
        width: "100%",
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>
          {node.label}
        </div>
        {node.description && (
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
            {node.description}
          </div>
        )}
      </div>
    </div>
  );
}

function DecisionBadge({ label }: { label: string }) {
  return (
    <div style={{
      padding: "3px 8px",
      borderRadius: 20,
      background: "rgba(245,158,11,0.15)",
      border: "1px solid var(--warn)",
      fontSize: 10,
      fontWeight: 600,
      color: "var(--warn)",
    }}>
      {label}
    </div>
  );
}

// Render a simple horizontal flow as a series of cards + arrows
function RetestFlow({ nodes }: { nodes: RetestNode[] }) {
  // Map nodes to a visual flow layout
  const row1: RetestNode[] = [];
  const row2: RetestNode[] = [];
  const row3: RetestNode[] = [];

  // ICT/FCT flow layout:
  // Start → Decision → [Pass→END] | [Retest1→Decision→[Pass→END]|[Retest2→Decision→[Pass→END]|[Repair→END]]]
  const order = [
    "start", "result",          // row 1
    "pass",  "retest1",         // row 2
    "retest1_result", "retest2", // row 2
    "retest1_pass", "retest2_result", "repair", // row 3
    "retest2_pass", "repair_done", // row 3
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Row 1 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <RetestCard node={nodes.find(n => n.id === "ict_start")!} />
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <RetestCard node={nodes.find(n => n.id === "ict_result")!} />
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <DecisionBadge label="PASS" />
          <ArrowRight size={16} style={{ color: "var(--ok)" }} />
          <span style={{ fontSize: 10, color: "var(--ok)" }}>→ 下工序</span>
        </div>
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <DecisionBadge label="FAIL → 1st Retest" />
      </div>

      {/* Row 2: 1st Retest */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingLeft: 40 }}>
        <RetestCard node={nodes.find(n => n.id === "retest1")!} />
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <RetestCard node={nodes.find(n => n.id === "retest1_result")!} />
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <DecisionBadge label="PASS" />
          <ArrowRight size={16} style={{ color: "var(--ok)" }} />
          <span style={{ fontSize: 10, color: "var(--ok)" }}>→ 下工序</span>
        </div>
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <DecisionBadge label="FAIL → 2nd Retest" />
      </div>

      {/* Row 3: 2nd Retest + Repair */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingLeft: 80 }}>
        <RetestCard node={nodes.find(n => n.id === "retest2")!} />
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <RetestCard node={nodes.find(n => n.id === "retest2_result")!} />
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <DecisionBadge label="PASS" />
          <ArrowRight size={16} style={{ color: "var(--ok)" }} />
          <span style={{ fontSize: 10, color: "var(--ok)" }}>→ 下工序</span>
        </div>
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <DecisionBadge label="FAIL → 维修" />
      </div>

      {/* Row 4: Repair outcome */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 120 }}>
        <RetestCard node={nodes.find(n => n.id === "repair")!} />
        <ArrowRight size={16} style={{ color: "var(--muted)" }} />
        <div style={{
          padding: "8px 14px",
          borderRadius: 10,
          border: "2px solid var(--ok)",
          background: "rgba(34,197,94,0.12)",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ok)",
        }}>
          维修OK → 下工序
        </div>
      </div>
    </div>
  );
}

function FlowSummary({ title, station, icon: Icon, color, nodes }: {
  title: string;
  station: string;
  icon: React.ComponentType<{size?: number; style?: React.CSSProperties}>;
  color: string;
  nodes: RetestNode[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{
      borderRadius: 12,
      border: "1px solid var(--border)",
      overflow: "hidden",
      marginBottom: 12,
    }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          background: "var(--surface)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: color,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={16} style={{ color: "white" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{title}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{station}</div>
        </div>
        <div style={{
          fontSize: 11,
          padding: "2px 8px",
          borderRadius: 10,
          background: "var(--nav)",
          color: "var(--muted)",
        }}>
          {open ? "收起" : "展开"}
        </div>
      </button>

      {open && (
        <div style={{ padding: "12px 16px", background: "var(--bg)" }}>
          <RetestFlow nodes={nodes} />
        </div>
      )}
    </div>
  );
}

// ── Retest Rules ─────────────────────────────────────────────────────────────

export function RetestRules({ locale }: { locale: Locale }) {
  const [stationCode,setStationCode]=useState('manu_ict');
  const [retestSn,setRetestSn]=useState('');
  const [retestMessage,setRetestMessage]=useState('');
  const armMesRetest=async()=>{const response=await fetch('/api/station/retest/arm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stationCode,sn:retestSn,actor:'MES_OPERATOR'})});const data=await response.json();setRetestMessage(response.ok?`MES已授权第${data.attempt}次复检，剩余${data.remaining}次`:`复检拒绝：${data.code||data.message}`)};
  return (
    <div className="screen-stack">
      <div className="surface-panel"><h3 style={{marginTop:0}}>所有工位MES复检授权 / MES Retest Authorization</h3><div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <select value={stationCode} onChange={e=>setStationCode(e.target.value)}>{[['manu_pda','PDA上料'],['manu_aoi','AOI'],['manu_ict','ICT'],['manu_fct','FCT'],['manu_depanel','分板'],['manu_qr_binding','PCBA外壳绑码'],['manu_assembly_ate','组装ATE'],['manu_supersonic','超声'],['manu_aging','老化'],['manu_hivolt_ate','高压ATE'],['manu_package_ate','包装ATE'],['manu_outer_box_binding','外箱绑码'],['manu_pallet_binding','栈板绑码']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select>
        <input value={retestSn} onChange={e=>setRetestSn(e.target.value.toUpperCase())} placeholder="扫描或输入SN" style={{minWidth:260}} onKeyDown={e=>{if(e.key==='Enter')armMesRetest()}}/><button onClick={armMesRetest}>授权下一次复检</button>
      </div>{retestMessage&&<div style={{marginTop:8,color:'#fbbf24'}}>{retestMessage}</div>}<p style={{fontSize:12,opacity:.75}}>每次授权只对下一次复检有效；完成后自动取消。非检测工位记录为扫码复核，不生成测试PASS。</p></div>
      {/* Header */}
      <div className="surface-panel">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8,
            background: "rgba(245,158,11,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <RefreshCw size={17} style={{ color: "var(--warn)" }} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                {t("mes.retest.title", locale)}
              </h2>
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 10,
                background: "rgba(245,158,11,0.15)", color: "var(--warn)", fontWeight: 600,
              }}>
                MES流程
              </span>
            </div>
            <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
              {t("mes.retest.subtitle", locale)}
            </p>
          </div>
        </div>

        {/* Rule summary cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}>
          {[
            {
              icon: <Repeat size={14} />,
              label: "复测次数",
              value: "2次",
              color: "rgba(245,158,11,0.15)",
              textColor: "var(--warn)",
            },
            {
              icon: <CheckCircle size={14} />,
              label: "PASS处理",
              value: "进入下一工序",
              color: "rgba(34,197,94,0.15)",
              textColor: "var(--ok)",
            },
            {
              icon: <XCircle size={14} />,
              label: "2次Fail",
              value: "触发维修流程",
              color: "rgba(239,68,68,0.15)",
              textColor: "var(--danger)",
            },
            {
              icon: <Settings2 size={14} />,
              label: "记录要求",
              value: "每次测试结果入库",
              color: "rgba(99,102,241,0.15)",
              textColor: "#6366f1",
            },
          ].map((card) => (
            <div key={card.label} style={{
              padding: "10px 14px",
              borderRadius: 10,
              background: card.color,
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: card.textColor }}>
                {card.icon}
                <span style={{ fontSize: 11, fontWeight: 600 }}>{card.label}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: card.textColor }}>{card.value}</span>
            </div>
          ))}
        </div>

        {/* Flow legend */}
        <div style={{
          padding: "10px 14px",
          borderRadius: 10,
          background: "var(--nav)",
          fontSize: 12,
          color: "var(--muted)",
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 20px",
        }}>
          {[
            { color: "var(--info)",    label: "测试" },
            { color: "var(--warn)",    label: "1次复测" },
            { color: "#f97316",         label: "2次复测" },
            { color: "var(--ok)",      label: "PASS" },
            { color: "var(--danger)",  label: "FAIL" },
            { color: "#a855f7",         label: "维修" },
          ].map((item) => (
            <span key={item.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{
                display: "inline-block",
                width: 8, height: 8, borderRadius: "50%",
                background: item.color,
              }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {/* ICT Flow */}
      <FlowSummary
        title="ICT 自动测试"
        station="工站: ICT · 治具测试"
        icon={Cpu}
        color="var(--info)"
        nodes={ICT_NODES}
      />

      {/* FCT Flow */}
      <FlowSummary
        title="FCT 功能测试"
        station="工站: FCT · 自动功能测试"
        icon={Box}
        color="#6366f1"
        nodes={FCT_NODES}
      />

      {/* Dispensing Flow */}
      <FlowSummary
        title="点胶 (Dispensing)"
        station="工站: 自动点胶机"
        icon={AlertTriangle}
        color="#f97316"
        nodes={DISP_NODES}
      />

      {/* 关键规则说明 */}
      <div className="surface-panel">
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          {t("mes.retest.rules", locale)}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            {
              icon: "1",
              text: "ICT/FCT FAIL时，系统自动创建1st Retest任务",
              color: "var(--warn)",
            },
            {
              icon: "2",
              text: "1st Retest PASS → 自动过站，进入下一工序",
              color: "var(--ok)",
            },
            {
              icon: "3",
              text: "1st Retest FAIL → 创建2nd Retest任务",
              color: "#f97316",
            },
            {
              icon: "4",
              text: "2nd Retest PASS → 自动过站，进入下一工序",
              color: "var(--ok)",
            },
            {
              icon: "5",
              text: "2nd Retest FAIL → 触发维修流程，记录FAIL数据",
              color: "var(--danger)",
            },
            {
              icon: "6",
              text: "维修完成后需重新过站验证，PASS才能进入下一工序",
              color: "#a855f7",
            },
            {
              icon: "7",
              text: "所有测试数据（原始值、阈值、结果、时间）需记录到 station_flow_records",
              color: "var(--info)",
            },
          ].map((rule) => (
            <div key={rule.text} style={{
              display: "flex",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 8,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              alignItems: "flex-start",
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: "50%",
                background: rule.color,
                color: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                flexShrink: 0,
              }}>
                {rule.icon}
              </span>
              <span style={{ fontSize: 12, color: "var(--text)" }}>{rule.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const Cpu = ({ size = 16, style }: { size?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={style}>
    <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
    <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>
  </svg>
);

const Box = ({ size = 16, style }: { size?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={style}>
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    <polyline points="3.27,6.96 12,12.01 20.73,6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);
// @ts-nocheck
