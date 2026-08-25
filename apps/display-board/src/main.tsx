import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import StationTopology from "./StationTopology.js";

// ── Original Andon Board ───────────────────────────────────────────────────
interface Station {
  stationCode: string;
  stationName: string;
  sequenceOrder: number;
  status: "running" | "idle" | "ng" | "stale" | "offline";
  lastEvent: string | null;
  ngCount: number;
  isOnline: boolean;
}
interface AndonData {
  lineCode: string;
  lineNameZh: string;
  updatedAt: string;
  lineStatus: string;
  totalNG: number;
  stations: Station[];
}
const STATUS_CONFIG = {
  running: { label: "运行中", color: "#22c55e", bg: "#052e16" },
  idle:   { label: "空闲",   color: "#f59e0b", bg: "#1c1408" },
  ng:     { label: "NG",    color: "#ef4444", bg: "#2a0505" },
  stale:  { label: "超时",  color: "#94a3b8", bg: "#0f172a" },
  offline:{ label: "离线",  color: "#6b7280", bg: "#111827" },
};
function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontFamily: "monospace", fontSize: 22, color: "#94a3b8" }}>
      {t.toLocaleTimeString("zh-CN", { hour12: false })}{" "}
      {t.toLocaleDateString("zh-CN")}
    </span>
  );
}
function StationCard({ station }: { station: Station }) {
  const cfg = STATUS_CONFIG[station.status] ?? STATUS_CONFIG.offline;
  return (
    <div style={{
      flex: "1 1 120px", minWidth: 130, border: `3px solid ${cfg.color}`,
      borderRadius: 10, background: cfg.bg, padding: "14px 12px",
      display: "flex", flexDirection: "column", gap: 8,
      boxShadow: `0 0 20px ${cfg.color}33`,
    }}>
      <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" }}>{station.stationCode}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", textAlign: "center", lineHeight: 1.2 }}>{station.stationName}</div>
      <div style={{ textAlign: "center", fontSize: 18, fontWeight: 800, color: cfg.color, letterSpacing: 1 }}>{cfg.label}</div>
      {station.ngCount > 0 && (
        <div style={{ textAlign: "center", fontSize: 12, color: "#ef4444", fontWeight: 600 }}>⚠ NG ×{station.ngCount}</div>
      )}
      {station.lastEvent && (
        <div style={{ fontSize: 10, color: "#64748b", textAlign: "center" }}>
          {new Date(station.lastEvent).toLocaleTimeString("zh-CN", { hour12: false })}
        </div>
      )}
    </div>
  );
}
function AndonBoard() {
  const [data, setData] = useState<AndonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/api/mes/andon-board?line=MANUAL-LINE");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AndonData = await res.json();
      setData(json); setError(null); setLastFetch(new Date());
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { fetchBoard(); const id = setInterval(fetchBoard, 10_000); return () => clearInterval(id); }, [fetchBoard]);
  const lineCfg = data?.lineStatus === "ng" ? { color: "#ef4444", bg: "#2a0505" }
    : data?.lineStatus === "running" ? { color: "#22c55e", bg: "#052e16" }
    : { color: "#f59e0b", bg: "#1c1408" };
  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#e2e8f0", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#111827", borderRadius: 10, padding: "12px 20px", border: "1px solid #1e293b" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc" }}>瑞晶越南工厂 — 手动线 Andon 看板</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>实时产线状态监控</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <Clock />
          {lastFetch && <div style={{ fontSize: 11, color: "#475569" }}>更新: {lastFetch.toLocaleTimeString("zh-CN", { hour12: false })}</div>}
        </div>
      </div>
      {data && (
        <div style={{ display: "flex", gap: 16, alignItems: "center", background: lineCfg.bg, border: `2px solid ${lineCfg.color}`, borderRadius: 10, padding: "12px 20px", flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: lineCfg.color }}>
            产线状态: {data.lineStatus === "ng" ? "异常" : data.lineStatus === "running" ? "运行中" : data.lineStatus === "idle" ? "空闲" : "未知"}
          </div>
          <div style={{ width: 1, height: 24, background: "#334155" }} />
          <div style={{ fontSize: 14, color: "#ef4444", fontWeight: 600 }}>🔴 NG总数: {data.totalNG}</div>
          <div style={{ width: 1, height: 24, background: "#334155" }} />
          <div style={{ fontSize: 14, color: "#94a3b8" }}>工位数: {data.stations.length}</div>
          <div style={{ width: 1, height: 24, background: "#334155" }} />
          <div style={{ fontSize: 14, color: "#22c55e" }}>在线: {data.stations.filter(s => s.isOnline).length}</div>
        </div>
      )}
      {error && (
        <div style={{ background: "#2a0505", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 16px", color: "#ef4444", fontSize: 14 }}>
          ⚠ 无法连接MES服务器: {error}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-start" }}>
        {data?.stations.map(s => <StationCard key={s.stationCode} station={s} />)}
        {!data && !error && <div style={{ color: "#475569", fontSize: 16, padding: 40, textAlign: "center", width: "100%" }}>加载中...</div>}
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", background: "#111827", borderRadius: 8, padding: "10px 20px", flexWrap: "wrap" }}>
        {Object.entries(STATUS_CONFIG).map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: v.color }} />
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{v.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Simple hash router ───────────────────────────────────────────────────────
function useHash() {
  const [hash, setHash] = useState(window.location.hash.slice(1) || "andon");
  useEffect(() => {
    const handler = () => setHash(window.location.hash.slice(1) || "andon");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return hash;
}

// ── Nav ─────────────────────────────────────────────────────────────────────
function Nav({ hash }: { hash: string }) {
  return (
    <div style={{ display: "flex", gap: 4, padding: "8px 16px", background: "#111827", borderBottom: "1px solid #334155" }}>
      <a href="#andon" style={{
        padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: "none",
        background: hash === "andon" ? "#0e639c" : "#1e293b",
        color: hash === "andon" ? "white" : "#94a3b8",
        border: hash === "andon" ? "1px solid #38bdf8" : "1px solid #334155",
      }}>📊 Andon 看板</a>
      <a href="#topology" style={{
        padding: "6px 16px", borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: "none",
        background: hash === "topology" ? "#0e639c" : "#1e293b",
        color: hash === "topology" ? "white" : "#94a3b8",
        border: hash === "topology" ? "1px solid #38bdf8" : "1px solid #334155",
      }}>🗺️ Station Topology</a>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const hash = useHash();
  return (
    <>
      <Nav hash={hash} />
      {hash === "topology" ? <StationTopology /> : <AndonBoard />}
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<React.StrictMode><App /></React.StrictMode>);
