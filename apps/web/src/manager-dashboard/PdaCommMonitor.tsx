import { useEffect, useState, useRef, useCallback } from "react";
import { apiClient } from "../api/client";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

// ── Neural event types ──────────────────────────────────────────────
type Priority = "critical" | "warning" | "info";

interface NeuralEvent {
  _id: string;
  from: string;
  to: string;
  type: string;
  payload: Record<string, unknown>;
  priority: Priority;
  _ts: string;
}

interface LoadingStatus {
  woCode: string;
  total: number;
  fulfilled: number;
  partial: number;
  pending: number;
  pct: number;
  nextItem?: { materialCode: string; materialName: string; qty: number; fulfilled: number };
}

const PRIORITY_COLOR: Record<Priority, string> = {
  critical: "#c62828",
  warning: "#ef6c00",
  info: "#2e7d32",
};

const NODE_COLORS: Record<string, string> = {
  pda_loader: "#1565c0",
  pmc_manager: "#6a1b9a",
  wms_manager: "#2e7d32",
  mes_manager: "#ef6c00",
  ai_monitor: "#00838f",
  quality_manager: "#c62828",
  safety_manager: "#37474f",
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  MATERIAL_SCANNED: "#2e7d32",
  SCAN_ERROR: "#c62828",
  LOADING_PROGRESS: "#1565c0",
  MATERIAL_SHORTAGE: "#ef6c00",
  WO_COMPLETE: "#2e7d32",
  SAFETY_ALERT: "#c62828",
  OPERATION_HALT: "#6a1b9a",
  CONNECTED: "#388e3c",
  PING: "#9e9e9e",
  PONG: "#9e9e9e",
};

export function PdaCommMonitor({ locale }: { locale: Locale }) {
  const [events, setEvents] = useState<NeuralEvent[]>([]);
  const [stats, setStats] = useState({
    total: 0, critical: 0, warning: 0, info: 0,
    byNode: {} as Record<string, number>,
    byType: {} as Record<string, number>,
  });
  const [connected, setConnected] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<LoadingStatus | null>(null);
  const [woCodeInput, setWoCodeInput] = useState("");
  const [filterNode, setFilterNode] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [selectedEvent, setSelectedEvent] = useState<NeuralEvent | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const eventsRef = useRef<NeuralEvent[]>([]);
  const maxEvents = 500;
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── SSE connection ─────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource("http://127.0.0.1:8080/api/pda/events");
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => { setConnected(false); setTimeout(connect, 5000); };
    es.onmessage = (e) => {
      try {
        const evt: NeuralEvent = JSON.parse(e.data);
        if (evt.type === "CONNECTED" || evt.type === "heartbeat") return;
        eventsRef.current = [evt, ...eventsRef.current].slice(0, maxEvents);
        setEvents([...eventsRef.current]);
      } catch { /* ignore */ }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => { esRef.current?.close(); };
  }, [connect]);

  // ── Stats refresh ─────────────────────────────────────────────────
  useEffect(() => {
    statsIntervalRef.current = setInterval(() => {
      const evts = eventsRef.current;
      const byNode: Record<string, number> = {};
      const byType: Record<string, number> = {};
      let critical = 0, warning = 0, info = 0;
      for (const e of evts) {
        byNode[e.from] = (byNode[e.from] ?? 0) + 1;
        byType[e.type] = (byType[e.type] ?? 0) + 1;
        if (e.priority === "critical") critical++;
        else if (e.priority === "warning") warning++;
        else info++;
      }
      setStats({ total: evts.length, critical, warning, info, byNode, byType });
    }, 1000);
    return () => { if (statsIntervalRef.current) clearInterval(statsIntervalRef.current); };
  }, []);

  // ── Fetch loading status ──────────────────────────────────────────
  const fetchLoadingStatus = useCallback(async (woCode: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:8080/api/pda/loading-status?woCode=${woCode}`);
      const json = await res.json();
      setLoadingStatus(json.data ?? null);
    } catch { setLoadingStatus(null); }
  }, []);

  // ── Post custom event ────────────────────────────────────────────
  const [postResult, setPostResult] = useState("");
  const postEvent = async (from: string, to: string, type: string, payload: Record<string, unknown>, priority: Priority) => {
    setPostResult("Sending...");
    try {
      const res = await fetch("http://127.0.0.1:8080/api/pda/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, type, payload, priority }),
      });
      const json = await res.json();
      setPostResult(json.ok ? "✓ Event posted" : `✗ ${json.error?.message ?? "Failed"}`);
    } catch (ex: unknown) {
      setPostResult(`✗ ${ex instanceof Error ? ex.message : String(ex)}`);
    }
  };

  // ── Fetch audit summary ───────────────────────────────────────────
  const [auditSummary, setAuditSummary] = useState<Record<string, number>>({});
  useEffect(() => {
    fetch("http://127.0.0.1:8080/api/pda/audit-summary")
      .then(r => r.json())
      .then(j => setAuditSummary(j.data ?? {}))
      .catch(() => {});
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────
  const filteredEvents = events.filter(evt => {
    if (filterNode !== "all" && evt.from !== filterNode) return false;
    if (filterType !== "all" && evt.type !== filterType) return false;
    if (filterPriority !== "all" && evt.priority !== filterPriority) return false;
    return true;
  });

  const uniqueNodes = [...new Set(events.map(e => e.from))];
  const uniqueTypes = [...new Set(events.map(e => e.type))];
  const sortedNodes = uniqueNodes.sort();

  const nodeColor = (node: string) => NODE_COLORS[node] ?? "#757575";
  const typeColor = (type: string) => EVENT_TYPE_COLORS[type] ?? "#9e9e9e";

  const formatPayload = (payload: Record<string, unknown>): string => {
    try { return JSON.stringify(payload, null, 2); } catch { return String(payload); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10, padding: "0 0 16px" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>📡</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>PDA Neural Comm Monitor</span>
          <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 12, background: connected ? "#e8f5e9" : "#ffebee", color: connected ? "#2e7d32" : "#c62828", fontWeight: 600 }}>
            {connected ? "● LIVE" : "○ RECONNECTING"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["total", "critical", "warning", "info"] as const).map(k => (
            <div key={k} style={{ padding: "3px 10px", borderRadius: 8, background: k === "critical" ? "#ffebee" : k === "warning" ? "#fff3e0" : k === "info" ? "#e8f5e9" : "#f5f5f5", border: `1px solid ${k === "critical" ? "#ef9a9a" : k === "warning" ? "#ffcc80" : k === "info" ? "#a5d6a7" : "#bdbdbd"}` }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{stats[k]}</span>
              <span style={{ fontSize: 10, marginLeft: 3, color: "#666" }}>{k}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          <input
            value={woCodeInput}
            onChange={e => setWoCodeInput(e.target.value)}
            placeholder="WO Code (e.g. 26062910001)"
            style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 12, width: 180 }}
          />
          <button onClick={() => fetchLoadingStatus(woCodeInput)} style={{ padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer", background: "#1565c0", color: "#fff", fontSize: 12, fontWeight: 600 }}>
            Load Status
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flex: 1, minHeight: 0 }}>

        {/* ── Left: Stats + Loading ── */}
        <div style={{ width: 240, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* By-node stats */}
          <div style={{ background: "#fafafa", borderRadius: 8, padding: 10, border: "1px solid #eee" }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: "#555", marginBottom: 6 }}>📊 Events by Node</div>
            {sortedNodes.length === 0 && <div style={{ color: "#aaa", fontSize: 11 }}>No data</div>}
            {sortedNodes.map(node => {
              const count = stats.byNode[node] ?? 0;
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
              return (
                <div key={node} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span style={{ color: nodeColor(node), fontWeight: 600 }}>{node}</span>
                    <span style={{ color: "#666" }}>{count} <span style={{ color: "#aaa" }}>({pct}%)</span></span>
                  </div>
                  <div style={{ height: 4, background: "#eee", borderRadius: 2, marginTop: 2 }}>
                    <div style={{ height: 4, background: nodeColor(node), borderRadius: 2, width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* By-type stats */}
          <div style={{ background: "#fafafa", borderRadius: 8, padding: 10, border: "1px solid #eee", flex: 1, overflowY: "auto" }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: "#555", marginBottom: 6 }}>🏷️ Events by Type</div>
            {uniqueTypes.sort().map(type => {
              const count = stats.byType[type] ?? 0;
              return (
                <div key={type} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0", borderBottom: "1px solid #f0f0f0" }}>
                  <span style={{ color: typeColor(type), fontWeight: 500 }}>{type}</span>
                  <span style={{ color: "#666" }}>{count}</span>
                </div>
              );
            })}
          </div>

          {/* Loading status */}
          {loadingStatus && (
            <div style={{ background: "#f3e5f5", borderRadius: 8, padding: 10, border: "1px solid #e1bee7" }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: "#6a1b9a", marginBottom: 6 }}>📦 Loading: {loadingStatus.woCode}</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                {(["fulfilled", "partial", "pending"] as const).map(k => (
                  <div key={k} style={{ flex: 1, textAlign: "center", padding: "4px 6px", borderRadius: 6, background: k === "fulfilled" ? "#c8e6c9" : k === "partial" ? "#fff9c4" : "#ffcdd2" }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: k === "fulfilled" ? "#2e7d32" : k === "partial" ? "#f57f17" : "#c62828" }}>{loadingStatus[k]}</div>
                    <div style={{ fontSize: 9, color: "#666" }}>{k}</div>
                  </div>
                ))}
              </div>
              <div style={{ height: 8, background: "#e0e0e0", borderRadius: 4 }}>
                <div style={{ height: 8, background: "#2e7d32", borderRadius: 4, width: `${loadingStatus.pct}%`, transition: "width 0.3s" }} />
              </div>
              <div style={{ textAlign: "center", fontSize: 12, color: "#555", marginTop: 4 }}>{loadingStatus.pct}% Complete</div>
              {loadingStatus.nextItem && (
                <div style={{ marginTop: 6, fontSize: 11, background: "#fff", borderRadius: 6, padding: "6px 8px", border: "1px solid #e1bee7" }}>
                  <div style={{ color: "#aaa", fontSize: 9 }}>NEXT ITEM</div>
                  <div style={{ color: "#6a1b9a", fontWeight: 600 }}>{loadingStatus.nextItem.materialCode}</div>
                  <div style={{ color: "#666" }}>{loadingStatus.nextItem.materialName}</div>
                  <div style={{ color: "#888" }}>Qty: {loadingStatus.nextItem.qty} | Done: {loadingStatus.nextItem.fulfilled}</div>
                </div>
              )}
            </div>
          )}

          {/* Audit summary */}
          <div style={{ background: "#fafafa", borderRadius: 8, padding: 10, border: "1px solid #eee" }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: "#555", marginBottom: 6 }}>📋 Audit Summary (today)</div>
            {Object.entries(auditSummary).length === 0 && <div style={{ color: "#aaa", fontSize: 11 }}>No data</div>}
            {Object.entries(auditSummary).map(([key, val]) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0" }}>
                <span style={{ color: "#555" }}>{key}</span>
                <span style={{ fontWeight: 600, color: "#333" }}>{val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Center: Event Feed ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 12, color: "#555" }}>📡 Neural Bus — {filteredEvents.length} events</span>
            <select value={filterNode} onChange={e => setFilterNode(e.target.value)} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4 }}>
              <option value="all">All Nodes</option>
              {sortedNodes.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4 }}>
              <option value="all">All Types</option>
              {uniqueTypes.sort().map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4 }}>
              <option value="all">All Priority</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
            <button onClick={() => { eventsRef.current = []; setEvents([]); }} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #ccc", cursor: "pointer", background: "#fff" }}>Clear</button>
          </div>

          {/* Feed */}
          <div style={{ flex: 1, overflowY: "auto", background: "#0d1117", borderRadius: 8, padding: 6, fontFamily: "monospace", fontSize: 11 }}>
            {filteredEvents.length === 0 && <div style={{ color: "#555", padding: 20, textAlign: "center" }}>No events — scan a material on the PDA to see live events</div>}
            {filteredEvents.map(evt => {
              const color = PRIORITY_COLOR[evt.priority];
              const nodeC = nodeColor(evt.from);
              const typeC = typeColor(evt.type);
              return (
                <div
                  key={evt._id}
                  onClick={() => setSelectedEvent(selectedEvent?._id === evt._id ? null : evt)}
                  style={{
                    padding: "3px 0",
                    borderBottom: "1px solid #1f2937",
                    borderLeft: `3px solid ${color}`,
                    cursor: "pointer",
                    background: selectedEvent?._id === evt._id ? "#1f2937" : "transparent",
                  }}
                >
                  <span style={{ color: "#58a6ff", marginRight: 5 }}>{new Date(evt._ts).toLocaleTimeString()}</span>
                  <span style={{ color: nodeC, marginRight: 5, fontWeight: 600 }}>[{evt.from}]</span>
                  <span style={{ color: typeC, marginRight: 5 }}>{evt.type}</span>
                  {evt.to !== "*" && <span style={{ color: "#aaa", marginRight: 5 }}>→ {evt.to}</span>}
                  <span style={{ color, marginLeft: 4 }}>[{evt.priority}]</span>
                  {Object.keys(evt.payload ?? {}).length > 0 && (
                    <span style={{ color: "#8b949e", marginLeft: 5 }}>{JSON.stringify(evt.payload).slice(0, 60)}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Event detail */}
          {selectedEvent && (
            <div style={{ background: "#1e1e1e", borderRadius: 8, padding: 12, fontFamily: "monospace", fontSize: 11, maxHeight: 160, overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "#58a6ff", fontWeight: 600 }}>{selectedEvent.type}</span>
                <button onClick={() => setSelectedEvent(null)} style={{ fontSize: 10, border: "none", cursor: "pointer", color: "#aaa", background: "transparent" }}>✕</button>
              </div>
              <pre style={{ color: "#d4d4d4", whiteSpace: "pre-wrap", margin: 0 }}>
                {`from:    ${selectedEvent.from}\nto:      ${selectedEvent.to}\ntype:    ${selectedEvent.type}\npriority: ${selectedEvent.priority}\nts:      ${selectedEvent._ts}\npayload:\n${formatPayload(selectedEvent.payload)}`}
              </pre>
            </div>
          )}
        </div>

        {/* ── Right: Post Event + Quick Actions ── */}
        <div style={{ width: 260, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Post event */}
          <div style={{ background: "#fafafa", borderRadius: 8, padding: 10, border: "1px solid #eee" }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: "#555", marginBottom: 8 }}>📤 Fire Neural Event</div>
            <QuickEventButton label="📦 MATERIAL_SCANNED" priority="info" onPost={postEvent} />
            <QuickEventButton label="❌ SCAN_ERROR" priority="warning" onPost={postEvent} />
            <QuickEventButton label="⚠️ MATERIAL_SHORTAGE" priority="warning" onPost={postEvent} />
            <QuickEventButton label="🛑 OPERATION_HALT" priority="critical" onPost={postEvent} />
            <QuickEventButton label="✅ WO_COMPLETE" priority="info" onPost={postEvent} />
            <QuickEventButton label="🚨 SAFETY_ALERT" priority="critical" onPost={postEvent} />
            {postResult && <div style={{ marginTop: 6, fontSize: 11, color: "#333" }}>{postResult}</div>}
          </div>

          {/* Node legend */}
          <div style={{ background: "#fafafa", borderRadius: 8, padding: 10, border: "1px solid #eee", flex: 1, overflowY: "auto" }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: "#555", marginBottom: 6 }}>🧠 Agent Nodes</div>
            {sortedNodes.map(node => (
              <div key={node} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 11 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: nodeColor(node), flexShrink: 0 }} />
                <span style={{ color: nodeColor(node), fontWeight: 600 }}>{node}</span>
                <span style={{ color: "#aaa", marginLeft: "auto" }}>{stats.byNode[node] ?? 0}</span>
              </div>
            ))}
            <div style={{ marginTop: 8, borderTop: "1px solid #eee", paddingTop: 6 }}>
              {["pda_loader", "pmc_manager", "wms_manager", "mes_manager", "ai_monitor", "quality_manager", "safety_manager"].filter(n => !uniqueNodes.includes(n)).map(node => (
                <div key={node} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 11, opacity: 0.3 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: nodeColor(node), flexShrink: 0 }} />
                  <span style={{ color: nodeColor(node) }}>{node}</span>
                  <span style={{ color: "#aaa", marginLeft: "auto" }}>0</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Quick event button helper ────────────────────────────────────────
function QuickEventButton({ label, priority, onPost }: { label: string; priority: Priority; onPost: (from: string, to: string, type: string, payload: Record<string, unknown>, priority: Priority) => void }) {
  const [loading, setLoading] = useState(false);
  const handleClick = async () => {
    setLoading(true);
    const type = label.replace(/^[^\s]+\s/, "");
    await onPost("web_monitor", "*", type, { triggeredBy: "PdaCommMonitor" }, priority);
    setLoading(false);
  };
  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "none", cursor: loading ? "not-allowed" : "pointer", background: priority === "critical" ? "#ffebee" : priority === "warning" ? "#fff3e0" : "#e8f5e9", color: priority === "critical" ? "#c62828" : priority === "warning" ? "#ef6c00" : "#2e7d32", fontSize: 11, fontWeight: 600, textAlign: "left", marginBottom: 4, opacity: loading ? 0.5 : 1 }}
    >
      {label}
    </button>
  );
}
