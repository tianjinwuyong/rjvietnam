import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box, ArrowRight, RefreshCw,
  AlertTriangle, CheckCircle, Clock,
  Bot, Activity, Gauge,
  Factory, Users, Wallet, Briefcase, LayoutDashboard,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

/* ── Types ──────────────────────────────────────────────────────── */

interface ManagerState {
  lastCycle?: string;
  summary?: string;
  alertCount?: number;
  execCount?: number;
  error?: string;
  cycleCount?: number;
  modelUsed?: string;
  [k: string]: unknown;
}

type WorkflowData = Record<string, ManagerState | Record<string, unknown>>;

interface BusMsg {
  source_agent: string;
  target_agent: string;
  subject: string;
  created_at: string;
}

/* ── Manager definitions ─────────────────────────────────────────── */

interface ManagerDef {
  id: string;
  labelKey: string;
  icon: typeof Bot;
  color: string;
  x: number;
  y: number;
}

interface MsgEdge {
  from: string;
  to: string;
  label: string;
}

const MANAGER_DEFS: ManagerDef[] = [
  { id: "wms",        labelKey: "workflow.manager.wms",       icon: Box,          color: "#3b82f6", x: 60,  y: 60 },
  { id: "mes",        labelKey: "workflow.manager.mes",       icon: Factory,      color: "#f59e0b", x: 280, y: 60 },
  { id: "bom",        labelKey: "workflow.manager.bom",       icon: AlertTriangle,color: "#8b5cf6", x: 500, y: 60 },
  { id: "pmc",        labelKey: "workflow.manager.pmc",       icon: Clock,        color: "#06b6d4", x: 60,  y: 240 },
  { id: "plant",      labelKey: "workflow.manager.plant",     icon: LayoutDashboard,color: "#22c55e", x: 280, y: 240 },
  { id: "hr",         labelKey: "workflow.manager.hr",        icon: Users,        color: "#ec4899", x: 500, y: 240 },
  { id: "finance",    labelKey: "workflow.manager.finance",   icon: Wallet,       color: "#14b8a6", x: 160, y: 420 },
  { id: "procurement",labelKey: "workflow.manager.procurement",icon: Briefcase,   color: "#f97316", x: 400, y: 420 },
];

const MSG_EDGES: MsgEdge[] = [
  // WMS ↔ MES (material loading core)
  { from: "mes",  to: "wms", label: "material_requested" },
  { from: "wms",  to: "mes", label: "material_received / iqc / issued" },
  // BOM ↔ MES
  { from: "mes",  to: "bom", label: "component_failure" },
  { from: "bom",  to: "mes", label: "bom_updated / bom_alert" },
  // BOM → WMS (stock alert)
  { from: "bom",  to: "wms", label: "stock_alert" },
  // Plant orchestrates all
  { from: "plant", to: "mes", label: "orchestrate" },
  { from: "plant", to: "wms", label: "orchestrate" },
  { from: "plant", to: "bom", label: "orchestrate" },
  { from: "plant", to: "pmc", label: "orchestrate" },
  { from: "plant", to: "hr",  label: "orchestrate" },
  { from: "plant", to: "finance", label: "orchestrate" },
  { from: "plant", to: "procurement", label: "orchestrate" },
  // HR ↔ MES
  { from: "mes",  to: "hr",  label: "line_understaffed" },
  { from: "hr",   to: "mes", label: "operators_assigned" },
  // Finance → Plant
  { from: "finance", to: "plant", label: "financial_report" },
];

const STATE_KEY_MAP: Record<string, string> = {
  state: "wms", bom: "bom", hr: "hr", pmc: "pmc",
  finance: "finance", procurement: "procurement", plant: "plant",
};

/* Agent ID normalization (DB may store "mes-ai", we want "mes") */
const AGENT_ID_MAP: Record<string, string> = {
  "mes-ai": "mes", "wms-ai": "wms", "bom-ai": "bom",
  "pmc-ai": "pmc", "hr-ai": "hr", "finance-ai": "finance",
  "plant-ai": "plant", "procurement-ai": "procurement",
};

function normalizeAgent(id: string): string {
  return AGENT_ID_MAP[id] ?? id.replace("-ai", "");
}

/* ── Helpers ────────────────────────────────────────────────────── */

function timeAgo(iso: string | undefined, locale: Locale): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return t("workflow.time.justNow", locale);
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}${t("workflow.time.minutesAgo", locale)}`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}${t("workflow.time.hoursAgo", locale)}`;
  return `${Math.floor(ms / 86_400_000)}${t("workflow.time.daysAgo", locale)}`;
}

/* ── SVG Arrow (dual-state) ─────────────────────────────────────── */

function SvgArrow({ x1, y1, x2, y2, label, active }: {
  x1: number; y1: number; x2: number; y2: number;
  label: string; active: boolean;
}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;
  const shrink = 30 / len;
  const sx = x1 + dx * shrink, sy = y1 + dy * shrink;
  const ex = x2 - dx * shrink, ey = y2 - dy * shrink;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const labOffX = -(dy / len) * 14, labOffY = (dx / len) * 14;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  return (
    <g>
      {/* Active state: wider red line with glow */}
      {active && (
        <>
          {/* Glow */}
          <line x1={sx} y1={sy} x2={ex} y2={ey}
            stroke="#ef4444" strokeWidth={6} opacity={0.15}
            className="comms-glow" />
          {/* Main line */}
          <line x1={sx} y1={sy} x2={ex} y2={ey}
            stroke="#ef4444" strokeWidth={3}
            markerEnd="url(#arr-red)" />
          {/* Pulse overlay */}
          <line x1={sx} y1={sy} x2={ex} y2={ey}
            stroke="#ef4444" strokeWidth={3} opacity={0.6}
            strokeDasharray="8 12"
            className="comms-pulse" />
        </>
      )}
      {/* Idle state: gray dashed */}
      {!active && (
        <line x1={sx} y1={sy} x2={ex} y2={ey}
          stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4"
          markerEnd="url(#arr-gray)" />
      )}
      {label && (
        <text x={mx + labOffX} y={my + labOffY} textAnchor="middle"
          fill={active ? "#ef4444" : "#64748b"} fontSize={9}
          fontWeight={active ? 600 : 400}
          transform={`rotate(${angle}, ${mx}, ${my})`}>
          {label}
        </text>
      )}
      {/* Active subject label near arrow head */}
      {active && (
        <text x={ex - dx * 0.15} y={ey - dy * 0.15 + (Math.abs(dx) > Math.abs(dy) ? -12 : 12)}
          textAnchor="middle" fill="#ef4444" fontSize={8}
          className="comms-subject">
          ●
        </text>
      )}
    </g>
  );
}

/* ── Manager Node ───────────────────────────────────────────────── */

function ManagerNode({ def, state, isAlive, hasError, locale }: {
  def: ManagerDef; state: ManagerState | null;
  isAlive: boolean; hasError: boolean; locale: Locale;
}) {
  const Icon = def.icon;
  const alertCount = (state?.alertCount ?? 0) as number;
  const lastRun = state?.lastCycle as string | undefined;
  const cycleCount = (state?.cycleCount ?? 0) as number;
  const execCount = (state?.execCount ?? 0) as number;
  const summary = state?.summary as string | undefined;
  const nodeW = 150, nodeH = 110;

  return (
    <g>
      {isAlive && (
        <rect x={def.x - 3} y={def.y - 3} width={nodeW + 6} height={nodeH + 6}
          rx={12} fill="none" stroke="#22c55e" strokeWidth={2} className="glow-pulse" />
      )}
      <rect x={def.x} y={def.y} width={nodeW} height={nodeH} rx={10}
        fill={hasError ? "#fef2f2" : isAlive ? "#f0fdf4" : "#fff"}
        stroke={hasError ? "#fecaca" : isAlive ? "#86efac" : "#e5e7eb"}
        strokeWidth={1.5} />
      {isAlive && (
        <svg x={def.x + 10} y={def.y + nodeH - 14} width={nodeW - 20} height={12}
          viewBox="0 0 130 12">
          <polyline
            points="0,6 8,6 12,1 16,11 20,6 28,6 32,1 36,11 40,6 48,6 52,1 56,11 60,6 68,6 72,1 76,11 80,6 88,6 92,1 96,11 100,6 108,6 112,1 116,11 120,6 130,6"
            fill="none" stroke="#22c55e" strokeWidth="1.2"
            className="heartbeat-path2" />
        </svg>
      )}
      <foreignObject x={def.x + 4} y={def.y + 4} width={nodeW - 8} height={nodeH - 28}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: 0, height: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ position: "relative" }}>
              <Icon size={16} color={hasError ? "#ef4444" : def.color} />
              {isAlive && <span className="pulse-dot2" style={{
                position: "absolute", top: -3, right: -4, width: 6, height: 6,
                borderRadius: "50%", background: "#22c55e", border: "1px solid #fff",
              }} />}
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{t(def.labelKey, locale)}</span>
          </div>
          <div style={{ fontSize: 11, color: "#64748b", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span>⏱ {timeAgo(lastRun, locale)}</span>
            {cycleCount > 0 && <span>#{cycleCount}</span>}
            {alertCount > 0 && <span style={{ color: "#ef4444" }}>⚠{alertCount}</span>}
            {execCount > 0 && <span>✓{execCount}</span>}
          </div>
          {summary ? (
            <div style={{ fontSize: 10, color: "#475569", lineHeight: 1.3,
              overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" as const }}>
              {summary}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: "#94a3b8" }}>
              {hasError ? t("workflow.status.error", locale) : !lastRun ? t("workflow.status.waiting", locale) : t("workflow.status.normal", locale)}
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  );
}

/* ── Live Activity Strip ────────────────────────────────────────── */

function ActivityStrip({ messages }: { messages: BusMsg[] }) {
  if (!messages.length) return null;
  const recent = messages.slice(0, 8);
  return (
    <div style={{
      background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca",
      padding: "8px 12px", marginBottom: 16, fontSize: 12,
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    }}>
      <span style={{ color: "#ef4444", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
        <span className="pulse-dot2" style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
        LIVE
      </span>
      {recent.map((m, i) => (
        <span key={i} style={{
          background: "#fff", borderRadius: 4, padding: "2px 8px",
          border: "1px solid #fca5a5", color: "#991b1b", whiteSpace: "nowrap",
        }}>
          {normalizeAgent(m.source_agent)} → {normalizeAgent(m.target_agent)}:
          <span style={{ color: "#dc2626" }}> {m.subject}</span>
        </span>
      ))}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────── */

export function WorkflowDashboard({ locale }: { locale: Locale }) {
  const [managers, setManagers] = useState<WorkflowData | null>(null);
  const [busMessages, setBusMessages] = useState<BusMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const activeRef = useRef<Set<string>>(new Set());

  /* Fetch manager state */
  const fetchManagers = useCallback(async () => {
    try {
      const mRes = await fetch("/api/workflow/status").then(r => r.ok ? r.json() : {});
      setManagers(mRes);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  /* Poll bus activity every 5s */
  const fetchBus = useCallback(async () => {
    try {
      const res = await fetch("/api/workflow/bus-recent").then(r => r.ok ? r.json() : { items: [] });
      const msgs: BusMsg[] = res.items ?? [];
      setBusMessages(msgs);

      /* Compute active edges: source→target pairs seen in last 30s */
      const now = Date.now();
      const active = new Set<string>();
      for (const m of msgs) {
        const t = new Date(m.created_at).getTime();
        if (now - t < 30_000) {
          const src = normalizeAgent(m.source_agent);
          const tgt = normalizeAgent(m.target_agent);
          active.add(`${src}→${tgt}`);
        }
      }
      activeRef.current = active;
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchManagers(); }, [fetchManagers]);
  useEffect(() => {
    fetchBus();
    const id = setInterval(fetchBus, 5000);
    return () => clearInterval(id);
  }, [fetchBus]);

  const svgW = 700, svgH = 540;
  const activeEdges = activeRef.current;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 960, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>🤖 {t("workflow.title", locale)}</h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
            {t("workflow.subtitle", locale)}
          </p>
        </div>
        <button onClick={fetchManagers} disabled={loading} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
          borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff",
          cursor: "pointer", fontSize: 13, color: "#374151",
        }}>
          <RefreshCw size={14} className={loading ? "spin" : ""} />
          {t("workflow.refresh", locale)}
        </button>
      </div>

      {/* Live activity strip */}
      <ActivityStrip messages={busMessages} />

      {/* Patrol Flow Graph */}
      <div style={{
        background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0",
        padding: 16, marginBottom: 24, overflow: "auto",
      }}>
        <svg width={svgW} height={svgH} style={{ display: "block" }}>
          <defs>
            <marker id="arr-gray" viewBox="0 0 10 10" refX={8} refY={5}
              markerWidth={7} markerHeight={7} orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="#94a3b8" />
            </marker>
            <marker id="arr-red" viewBox="0 0 10 10" refX={8} refY={5}
              markerWidth={8} markerHeight={8} orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="#ef4444" />
            </marker>
          </defs>

          {/* Edges */}
          {MSG_EDGES.map((e, i) => {
            const f = MANAGER_DEFS.find(d => d.id === e.from);
            const t = MANAGER_DEFS.find(d => d.id === e.to);
            if (!f || !t) return null;
            const active = activeEdges.has(`${e.from}→${e.to}`);
            return (
              <SvgArrow key={i}
                x1={f.x + 75} y1={f.y + 55}
                x2={t.x + 75} y2={t.y + 55}
                label={e.label} active={active} />
            );
          })}

          {/* Nodes */}
          {MANAGER_DEFS.map(def => {
            const stateKey = Object.entries(STATE_KEY_MAP).find(([_, v]) => v === def.id)?.[0] ?? def.id;
            const st = managers?.[stateKey] as ManagerState | undefined;
            const hasError = !!st?.error;
            const lastRun = st?.lastCycle as string | undefined;
            const isAlive = !hasError && !!lastRun && (Date.now() - new Date(lastRun).getTime()) < 3_600_000;
            return (
              <ManagerNode key={def.id} def={def} state={st ?? null}
                isAlive={isAlive} hasError={hasError} locale={locale} />
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 12, color: "#64748b", marginBottom: 24 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span className="pulse-dot2" style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} /> {t("workflow.status.online", locale)}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#94a3b8", display: "inline-block" }} /> {t("workflow.status.offline", locale)}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} /> {t("workflow.status.error", locale)}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={24} height={10}>
            <line x1={0} y1={5} x2={20} y2={5} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" />
            <polygon points="18,2 24,5 18,8" fill="#94a3b8" />
          </svg>
          {t("workflow.messages", locale)}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <svg width={24} height={10}>
            <line x1={0} y1={5} x2={20} y2={5} stroke="#ef4444" strokeWidth={3} />
            <polygon points="18,2 24,5 18,8" fill="#ef4444" />
          </svg>
          {t("workflow.realtimeComm", locale)}
        </span>
      </div>

      {/* Live detail table */}
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
          <Activity size={16} /> {t("workflow.patrolDetail", locale)} {busMessages.length > 0 && <span style={{ fontSize: 11, color: "#ef4444" }}>({busMessages.length} {t("workflow.recentMessages", locale)})</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#64748b" }}>
                <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>Manager</th>
                <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>{t("workflow.table.status", locale)}</th>
                <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>{t("workflow.table.lastPatrol", locale)}</th>
                <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>{t("workflow.table.cycle", locale)}</th>
                <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>{t("workflow.table.alertExec", locale)}</th>
                <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>{t("workflow.table.model", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {MANAGER_DEFS.map(def => {
                const stateKey = Object.entries(STATE_KEY_MAP).find(([_, v]) => v === def.id)?.[0] ?? def.id;
                const st = managers?.[stateKey] as ManagerState | undefined;
                const hasError = !!st?.error;
                const lastRun = st?.lastCycle as string | undefined;
                const isAlive = !hasError && !!lastRun && (Date.now() - new Date(lastRun).getTime()) < 3_600_000;
                const alertCount = (st?.alertCount ?? 0) as number;
                const execCount = (st?.execCount ?? 0) as number;
                const cycleCount = (st?.cycleCount ?? 0) as number;
                const model = st?.modelUsed as string | undefined;
                return (
                  <tr key={def.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                      <def.icon size={14} color={def.color} /> {t(def.labelKey, locale)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {hasError ? <span style={{ color: "#ef4444" }}>{t("workflow.status.error", locale)}</span>
                        : isAlive ? <span style={{ color: "#16a34a", display: "flex", alignItems: "center", gap: 4 }}>
                          <span className="pulse-dot2" style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} /> {t("workflow.status.online", locale)}
                        </span>
                        : <span style={{ color: "#94a3b8" }}>{t("workflow.status.offline", locale)}</span>}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#475569" }}>{timeAgo(lastRun, locale)}</td>
                    <td style={{ padding: "10px 12px", color: "#475569" }}>{cycleCount > 0 ? `${cycleCount}${t("workflow.cycles", locale)}` : "—"}</td>
                    <td style={{ padding: "10px 12px", color: "#475569" }}>
                      {alertCount > 0 ? <span style={{ color: "#ef4444" }}>⚠{alertCount}</span> : "—"}
                      {execCount > 0 ? ` ✓${execCount}` : ""}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#64748b", fontSize: 11 }}>
                      {model?.split("/").pop() ?? "Ornith"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .spin { animation: spin 1s linear infinite }

        @keyframes pulse-dot2 {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
        .pulse-dot2 { animation: pulse-dot2 1.8s ease-in-out infinite; }

        @keyframes glow-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .glow-pulse { animation: glow-pulse 2s ease-in-out infinite; }

        @keyframes hb-dash {
          0% { stroke-dashoffset: 260; }
          60% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: 0; }
        }
        .heartbeat-path2 {
          stroke-dasharray: 260;
          animation: hb-dash 2.2s ease-in-out infinite;
        }

        @keyframes comms-pulse {
          0% { stroke-dashoffset: 20; opacity: 0.8; }
          100% { stroke-dashoffset: -60; opacity: 0.2; }
        }
        .comms-pulse {
          animation: comms-pulse 1.2s linear infinite;
        }
        .comms-glow {
          animation: glow-pulse 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
