import { useState } from "react";
import {
  CheckCircle, XCircle, AlertTriangle, Cpu, Box, Package, Eye,
  Wrench, Layers, ArrowRight, ArrowDown, Download, FileText, GitBranch,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

// ── Data from MES流程(1).xlsx 自动线工艺流程 + MES岗位 ────────────────────────

type NodeType = "process" | "decision" | "start" | "end" | "vi" | "ok" | "ng" | "store";

interface FlowNode {
  id: string;
  label: string;
  type: NodeType;
  line?: number; // 0=smt, 1=post, 2=pack
  group?: string; // for sub-grouping
}

interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  type?: "ok" | "ng" | "normal";
}

// Full SMT line workflow from 自动线工艺流程
const SMT_FLOW_NODES: FlowNode[] = [
  // SMT段
  { id: "vendor",       label: "Vendor",           type: "start" },
  { id: "receiving",    label: "Receiving",        type: "process" },
  { id: "storage",      label: "Storage",          type: "process" },
  { id: "iqc",         label: "IQC",              type: "process" },
  { id: "matprep",      label: "Material Prep",    type: "process" },
  { id: "lasermark",    label: "Laser Marking/2D", type: "process" },
  { id: "autosmt",     label: "Auto-Insertion (Vertical)", type: "process" },
  { id: "redglue",     label: "Red Glue Printing",type: "process" },
  { id: "placement",   label: "Placement",        type: "process" },
  { id: "reflow",      label: "Reflow Soldering", type: "process" },
  { id: "smtaoi",      label: "SMT-AOI",          type: "vi" },
  { id: "vi1",         label: "VI",               type: "vi" },
  { id: "pcbaload",    label: "PCBA Loading",      type: "process" },
  { id: "repair1",      label: "Repair",           type: "ng" },
  { id: "scrap1",      label: "Scrap",            type: "ng" },
  // 异形件
  { id: "oddform",     label: "Odd-Form Insertion",type: "process" },
  { id: "disp1",       label: "Auto Dispensing 1", type: "process" },
  { id: "inserta",     label: "Insertion C1A/T1",  type: "process" },
  { id: "inserths1",   label: "Insertion HS1",     type: "process" },
  { id: "inserths2",   label: "Insertion HS2",     type: "process" },
  { id: "vi2",         label: "VI",               type: "vi" },
  { id: "wave",        label: "Wave Soldering",    type: "process" },
  { id: "height",      label: "PCBA Height Measure",type: "process" },
  { id: "wsaoi",       label: "WS-AOI",            type: "vi" },
  // ICT / FCT
  { id: "ict",         label: "ICT Auto Test",     type: "process" },
  { id: "fct",         label: "FCT Auto Test",     type: "process" },
  { id: "disp2",       label: "Auto Dispensing 2", type: "process" },
  { id: "cure",        label: "Auto Glue Curing",  type: "process" },
  { id: "depanel",     label: "Auto PCBA Depanel",  type: "process" },
  // 电源/组装
  { id: "mosform",     label: "MOS Forming",       type: "process" },
  { id: "screw",       label: "Auto Heat Sink Screw", type: "process" },
  { id: "tempstore1",  label: "Temporary Storage",  type: "store" },
  { id: "ng1",         label: "NG",                type: "ng" },
  { id: "ok1",         label: "OK",                type: "ok" },
  // 组装段
  { id: "accable",     label: "AC Cable Assembly", type: "process" },
  { id: "acsolder",    label: "AC Cable Soldering",type: "process" },
  { id: "dccable",     label: "DC Cable Assembly",type: "process" },
  { id: "dcsolder",    label: "DC Cable Soldering",type: "process" },
  { id: "viccd",       label: "VI/CCD",            type: "vi" },
  { id: "lasereng",    label: "Auto Laser Engrave",type: "process" },
  { id: "ng2",         label: "NG",                type: "ng" },
  { id: "ok2",         label: "OK",                type: "ok" },
  { id: "touchup",     label: "Touch Up",          type: "process" },
  { id: "assembly",    label: "Assembly/Dispense",  type: "process" },
  { id: "nonDry",      label: "Non-drying Adhesive",type: "process" },
  { id: "topenc",      label: "Top Enclosure",     type: "process" },
  { id: "ate1",        label: "ATE1",              type: "process" },
  { id: "ultrasonic",  label: "Ultrasonic",        type: "process" },
  { id: "ok3",         label: "OK",                type: "ok" },
  { id: "vi3",         label: "VI",               type: "vi" },
  { id: "biloading",   label: "BI Loading",        type: "process" },
  { id: "burnin",      label: "Burn-in",           type: "process" },
  { id: "ok4",         label: "OK",                type: "ok" },
  { id: "psudl",       label: "PSU Downloading",   type: "process" },
  { id: "steth",       label: "Stethoscope",       type: "process" },
  { id: "hipot",       label: "Hi-pot",            type: "process" },
  { id: "ok5",         label: "OK",                type: "ok" },
  { id: "ate2",        label: "ATE2",              type: "process" },
  { id: "ok6",         label: "OK",                type: "ok" },
  { id: "loadtest",    label: "Loading Test",      type: "process" },
  { id: "ok7",         label: "OK",                type: "ok" },
  // 包装
  { id: "enclabel",    label: "Enclosure Labeling", type: "process" },
  { id: "accablelbl",  label: "AC Cable Labeling", type: "process" },
  { id: "vi4",         label: "VI",               type: "vi" },
  { id: "packscan",    label: "Packing Scanning",  type: "process" },
  { id: "pebag",       label: "PE Bagging",         type: "process" },
  { id: "boxseal",     label: "Auto Box Sealing",  type: "process" },
  { id: "autopack",    label: "Auto Packing",       type: "process" },
  { id: "oqc",         label: "OQC Test",           type: "vi" },
  { id: "ok8",         label: "OK",                type: "ok" },
  { id: "tempstore2",  label: "Temporary Storage",  type: "store" },
  { id: "scrap2",      label: "Scrap",            type: "ng" },
  { id: "repair2",     label: "Repair",           type: "ng" },
  { id: "scrap3",      label: "Scrap",            type: "ng" },
  { id: "ng3",         label: "NG",                type: "ng" },
  { id: "ok9",         label: "OK",                type: "ok" },
  { id: "repair3",     label: "Repair",           type: "ng" },
  { id: "scrap4",      label: "Scrap",            type: "ng" },
  { id: "ng4",         label: "NG",                type: "ng" },
  { id: "ok10",        label: "OK",                type: "ok" },
  { id: "repair4",     label: "Repair",           type: "ng" },
  { id: "scrap5",      label: "Scrap",            type: "ng" },
  { id: "ng5",         label: "NG",                type: "ng" },
  { id: "ok11",        label: "OK",                type: "ok" },
  { id: "rework",      label: "Rework",           type: "process" },
];

// PO Flow nodes
const PO_FLOW_NODES: FlowNode[] = [
  { id: "po_start", label: "客户PO", type: "start" },
  { id: "erp_mrp", label: "ERP: 运行MRP生成物料需求", type: "process" },
  { id: "erp_wo", label: "ERP: 创建生产工单与客户PO关联", type: "process" },
  { id: "po_wait", label: "工单等待备料", type: "process" },
  { id: "erp_po", label: "ERP: 下达采购订单", type: "process" },
  { id: "supplier", label: "供应商送货", type: "process" },
  { id: "doc_verify", label: "核对单据", type: "process" },
  { id: "iqc_task", label: "MES: 创建IQC待检任务", type: "process" },
  { id: "iqc_insp", label: "IQC检验", type: "process" },
  { id: "iqc_ok", label: "OK → 合格料待用", type: "ok" },
  { id: "iqc_ng", label: "NG → 不合格处理", type: "ng" },
  { id: "special", label: "特采", type: "decision" },
  { id: "return", label: "退货给供应商", type: "ng" },
  { id: "issue", label: "按工单发料(MES: 物料Date code与工单绑定)", type: "process" },
  { id: "online", label: "物料上线(MES: 电子料PDA扫码)", type: "process" },
  { id: "production", label: "各工序生产与MES报工", type: "process" },
  { id: "pack_bind", label: "包装(绑定成品SN与工单)", type: "process" },
  { id: "oqc_insp", label: "送检 → OQC", type: "process" },
  { id: "oqc_judge", label: "OQC判定", type: "decision" },
  { id: "wo_close", label: "MES/ERP: 工单关闭", type: "process" },
  { id: "fg_store", label: "成品入库", type: "store" },
  { id: "rework_flow", label: "返工流程", type: "process" },
  { id: "scrap_flow", label: "报废处理", type: "ng" },
];

// MES岗位 nodes (工站过站序列)
const MES_STATION_NODES: FlowNode[] = [
  { id: "ms_ai1", label: "AI1", type: "process" },
  { id: "ms_ai2", label: "AI2", type: "process" },
  { id: "ms_mt1", label: "贴片1", type: "process" },
  { id: "ms_mt2", label: "贴片2", type: "process" },
  { id: "ms_smti", label: "SMT-AOI", type: "vi" },
  { id: "ms_pcba", label: "PCBA上料", type: "process" },
  { id: "ms_wsi", label: "WS-AOI", type: "vi" },
  { id: "ms_ict", label: "ICT", type: "process" },
  { id: "ms_fct", label: "FCT", type: "process" },
  { id: "ms_div", label: "分板", type: "process" },
  { id: "ms_link", label: "PCBA Link", type: "process" },
  { id: "ms_ate1", label: "ATE1", type: "process" },
  { id: "ms_ultra", label: "Ultrasonic", type: "process" },
  { id: "ms_vis", label: "外观/限高测试", type: "vi" },
  { id: "ms_bi", label: "Burn-in", type: "process" },
  { id: "ms_hp", label: "Hi-pot", type: "process" },
  { id: "ms_ate2", label: "ATE2", type: "process" },
  { id: "ms_enclbl", label: "Enclosure Labeling", type: "process" },
  { id: "ms_packscan", label: "Packing Scanning", type: "process" },
  { id: "ms_oqc", label: "OQC", type: "vi" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const nodeColors: Record<NodeType, string> = {
  start:      "var(--nav)",
  end:        "var(--muted)",
  process:    "var(--info)",
  decision:   "var(--warn)",
  vi:         "#6366f1",
  ok:         "var(--ok)",
  ng:         "var(--danger)",
  store:      "var(--accent)",
};

const nodeBgColors: Record<NodeType, string> = {
  start:      "rgba(99,102,241,0.15)",
  end:        "rgba(107,114,128,0.15)",
  process:    "rgba(59,130,246,0.12)",
  decision:   "rgba(245,158,11,0.12)",
  vi:         "rgba(99,102,241,0.12)",
  ok:         "rgba(34,197,94,0.12)",
  ng:         "rgba(239,68,68,0.12)",
  store:      "rgba(20,184,166,0.12)",
};

function FlowCard({ node }: { node: FlowNode }) {
  const borderColor = nodeColors[node.type];
  const bgColor = nodeBgColors[node.type];
  const isDecision = node.type === "decision";
  const isStart = node.type === "start";
  const isOk = node.type === "ok";
  const isNg = node.type === "ng";
  const isVi = node.type === "vi";

  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: isDecision ? "6px 14px" : "7px 14px",
      borderRadius: isDecision ? 20 : 8,
      border: `2px solid ${borderColor}`,
      background: bgColor,
      minWidth: 120,
      maxWidth: 200,
      justifyContent: "center",
      flexShrink: 0,
    }}>
      {isOk && <CheckCircle size={13} style={{ color: "var(--ok)", flexShrink: 0 }} />}
      {isNg && <XCircle size={13} style={{ color: "var(--danger)", flexShrink: 0 }} />}
      {isVi && <Eye size={13} style={{ color: "#6366f1", flexShrink: 0 }} />}
      {isDecision && <GitBranch size={12} style={{ color: "var(--warn)", flexShrink: 0 }} />}
      <span style={{
        fontSize: 12,
        fontWeight: isStart || isOk || isNg ? 600 : 400,
        color: isOk ? "var(--ok)" : isNg ? "var(--danger)" : "var(--text)",
        whiteSpace: "nowrap",
      }}>
        {node.label}
      </span>
    </div>
  );
}

function Arrow({ label, type }: { label?: string; type?: "ok" | "ng" | "normal" }) {
  const color = type === "ng" ? "var(--danger)" : type === "ok" ? "var(--ok)" : "var(--muted)";
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 2,
      flexShrink: 0,
      width: 50,
    }}>
      <ArrowRight size={14} style={{ color }} />
      {label && (
        <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</span>
      )}
    </div>
  );
}

function FlowRow({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  // Render as a horizontal flow
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 4,
      padding: "4px 0",
    }}>
      {nodes.map((node, i) => (
        <div key={node.id} style={{ display: "flex", alignItems: "center" }}>
          <FlowCard node={node} />
          {i < nodes.length - 1 && (
            <Arrow
              label={edges[i]?.label}
              type={edges[i]?.type}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// Group nodes into rows (max 8 per row)
function FlowSection({ title, nodes, description }: {
  title: string;
  nodes: FlowNode[];
  description?: string;
}) {
  const ROW_SIZE = 7;
  const rows: FlowNode[][] = [];
  for (let i = 0; i < nodes.length; i += ROW_SIZE) {
    rows.push(nodes.slice(i, i + ROW_SIZE));
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 4,
          height: 20,
          borderRadius: 2,
          background: "var(--info)",
        }} />
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{title}</h3>
        {description && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{description}</span>
        )}
      </div>
      <div style={{
        background: "var(--surface)",
        borderRadius: 10,
        padding: "12px 16px",
        border: "1px solid var(--border)",
      }}>
        {rows.map((row, ri) => (
          <FlowRow
            key={ri}
            nodes={row}
            edges={[]}
          />
        ))}
      </div>
    </div>
  );
}

// ── Sub-components: PO流程 + 时效管控 summary ─────────────────────────────

function SectionHeader({ icon: Icon, title, sub, badge }: {
  icon: typeof Cpu;
  title: string;
  sub: string;
  badge?: string;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 16,
    }}>
      <div style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        background: "rgba(59,130,246,0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <Icon size={17} style={{ color: "var(--info)" }} />
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
          {badge && (
            <span style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 10,
              background: "rgba(59,130,246,0.15)",
              color: "var(--info)",
              fontWeight: 600,
            }}>{badge}</span>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>{sub}</p>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

type Tab = "smt" | "po" | "stations";

export function ProcessManagement({ locale }: { locale: Locale }) {
  const [tab, setTab] = useState<Tab>("smt");

  const tabs: { key: Tab; label: string }[] = [
    { key: "smt",      label: t("mes.process.smtFlow", locale) },
    { key: "po",       label: t("mes.process.poFlow", locale) },
    { key: "stations",  label: t("mes.process.mesStations", locale) },
  ];

  // SMT段分组
  const smtRows = [
    {
      title: t("mes.process.smtSection1", locale), // 来料入库
      desc: "Vendor → IQC → 备料",
      nodes: SMT_FLOW_NODES.filter(n => ["vendor","receiving","storage","iqc","matprep"].includes(n.id)),
    },
    {
      title: t("mes.process.smtSection2", locale), // SMT贴装
      desc: "贴片 → 回流焊",
      nodes: SMT_FLOW_NODES.filter(n => ["lasermark","autosmt","redglue","placement","reflow","smtaoi","vi1","pcbaload"].includes(n.id)),
    },
    {
      title: t("mes.process.smtSection3", locale), // 异形件/波峰焊
      desc: "AI插件 → 波峰焊 → WS-AOI",
      nodes: SMT_FLOW_NODES.filter(n => ["oddform","disp1","inserta","inserths1","inserths2","vi2","wave","height","wsaoi"].includes(n.id)),
    },
    {
      title: t("mes.process.smtSection4", locale), // ICT / FCT
      desc: "ICT → FCT → 点胶固化 → 分板",
      nodes: SMT_FLOW_NODES.filter(n => ["ict","fct","disp2","cure","depanel"].includes(n.id)),
    },
    {
      title: t("mes.process.smtSection5", locale), // 线缆/组装
      desc: "MOS成型 → 螺钉 → AC/DC线缆",
      nodes: SMT_FLOW_NODES.filter(n => ["mosform","screw","accable","acsolder","dccable","dcsolder","viccd","lasereng"].includes(n.id)),
    },
    {
      title: t("mes.process.smtSection6", locale), //ATE测试
      desc: "ATE1 → 老化 → Hi-pot → ATE2",
      nodes: SMT_FLOW_NODES.filter(n => ["ate1","ultrasonic","vi3","biloading","burnin","psudl","steth","hipot","ate2"].includes(n.id)),
    },
    {
      title: t("mes.process.smtSection7", locale), // 包装入库
      desc: "标签 → 扫描 → 封箱 → OQC → 成品入库",
      nodes: SMT_FLOW_NODES.filter(n => ["enclabel","accablelbl","vi4","packscan","pebag","boxseal","autopack","oqc"].includes(n.id)),
    },
  ];

  // NG处理行
  const ngNodes = SMT_FLOW_NODES.filter(n =>
    ["ng1","ok1","repair1","scrap1","ng2","ok2","touchup","ng3","ok3","repair2","scrap2",
     "ng4","ok4","repair3","scrap3","ng5","ok5","repair4","scrap4","ng5","ok11","rework"].includes(n.id)
  );

  // PO flow rows
  const poRows = [
    {
      title: "销售订单接入",
      desc: "客户PO → MRP → 工单创建",
      nodes: PO_FLOW_NODES.filter(n => ["po_start","erp_mrp","erp_wo","po_wait","erp_po"].includes(n.id)),
    },
    {
      title: "采购与来料",
      desc: "供应商送货 → IQC → 入库",
      nodes: PO_FLOW_NODES.filter(n => ["supplier","doc_verify","iqc_task","iqc_insp","iqc_ok","iqc_ng","special","return"].includes(n.id)),
    },
    {
      title: "生产执行",
      desc: "发料 → 上线 → 报工 → 包装",
      nodes: PO_FLOW_NODES.filter(n => ["issue","online","production","pack_bind"].includes(n.id)),
    },
    {
      title: "出货判定",
      desc: "OQC → 判定 → 工单关闭 → 入库",
      nodes: PO_FLOW_NODES.filter(n => ["oqc_insp","oqc_judge","wo_close","fg_store","rework_flow","scrap_flow"].includes(n.id)),
    },
  ];

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <SectionHeader
          icon={Layers}
          title={t("mes.process.title", locale)}
          sub={t("mes.process.subtitle", locale)}
          badge="MES流程"
        />

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tabs.map((t_) => (
            <button
              key={t_.key}
              type="button"
              className={`action-button ${tab === t_.key ? "active" : ""}`}
              style={{
                background: tab === t_.key ? "var(--info)" : "var(--nav)",
              }}
              onClick={() => setTab(t_.key)}
            >
              {t_.label}
            </button>
          ))}
        </div>
      </div>

      {/* SMT全流程 */}
      {tab === "smt" && (
        <div className="surface-panel">
          {smtRows.map((row) => (
            <FlowSection
              key={row.title}
              title={row.title}
              description={row.desc}
              nodes={row.nodes}
            />
          ))}

          {/* NG处理汇总 */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 4, height: 20, borderRadius: 2, background: "var(--danger)" }} />
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                {t("mes.process.ngHandling", locale)}
              </h3>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                VI / AOI / ICT / FCT FAIL → Repair / Scrap
              </span>
            </div>
            <div style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              background: "rgba(239,68,68,0.05)",
              borderRadius: 10,
              padding: "12px 16px",
              border: "1px solid rgba(239,68,68,0.2)",
            }}>
              <span style={{ fontSize: 11, color: "var(--danger)", fontWeight: 600 }}>
                FAIL路径:
              </span>
              {["SMT-AOI NG → Repair → 重新过站", "WS-AOI NG → Repair → 重新过站", "ICT NG → 2次复测 → Fail → 维修", "FCT NG → 2次复测 → Fail → 维修", "OQC NG → Rework → 重新OQC"].map((path) => (
                <span key={path} style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: "rgba(239,68,68,0.1)",
                  color: "var(--danger)",
                  whiteSpace: "nowrap",
                }}>
                  {path}
                </span>
              ))}
            </div>
          </div>

          {/* 关键规则提示 */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
            marginTop: 8,
          }}>
            {[
              { icon: "⏱", text: "PCB开封→插件: ≤168H，否则烘烤2H", color: "var(--warn)" },
              { icon: "⏱", text: "白胶固化: ≥4H", color: "var(--warn)" },
              { icon: "📦", text: "OQC检验绑定成品SN与工单", color: "var(--info)" },
              { icon: "🔗", text: "物料Date code与工单绑定上线", color: "var(--info)" },
            ].map((tip) => (
              <div key={tip.text} style={{
                display: "flex",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                fontSize: 12,
                alignItems: "flex-start",
              }}>
                <span style={{ fontSize: 14 }}>{tip.icon}</span>
                <span style={{ color: "var(--text)" }}>{tip.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PO流程 */}
      {tab === "po" && (
        <div className="surface-panel">
          {poRows.map((row) => (
            <FlowSection
              key={row.title}
              title={row.title}
              description={row.desc}
              nodes={row.nodes}
            />
          ))}

          {/* 关键说明 */}
          <div style={{
            padding: "12px 16px",
            background: "rgba(59,130,246,0.06)",
            borderRadius: 10,
            border: "1px solid rgba(59,130,246,0.2)",
            fontSize: 12,
            lineHeight: 1.8,
            color: "var(--text)",
          }}>
            <strong style={{ color: "var(--info)" }}>关键规则：</strong>
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
              <li>工单与客户PO关联创建（ERP）</li>
              <li>物料Date code与工单绑定发放（MES）</li>
              <li>电子料上线PDA扫码确认（MES）</li>
              <li>成品SN绑定工单（MES包装工站）</li>
              <li>特采物料需记录原因并单独追踪</li>
              <li>OQC判定Pass → 工单关闭 → 成品入库</li>
            </ul>
          </div>
        </div>
      )}

      {/* MES岗位 */}
      {tab === "stations" && (
        <div className="surface-panel">
          <SectionHeader
            icon={Cpu}
            title={t("mes.process.stationSequence", locale)}
            sub="MES岗位 · 各工站过站序列（OK判定通过下一站，FAIL进入复测流程）"
          />

          {/* 工站流程表 */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--nav)" }}>
                  {[
                    t("common.sequence", locale),
                    "工站",
                    "类型",
                    t("mes.process.passResult", locale),
                    t("mes.process.failResult", locale),
                    t("mes.process.keyPoint", locale),
                  ].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MES_STATION_NODES.map((node, i) => {
                  const passMap: Record<string, string> = {
                    ms_pcblaser: "AI1",
                    ms_ai1: "AI2",
                    ms_ai2: "贴片1",
                    ms_mt1: "贴片2",
                    ms_mt2: "SMT-AOI",
                    ms_smti: "PCBA上料",
                    ms_pcba: "WS-AOI",
                    ms_wsi: "ICT",
                    ms_ict: "FCT",
                    ms_fct: "分板",
                    ms_div: "PCBA Link",
                    ms_link: "ATE1",
                    ms_ate1: "Ultrasonic",
                    ms_ultra: "外观/限高",
                    ms_vis: "BI Loading",
                    ms_bi: "Hi-pot",
                    ms_hp: "ATE2",
                    ms_ate2: "Enclosure Labeling",
                    ms_enclbl: "Packing Scanning",
                    ms_packscan: "OQC",
                    ms_oqc: "完成",
                  };
                  const failMap: Record<string, string> = {
                    ms_smti: "返工 → 贴片1",
                    ms_wsi: "返工 → PCBA上料",
                    ms_ict: "2次复测 → 维修",
                    ms_fct: "2次复测 → 维修",
                    ms_vis: "返工",
                    ms_bi: "隔离复检",
                    ms_hp: "隔离复检",
                    ms_ate2: "返工",
                    ms_oqc: "返工 → 重新OQC",
                  };
                  const keyPoints: Record<string, string> = {
                    ms_pcblaser: "PCB身份绑定起点",
                    ms_smti: "SMT良率判定",
                    ms_pcba: "PCBA段开始",
                    ms_wsi: "波峰焊后检验",
                    ms_ict: "ICT测试",
                    ms_fct: "FCT功能测试",
                    ms_vis: "外观/限高检验",
                    ms_bi: "老化48H(条件触发)",
                    ms_hp: "耐压安全测试",
                    ms_oqc: "最终出货检验",
                  };
                  const nodeTypeLabel: Record<string, string> = {
                    process: "工序",
                    vi: "外观检查",
                    ok: "判定OK",
                    ng: "判定NG",
                  };
                  return (
                    <tr key={node.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={tdStyle}>{i + 1}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{node.label}</td>
                      <td style={tdStyle}>
                        <span style={{
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 8,
                          background: node.type === "vi"
                            ? "rgba(99,102,241,0.15)"
                            : "rgba(59,130,246,0.12)",
                          color: node.type === "vi" ? "#6366f1" : "var(--info)",
                        }}>
                          {nodeTypeLabel[node.type]}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: "var(--ok)" }}>{passMap[node.id] ?? "—"}</td>
                      <td style={{ ...tdStyle, color: "var(--danger)" }}>{failMap[node.id] ?? "—"}</td>
                      <td style={{ ...tdStyle, color: "var(--muted)", fontSize: 11 }}>
                        {keyPoints[node.id] ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--muted)",
  borderBottom: "1px solid var(--border)",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 12,
  color: "var(--text)",
};
