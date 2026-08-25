import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw, Activity, ArrowRight, AlertCircle, CheckCircle,
  Clock, Zap, Send, Filter, TrendingUp, BarChart2, MessageSquare,
  Database, Radio,
} from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

// ── Types ────────────────────────────────────────────────────────────────────

interface BusNode {
  id: string;
  label: string;
  domain: string;
  color: string;
  isHub?: boolean;
}

interface BusEdge {
  from: string;
  to: string;
  subject: string;
  label: string;
  type: "event" | "request" | "broadcast";
}

interface BusStats {
  stats: { pending: number; processing: number; completed: number; failed: number; dead: number; total: number };
  byAgent: Record<string, number>;
  recentMessages: BusMessage[];
}

interface BusMessage {
  message_id: string;
  source_agent: string;
  target_agent: string;
  message_type: string;
  subject: string;
  payload: unknown;
  priority: string;
  status: string;
  created_at: string;
  processed_at: string | null;
  error_message: string | null;
}

interface Props {
  locale: Locale;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, typeof CheckCircle> = {
  completed: CheckCircle,
  pending:   Clock,
  processing:Zap,
  failed:    AlertCircle,
  dead:      AlertCircle,
};

const STATUS_COLOR: Record<string, string> = {
  completed: "#22c55e",
  pending:   "#f59e0b",
  processing:"#3b82f6",
  failed:    "#ef4444",
  dead:      "#6b7280",
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f97316",
  normal:   "#6b7280",
  low:      "#9ca3af",
};

const DOMAIN_COLORS: Record<string, string> = {
  mes: "#3b82f6", wms: "#22c55e", bom: "#f59e0b",
  hr: "#8b5cf6", rda: "#ef4444", agv: "#06b6d4",
  pmc: "#f97316", bus: "#6b7280",
};

const AGENT_LABELS: Record<string, Record<string, string>> = {
  "mes-ai": { "zh-CN": "MES AI",    "en-US": "MES AI",    "vi-VN": "MES AI" },
  "wms-ai": { "zh-CN": "WMS AI",    "en-US": "WMS AI",    "vi-VN": "WMS AI" },
  "bom-ai": { "zh-CN": "BOM AI",    "en-US": "BOM AI",    "vi-VN": "BOM AI" },
  "hr-ai":  { "zh-CN": "HR AI",     "en-US": "HR AI",     "vi-VN": "HR AI" },
  "rda-ai": { "zh-CN": "RDA AI",    "en-US": "RDA AI",    "vi-VN": "RDA AI" },
  "agv-ai": { "zh-CN": "AGV AI",    "en-US": "AGV AI",    "vi-VN": "AGV AI" },
  "pmc-ai": { "zh-CN": "PMC AI",    "en-US": "PMC AI",    "vi-VN": "PMC AI" },
  "bus":    { "zh-CN": "消息总线",   "en-US": "Message Bus","vi-VN": "Bus tin nhắn" },
};

function getAgentLabel(id: string, locale: Locale): string {
  return AGENT_LABELS[id]?.[locale] ?? id;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

// ── Topology Graph (SVG) ──────────────────────────────────────────────────────

interface TopologyGraphProps {
  nodes: BusNode[];
  edges: BusEdge[];
  locale: Locale;
  highlightedPath?: string; // e.g. "mes-ai→wms-ai"
}

function TopologyGraph({ nodes, edges, locale, highlightedPath }: TopologyGraphProps) {
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  // Simple circular layout
  const cx = 380, cy = 200, r = 150;
  const angleStep = (2 * Math.PI) / (nodes.length - 1); // exclude "bus" hub from circle
  const busNode = nodes.find(n => n.isHub)!;
  const agentNodes = nodes.filter(n => !n.isHub);

  const getPos = (id: string): { x: number; y: number } => {
    if (id === "bus") return { x: cx, y: cy };
    const idx = agentNodes.findIndex(n => n.id === id);
    if (idx < 0) return { x: cx, y: cy };
    const angle = idx * angleStep - Math.PI / 2;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  // Build a map of which edges are active (have messages in recent history)
  const activeEdges = new Set<string>();
  edges.forEach(e => activeEdges.add(`${e.from}→${e.to}`));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width="760" height="400" viewBox="0 0 760 400" style={{ display: "block", margin: "0 auto" }}>
        {/* Grid background */}
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.5"/>
          </pattern>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#6b7280"/>
          </marker>
          <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#3b82f6"/>
          </marker>
          <marker id="arrowhead-broadcast" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#8b5cf6"/>
          </marker>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <rect width="760" height="400" fill="var(--bg-2)" rx="8"/>
        <rect width="760" height="400" fill="url(#grid)" rx="8"/>

        {/* Edges */}
        {edges.map((edge, i) => {
          const from = getPos(edge.from);
          const to   = getPos(edge.to);
          const isHL = highlightedPath === `${edge.from}→${edge.to}`;
          const isHovered = hoveredEdge === `${edge.from}→${edge.to}`;
          const isBroadcast = edge.type === "broadcast";
          const isActive = activeEdges.has(`${edge.from}→${edge.to}`);

          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;

          let color = "#4b5563";
          let marker = "url(#arrowhead)";
          if (isBroadcast) { color = "#8b5cf6"; marker = "url(#arrowhead-broadcast)"; }
          else if (isActive) { color = "#3b82f6"; marker = "url(#arrowhead-active)"; }
          if (isHL || isHovered) color = "#f59e0b";

          const dash = isBroadcast ? "6,3" : isActive ? undefined : "4,4";

          return (
            <g key={i} style={{ cursor: "pointer" }}
               onMouseEnter={() => setHoveredEdge(`${edge.from}→${edge.to}`)}
               onMouseLeave={() => setHoveredEdge(null)}>
              {/* Wider invisible hit area */}
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke="transparent" strokeWidth="12"/>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke={color} strokeWidth={isHL || isHovered ? 2 : 1}
                strokeDasharray={dash}
                markerEnd={marker}
                opacity={isHovered ? 1 : 0.7}
                filter={isHL ? "url(#glow)" : undefined}/>
              {/* Label */}
              <foreignObject
                x={midX - 50} y={midY - 10}
                width="100" height="20"
                style={{ pointerEvents: "none" }}>
                <div style={{
                  textAlign: "center",
                  fontSize: 9,
                  color: isHovered || isHL ? color : "#9ca3af",
                  background: "var(--bg-2)",
                  borderRadius: 3,
                  padding: "1px 4px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {edge.label}
                </div>
              </foreignObject>
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map(node => {
          const { x, y } = getPos(node.id);
          const isHub = node.isHub;
          const radius = isHub ? 28 : 22;
          const color = node.color;

          return (
            <g key={node.id} style={{ cursor: "default" }}>
              {/* Outer ring */}
              <circle cx={x} cy={y} r={radius + 4}
                fill="none" stroke={color} strokeWidth="1.5"
                strokeDasharray={isHub ? "4,3" : undefined}
                opacity="0.4"/>
              {/* Glow for hub */}
              {isHub && (
                <circle cx={x} cy={y} r={radius + 8}
                  fill={color} opacity="0.1"
                  filter="url(#glow)"/>
              )}
              {/* Main circle */}
              <circle cx={x} cy={y} r={radius}
                fill={color + "22"}
                stroke={color}
                strokeWidth={isHub ? 2 : 1.5}/>
              {/* Icon or label */}
              {isHub ? (
                <>
                  <line x1={x-8} y1={y} x2={x+8} y2={y} stroke={color} strokeWidth="2"/>
                  <line x1={x} y1={y-8} x2={x} y2={y+8} stroke={color} strokeWidth="2"/>
                </>
              ) : (
                <text x={x} y={y + 4}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={700}
                  fill={color}>
                  {node.label}
                </text>
              )}
              {/* Name below */}
              <text x={x} y={y + radius + 14}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-2)"
                fontWeight={500}>
                {getAgentLabel(node.id, locale)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Message Feed ─────────────────────────────────────────────────────────────

interface MessageFeedProps {
  messages: BusMessage[];
  locale: Locale;
  onFilterChange: (filter: MessageFilter) => void;
  filter: MessageFilter;
}

interface MessageFilter {
  source: string;
  target: string;
  status: string;
}

function MessageFeed({ messages, locale, onFilterChange, filter }: MessageFeedProps) {
  const [localFilter, setLocalFilter] = useState(filter);

  const agents = ["mes-ai","wms-ai","bom-ai","hr-ai","rda-ai","agv-ai","pmc-ai","bus","*"];
  const statuses = ["","pending","processing","completed","failed"];

  const apply = () => onFilterChange(localFilter);

  return (
    <div>
      {/* Filter bar */}
      <div style={{
        display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap",
        alignItems: "center",
      }}>
        <Filter size={13} style={{ color: "var(--muted)" }}/>
        <select value={localFilter.source}
          onChange={e => setLocalFilter(f => ({ ...f, source: e.target.value }))}
          style={selectStyle}>
          <option value="">← {t("agents.bus.filter.source", locale)}</option>
          {agents.map(a => <option key={a} value={a}>{getAgentLabel(a, locale)}</option>)}
        </select>
        <ArrowRight size={12} style={{ color: "var(--muted)" }}/>
        <select value={localFilter.target}
          onChange={e => setLocalFilter(f => ({ ...f, target: e.target.value }))}
          style={selectStyle}>
          <option value="">→ {t("agents.bus.filter.target", locale)}</option>
          {agents.map(a => <option key={a} value={a}>{getAgentLabel(a, locale)}</option>)}
        </select>
        <select value={localFilter.status}
          onChange={e => setLocalFilter(f => ({ ...f, status: e.target.value }))}
          style={selectStyle}>
          <option value="">* {t("agents.bus.filter.status", locale)}</option>
          {statuses.map(s => <option key={s} value={s}>{s || "all"}</option>)}
        </select>
        <button onClick={apply} style={{ ...btnStyle, background: "var(--info)", color: "#fff", fontSize: 11, padding: "4px 10px" }}>
          {t("agents.bus.filter.apply", locale)}
        </button>
        <button onClick={() => { const f = { source:"",target:"",status:"" }; setLocalFilter(f); onFilterChange(f); }}
          style={{ ...btnStyle, fontSize: 11, padding: "4px 10px" }}>
          {t("agents.bus.filter.reset", locale)}
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--bg-2)" }}>
              {[
                t("agents.bus.col.time", locale),
                t("agents.bus.col.from", locale),
                "",
                t("agents.bus.col.to", locale),
                t("agents.bus.col.subject", locale),
                t("agents.bus.col.type", locale),
                t("agents.bus.col.priority", locale),
                t("agents.bus.col.status", locale),
                t("agents.bus.col.latency", locale),
              ].map((h, i) => (
                <th key={i} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {messages.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "24px", color: "var(--muted)" }}>
                  {t("agents.bus.noMessages", locale)}
                </td>
              </tr>
            ) : messages.map((msg, i) => {
              const StatusIcon = STATUS_ICON[msg.status] ?? Clock;
              const latency = msg.processed_at
                ? Math.round((new Date(msg.processed_at).getTime() - new Date(msg.created_at).getTime()) / 1000)
                : null;

              return (
                <tr key={msg.message_id} style={{
                  borderTop: "1px solid var(--border)",
                  background: i % 2 === 0 ? "transparent" : "var(--bg-2)",
                }}>
                  <td style={tdStyle}>
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>{timeAgo(msg.created_at)}</span>
                  </td>
                  <td style={{ ...tdStyle, color: DOMAIN_COLORS[msg.source_agent] ?? "var(--text)", fontWeight: 600, fontSize: 11 }}>
                    {getAgentLabel(msg.source_agent, locale)}
                  </td>
                  <td style={{ ...tdStyle, color: "var(--muted)", padding: "4px 2px" }}>
                    <ArrowRight size={10}/>
                  </td>
                  <td style={{ ...tdStyle, color: DOMAIN_COLORS[msg.target_agent] ?? "var(--text)", fontWeight: 600, fontSize: 11 }}>
                    {getAgentLabel(msg.target_agent, locale)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {msg.subject}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                      color: msg.message_type === "broadcast" ? "#8b5cf6"
                           : msg.message_type === "request" ? "#f59e0b"
                           : "#6b7280",
                    }}>
                      {msg.message_type}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: PRIORITY_COLOR[msg.priority] ?? "#6b7280", fontSize: 11, fontWeight: 600 }}>
                      {msg.priority}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <StatusIcon size={11} style={{ color: STATUS_COLOR[msg.status] ?? "#6b7280" }}/>
                      <span style={{ color: STATUS_COLOR[msg.status] ?? "#6b7280", fontSize: 11 }}>
                        {msg.status}
                      </span>
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {latency != null ? (
                      <span style={{ color: latency > 60 ? "#ef4444" : latency > 10 ? "#f59e0b" : "#22c55e", fontSize: 11, fontFamily: "monospace" }}>
                        {latency}s
                      </span>
                    ) : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Performance Panel ─────────────────────────────────────────────────────────

interface PerfPanelProps {
  stats: BusStats["stats"];
  byAgent: Record<string, number>;
  locale: Locale;
}

function PerfPanel({ stats, byAgent, locale }: PerfPanelProps) {
  const total = stats.total || 1;
  const agents = ["mes-ai","wms-ai","bom-ai","hr-ai","rda-ai","agv-ai","pmc-ai"];

  const agentStats = agents.map(id => {
    const count = byAgent[id] ?? 0;
    const pct = Math.round((count / total) * 100);
    return { id, count, pct, color: DOMAIN_COLORS[id] ?? "#6b7280" };
  }).sort((a, b) => b.count - a.count);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: t("agents.bus.kpi.total", locale),    value: stats.total,       color: "#3b82f6", icon: Database },
          { label: t("agents.bus.kpi.pending", locale),   value: stats.pending,     color: "#f59e0b", icon: Clock },
          { label: t("agents.bus.kpi.completed", locale), value: stats.completed,   color: "#22c55e", icon: CheckCircle },
          { label: t("agents.bus.kpi.failed", locale),   value: stats.failed,      color: "#ef4444", icon: AlertCircle },
        ].map(kpi => (
          <div key={kpi.label} style={{
            background: "var(--bg-2)", border: `1px solid var(--border)`,
            borderRadius: 8, padding: "12px 14px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{kpi.label}</span>
              <kpi.icon size={13} style={{ color: kpi.color }}/>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: kpi.color, lineHeight: 1 }}>
              {kpi.value}
            </div>
          </div>
        ))}
      </div>

      {/* Per-agent bar chart */}
      <div style={{
        background: "var(--bg-2)", border: "1px solid var(--border)",
        borderRadius: 8, padding: 12,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: "var(--text-2)" }}>
          {t("agents.bus.kpi.byAgent", locale)}
        </div>
        {agentStats.map(({ id, count, pct, color }) => (
          <div key={id} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>{getAgentLabel(id, locale)}</span>
              <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>{count} ({pct}%)</span>
            </div>
            <div style={{ background: "var(--border)", borderRadius: 3, height: 6, overflow: "hidden" }}>
              <div style={{
                width: `${pct}%`, height: "100%",
                background: color, borderRadius: 3,
                transition: "width 0.4s ease",
              }}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  background: "var(--bg-2)", border: "1px solid var(--border)",
  borderRadius: 6, padding: "4px 8px", fontSize: 12,
  color: "var(--text)", cursor: "pointer",
};

const btnStyle: React.CSSProperties = {
  background: "var(--bg-2)", border: "1px solid var(--border)",
  borderRadius: 6, padding: "4px 10px", fontSize: 12,
  color: "var(--text)", cursor: "pointer",
};

const thStyle: React.CSSProperties = {
  padding: "8px 10px", textAlign: "left" as const,
  fontSize: 11, fontWeight: 700, color: "var(--muted)",
  textTransform: "uppercase" as const, letterSpacing: "0.05em",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap" as const,
};

const tdStyle: React.CSSProperties = {
  padding: "7px 10px",
  color: "var(--text)",
  verticalAlign: "middle" as const,
};

// ── Main Component ────────────────────────────────────────────────────────────

export function AgentBusMonitor({ locale }: Props) {
  const [topology, setTopology]       = useState<{ nodes: BusNode[]; edges: BusEdge[] }>({ nodes: [], edges: [] });
  const [stats, setStats]             = useState<BusStats | null>(null);
  const [messages, setMessages]       = useState<BusMessage[]>([]);
  const [filter, setFilter]           = useState<MessageFilter>({ source: "", target: "", status: "" });
  const [loading, setLoading]         = useState(false);
  const [activePanel, setActivePanel] = useState<"topology" | "messages" | "performance">("topology");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTopology = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/topology");
      const json = await res.json();
      if (json.ok) setTopology(json.data);
    } catch { /* ignore */ }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/bus-stats");
      const json = await res.json();
      if (json.ok) {
        setStats(json.data);
        setMessages(json.data.recentMessages ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchMessages = useCallback(async (f: MessageFilter) => {
    try {
      const params = new URLSearchParams();
      if (f.source)  params.set("source", f.source);
      if (f.target)  params.set("target", f.target);
      if (f.status)  params.set("status", f.status);
      params.set("limit", "50");
      const res = await fetch(`/api/agents/messages?${params}`);
      const json = await res.json();
      if (json.ok) setMessages(json.data.items ?? []);
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchTopology(), fetchStats()]);
    setLoading(false);
  }, [fetchTopology, fetchStats]);

  // Initial load + auto-refresh
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(fetchStats, 8000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchStats]);

  const handleFilterChange = (f: MessageFilter) => {
    setFilter(f);
    setActivePanel("messages");
    fetchMessages(f);
  };

  const PANELS = [
    { key: "topology",    label: t("agents.bus.panel.topology",    locale), icon: Radio },
    { key: "messages",    label: t("agents.bus.panel.messages",    locale), icon: MessageSquare },
    { key: "performance", label: t("agents.bus.panel.performance", locale), icon: BarChart2 },
  ] as const;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {PANELS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setActivePanel(key); if (key === "messages" && messages.length === 0) fetchMessages(filter); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 14px", fontSize: 12, fontWeight: activePanel === key ? 700 : 400,
                background: activePanel === key ? "var(--info)" : "var(--bg-2)",
                color: activePanel === key ? "#fff" : "var(--text)",
                border: `1px solid ${activePanel === key ? "var(--info)" : "var(--border)"}`,
                borderRadius: 8, cursor: "pointer",
              }}
            >
              <Icon size={13}/>
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Live indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: autoRefresh ? "#22c55e" : "#6b7280",
              boxShadow: autoRefresh ? "0 0 6px #22c55e" : undefined,
              animation: autoRefresh ? "pulse 2s infinite" : undefined,
            }}/>
            <span style={{ color: autoRefresh ? "#22c55e" : "var(--muted)", fontWeight: 600 }}>
              {autoRefresh ? t("agents.bus.live", locale) : t("agents.bus.paused", locale)}
            </span>
          </div>
          <button
            onClick={() => setAutoRefresh(v => !v)}
            title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
            style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 4, padding: "4px 8px" }}
          >
            <Radio size={11}/> {autoRefresh ? "Pause" : "Resume"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            style={{ ...btnStyle, display: "flex", alignItems: "center", gap: 4 }}
          >
            <RefreshCw size={11} className={loading ? "spin" : ""}/>
            {t("agents.bus.refresh", locale)}
          </button>
        </div>
      </div>

      {/* Panel content */}
      {activePanel === "topology" && (
        <div>
          <div style={{ marginBottom: 8, fontSize: 11, color: "var(--muted)" }}>
            {t("agents.bus.topology.hint", locale)}
          </div>
          <TopologyGraph
            nodes={topology.nodes}
            edges={topology.edges}
            locale={locale}
          />
          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginTop: 12, justifyContent: "center", flexWrap: "wrap" }}>
            {[
              { color: "#3b82f6", label: t("agents.bus.legend.active", locale) },
              { color: "#8b5cf6", label: t("agents.bus.legend.broadcast", locale) },
              { color: "#4b5563", label: t("agents.bus.legend.inactive", locale) },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 20, height: 2, background: l.color, borderRadius: 2 }}/>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activePanel === "messages" && (
        <MessageFeed
          messages={messages}
          locale={locale}
          filter={filter}
          onFilterChange={handleFilterChange}
        />
      )}

      {activePanel === "performance" && stats && (
        <PerfPanel
          stats={stats.stats}
          byAgent={stats.byAgent}
          locale={locale}
        />
      )}

      {/* Global stats strip when not on performance panel */}
      {activePanel !== "performance" && stats && (
        <div style={{
          display: "flex", gap: 12, marginTop: 16, padding: "10px 14px",
          background: "var(--bg-2)", border: "1px solid var(--border)",
          borderRadius: 8, flexWrap: "wrap",
        }}>
          {[
            { label: t("agents.bus.kpi.total", locale),    value: stats.stats.total,       color: "#3b82f6" },
            { label: t("agents.bus.kpi.pending", locale),   value: stats.stats.pending,     color: "#f59e0b" },
            { label: t("agents.bus.kpi.completed", locale), value: stats.stats.completed,   color: "#22c55e" },
            { label: t("agents.bus.kpi.failed", locale),   value: stats.stats.failed,      color: "#ef4444" },
          ].map(kpi => (
            <div key={kpi.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{kpi.label}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: kpi.color }}>{kpi.value}</span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
