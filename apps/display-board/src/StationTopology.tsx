import React, { useState, useEffect, useCallback } from "react";

// ── Station code → visual metadata ──────────────────────────────────────────────
const STATION_META: Record<string, { icon: string; shortName: string; ip?: string; dataSrc: string }> = {
  "PDA-01":        { icon: "📱", shortName: "PDA扫码", dataSrc: "Android App" },
  "AOI-01":       { icon: "🔍", shortName: "AOI检测", dataSrc: "Android App" },
  "ICT-01":       { icon: "⚡", shortName: "ICT", ip: "192.168.6.91", dataSrc: "D:\\SRC (*.csv/xls)" },
  "FCT-01":       { icon: "🔬", shortName: "FCT", ip: "192.168.6.87", dataSrc: "D:\\ATS\\测试报表" },
  "DEPANEL-01":   { icon: "🔪", shortName: "PCBA分板", ip: "192.168.6.88", dataSrc: "d1000B.txt" },
  "SHELL-BIND-01":{ icon: "🔗", shortName: "PCBA绑码", dataSrc: "Scanner Input" },
  "ASSY-ATE-01":  { icon: "🛠️", shortName: "组装ATE", dataSrc: "Scanner Input" },
  "ULTRA-01":     { icon: "📡", shortName: "超声", dataSrc: "Scanner Input" },
  "AGING-01":     { icon: "⏳", shortName: "成品老化", dataSrc: "Scanner Input" },
  "HIPOT-01":     { icon: "⚡", shortName: "高压ATE", dataSrc: "D:\\ATS\\测试报表" },
  "PACK-ATE-01":  { icon: "📦", shortName: "包装ATE", dataSrc: "D:\\ATS\\测试报表" },
  "CARTON-BIND-01":{ icon: "🏷️", shortName: "外箱绑码", dataSrc: "Scanner Input" },
  "PALLET-BIND-01":{ icon: "📦", shortName: "栈板绑码", dataSrc: "Scanner Input" },
};

const HTTP_PORTS: Record<string, number> = {
  "ICT-01": 8089, "FCT-01": 8090, "DEPANEL-01": 8091,
  "SHELL-BIND-01": 8092, "ASSY-ATE-01": 8093, "ULTRA-01": 8094,
  "AGING-01": 8095, "HIPOT-01": 8096, "PACK-ATE-01": 8097,
  "CARTON-BIND-01": 8098, "PALLET-BIND-01": 8099,
};

const WS_PORTS: Record<string, number> = {
  "ICT-01": 1101, "FCT-01": 1102, "DEPANEL-01": 1103,
  "SHELL-BIND-01": 1104, "ASSY-ATE-01": 1105, "ULTRA-01": 1106,
  "AGING-01": 1107, "HIPOT-01": 1108, "PACK-ATE-01": 1109,
  "CARTON-BIND-01": 1110, "PALLET-BIND-01": 1111,
};

// ── Types ──────────────────────────────────────────────────────────────────────
interface StationStatus {
  stationCode: string;
  stationName: string;
  sequenceOrder: number;
  status: "running" | "idle" | "ng" | "stale" | "offline";
  lastEvent: string | null;
  ngCount: number;
  isOnline: boolean;
}

interface AndonResponse {
  lineCode: string;
  lineNameZh: string;
  updatedAt: string;
  lineStatus: string;
  totalNG: number;
  stations: StationStatus[];
}

// ── Styles ────────────────────────────────────────────────────────────────────
const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
  .topo-wrap { max-width: 1400px; margin: 0 auto; padding: 0 24px 32px; }
  .topo-header { text-align: center; padding: 28px 0 16px; }
  .topo-header h1 { font-size: 26px; font-weight: 700; background: linear-gradient(90deg, #38bdf8, #818cf8);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .topo-header p { color: #94a3b8; margin-top: 6px; font-size: 13px; }
  .topo-meta { display: flex; justify-content: center; gap: 24px; margin-top: 10px; font-size: 12px; color: #64748b; flex-wrap: wrap; }
  .topo-meta span { display: flex; align-items: center; gap: 4px; }
  .legend-wrap { display: flex; justify-content: center; gap: 28px; padding: 14px 24px;
    background: #1e293b; border-bottom: 1px solid #334155; flex-wrap: wrap; margin-bottom: 24px; }
  .legend-item { display: flex; align-items: center; gap: 7px; font-size: 12px; color: #94a3b8; }
  .legend-dot { width: 11px; height: 11px; border-radius: 3px; flex-shrink: 0; }
  .legend-line { width: 22px; height: 3px; border-radius: 2px; flex-shrink: 0; }
  .flow-row { display: flex; justify-content: center; gap: 0; flex-wrap: wrap; }
  .station-card { position: relative; width: 160px; flex-shrink: 0; background: #1e293b;
    border: 1.5px solid #334155; border-radius: 11px; padding: 14px 10px 12px; text-align: center;
    transition: all 0.2s; }
  .station-card:hover { border-color: #38bdf8; box-shadow: 0 4px 20px rgba(56,189,248,0.12); transform: translateY(-2px); }
  .station-card .num { position: absolute; top: -9px; left: 50%; transform: translateX(-50%);
    background: #334155; color: #94a3b8; font-size: 10px; font-weight: 700; padding: 1px 10px; border-radius: 20px; }
  .station-card .icon { font-size: 26px; margin: 5px 0 3px; }
  .station-card h3 { font-size: 12px; font-weight: 600; color: #f1f5f9; line-height: 1.3; }
  .station-card .sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  .station-card .ip { font-size: 10px; color: #facc15; margin: 3px 0; font-family: monospace; }
  .station-card .badge { display: inline-flex; gap: 3px; margin-top: 7px; flex-wrap: wrap; justify-content: center; }
  .station-card .badge span { font-size: 9px; padding: 2px 7px; border-radius: 9px; font-weight: 500; white-space: nowrap; }
  .station-card .ws-badge { font-size: 9px; padding: 2px 6px; border-radius: 9px; margin-top: 4px;
    font-weight: 600; display: inline-block; }
  .arrow-connector { display: flex; align-items: center; padding: 0 2px; flex-shrink: 0; }
  .arrow-connector svg { width: 26px; height: 26px; }
  .rework-box { margin-top: 28px; padding: 18px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; }
  .rework-box h3 { font-size: 13px; font-weight: 600; color: #fbbf24; margin-bottom: 10px; display: flex; align-items: center; gap: 7px; }
  .rework-flow { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: center; }
  .rework-step { padding: 5px 13px; border-radius: 8px; font-size: 11px; font-weight: 500; }
  .rework-arrow { color: #64748b; font-size: 14px; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 12px; }
  .summary-card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px; text-align: center; }
  .summary-card .num { font-size: 30px; font-weight: 700; line-height: 1; }
  .summary-card .label { font-size: 11px; color: #94a3b8; margin-top: 4px; }
  .arch-diagram { display: flex; flex-direction: column; align-items: center; gap: 18px; margin-top: 20px; }
  .arch-row { display: flex; align-items: center; gap: 14px; justify-content: center; flex-wrap: wrap; }
  .arch-box { padding: 10px 22px; border-radius: 9px; font-size: 12px; font-weight: 500; text-align: center; min-width: 90px; border: 1px solid; }
  .arch-box.mes { background: rgba(56,189,248,0.1); border-color: rgba(56,189,248,0.3); color: #38bdf8; }
  .arch-box.fwd { background: rgba(250,204,21,0.1); border-color: rgba(250,204,21,0.3); color: #fde047; }
  .arch-box.station { background: rgba(148,163,184,0.08); border-color: #334155; color: #e2e8f0; }
  .arch-box.sqlite { background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.2); color: #4ade80; }
  .arch-line { display: flex; flex-direction: column; align-items: center; font-size: 10px; color: #64748b; gap: 2px; }
  .data-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; margin-top: 10px; }
  .data-table th { background: #1e293b; color: #94a3b8; font-weight: 600; padding: 9px 12px;
    text-align: left; border-bottom: 2px solid #334155; text-transform: uppercase; letter-spacing: 0.4px; }
  .data-table td { padding: 9px 12px; border-bottom: 1px solid #1e293b; vertical-align: middle; }
  .data-table tr:hover td { background: rgba(56,189,248,0.03); }
  .data-table .port { font-family: monospace; font-size: 10px; color: #facc15; }
  .data-table .badge-cell { display: inline-flex; padding: 1px 7px; border-radius: 9px; font-size: 10px; }
  .section { margin: 30px 0 14px; }
  .section h2 { font-size: 16px; font-weight: 600; color: #e2e8f0; display: flex; align-items: center; gap: 7px; }
  .section h2 small { font-size: 11px; color: #64748b; font-weight: 400; }
  .updated-bar { text-align: center; font-size: 11px; color: #475569; padding: 8px 0 0; }
  .footer { text-align: center; padding: 24px 0 16px; color: #475569; font-size: 11px; }
  /* status colors */
  .status-running { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
  .status-idle   { background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
  .status-ng     { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
  .status-stale  { background: rgba(148,163,184,0.12); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2); }
  .status-offline{ background: rgba(75,85,99,0.12); color: #6b7280; border: 1px solid rgba(75,85,99,0.2); }
  /* type badges */
  .type-watch    { background: rgba(250,204,21,0.15); color: #fde047; border: 1px solid rgba(250,204,21,0.3); }
  .type-scanner  { background: rgba(34,211,238,0.15); color: #67e8f9; border: 1px solid rgba(34,211,238,0.3); }
  .type-log      { background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); }
  .type-android  { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
  /* mes badges */
  .mes-yes  { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
  .mes-no   { background: rgba(148,163,184,0.12); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2); }
  .mes-embed{ background: rgba(56,189,248,0.15); color: #38bdf8; border: 1px solid rgba(56,189,248,0.3); }
  .ws-running { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
  .ws-unknown  { background: rgba(148,163,184,0.12); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2); }
  /* line status banner */
  .line-banner { display: flex; justify-content: center; gap: 16px; align-items: center; flex-wrap: wrap;
    padding: 10px 20px; border-radius: 10px; margin-bottom: 24px; }
  .line-ok     { background: rgba(5,150,105,0.15); border: 2px solid #059669; color: #34d399; }
  .line-running{ background: rgba(34,197,94,0.1); border: 2px solid #22c55e; color: #4ade80; }
  .line-ng     { background: rgba(239,68,68,0.12); border: 2px solid #ef4444; color: #f87171; }
  .line-idle   { background: rgba(245,158,11,0.1); border: 2px solid #f59e0b; color: #fbbf24; }
  @media (max-width: 768px) { .station-card { width: 138px; padding: 12px 8px; } }
`;

// ── Arrow SVG ─────────────────────────────────────────────────────────────────
function Arrow() {
  return (
    <div className="arrow-connector">
      <svg viewBox="0 0 28 28">
        <path d="M4 14h20" stroke="#38bdf8" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        <path d="M18 8l6 6-6 6" stroke="#38bdf8" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ── Station Card ───────────────────────────────────────────────────────────────
function StationCard({ station }: { station: StationStatus }) {
  const meta = STATION_META[station.stationCode] ?? { icon: "❓", shortName: station.stationName || station.stationCode };
  const httpPort = HTTP_PORTS[station.stationCode];
  const wsPort = WS_PORTS[station.stationCode];
  const isWatcher = !!httpPort;

  const statusClass = `status-${station.status}`;
  const statusLabel = { running: "运行中", idle: "空闲", ng: "NG", stale: "超时", offline: "离线" }[station.status] ?? station.status;

  // MES forwarding logic
  const isMES = ["ICT-01","FCT-01","DEPANEL-01","ASSY-ATE-01","HIPOT-01","PACK-ATE-01"].includes(station.stationCode);
  const isLocal = ["SHELL-BIND-01","ULTRA-01","AGING-01","CARTON-BIND-01","PALLET-BIND-01"].includes(station.stationCode);

  return (
    <div className="station-card">
      <div className="num">{station.sequenceOrder}</div>
      <div className="icon">{meta.icon}</div>
      <h3>{meta.shortName}</h3>
      <div className="sub">{station.stationName}</div>
      {meta.ip && <div className="ip">{meta.ip}</div>}
      <div className="badge">
        <span className={statusClass}>{statusLabel}</span>
        {station.ngCount > 0 && <span className="status-ng">⚠{station.ngCount}</span>}
        {isWatcher && <span className="type-watch">📁</span>}
        {!isWatcher && !["PDA-01","AOI-01"].includes(station.stationCode) && <span className="type-scanner">⌨</span>}
        {["PDA-01","AOI-01"].includes(station.stationCode) && <span className="type-android">📱</span>}
        {isMES && <span className="mes-yes">→ MES</span>}
        {isLocal && <span className="mes-no">Local</span>}
        {station.stationCode === "SHELL-BIND-01" && <span className="mes-embed">Embed</span>}
      </div>
      {httpPort && (
        <div className={`ws-badge ${station.isOnline ? "ws-running" : "ws-unknown"}`}>
          {station.isOnline ? `WS ${wsPort}` : "offline"}
        </div>
      )}
    </div>
  );
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{ fontFamily: "monospace", fontSize: 13, color: "#94a3b8" }}>
      {t.toLocaleTimeString("zh-CN", { hour12: false })} {t.toLocaleDateString("zh-CN")}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function StationTopology() {
  const [data, setData] = useState<AndonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      // Try the API server
      let res = await fetch("/api/mes/andon-board?line=MANUAL-LINE");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AndonResponse = await res.json();
      setData(json);
      setError(null);
      setLastFetch(new Date());
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { fetch_(); const id = setInterval(fetch_, 10_000); return () => clearInterval(id); }, [fetch_]);

  // Build a map from station code → status for quick lookup
  const statusMap: Record<string, StationStatus> = {};
  if (data?.stations) {
    for (const s of data.stations) statusMap[s.stationCode] = s;
  }

  // All 13 stations in sequence order (hardcoded for topology display)
  const STATION_ORDER = [
    "PDA-01","AOI-01","ICT-01","FCT-01","DEPANEL-01","SHELL-BIND-01",
    "ASSY-ATE-01","ULTRA-01","AGING-01","HIPOT-01","PACK-ATE-01",
    "CARTON-BIND-01","PALLET-BIND-01",
  ];

  const lineCfg = data?.lineStatus === "ng"
    ? { cls: "line-ng", label: "产线异常" }
    : data?.lineStatus === "running"
    ? { cls: "line-running", label: "运行中" }
    : data?.lineStatus === "idle"
    ? { cls: "line-idle", label: "空闲" }
    : { cls: "line-ok", label: "正常" };

  return (
    <>
      <style>{CSS}</style>
      <div className="topo-wrap">
        {/* Header */}
        <div className="topo-header">
          <h1>🏭 SMT Factory — Station Topology</h1>
          <p>13-Station Manual SMT Line · 004-手动线 · Vietnam Factory</p>
          <div className="topo-meta">
            <span><Clock /></span>
            <span>🔗 MES API 192.168.6.155:8080</span>
            <span>⚡ Auto-refresh every 10s</span>
            {lastFetch && <span>✅ Updated: {lastFetch.toLocaleTimeString("zh-CN", { hour12: false })}</span>}
          </div>
        </div>

        {/* Legend */}
        <div className="legend-wrap">
          <div className="legend-item"><div className="legend-dot" style={{background:"#22c55e"}}></div> Running</div>
          <div className="legend-item"><div className="legend-dot" style={{background:"#f59e0b"}}></div> Idle</div>
          <div className="legend-item"><div className="legend-dot" style={{background:"#ef4444"}}></div> NG</div>
          <div className="legend-item"><div className="legend-dot" style={{background:"#94a3b8"}}></div> Stale/Offline</div>
          <div className="legend-item"><div className="legend-dot" style={{background:"#fde047"}}></div> Folder Watch</div>
          <div className="legend-item"><div className="legend-dot" style={{background:"#67e8f9"}}></div> Scanner Input</div>
          <div className="legend-item"><div className="legend-dot" style={{background:"#4ade80"}}></div> → MES</div>
          <div className="legend-item"><div className="legend-dot" style={{background:"#38bdf8"}}></div> Product Flow</div>
        </div>

        {/* Error */}
        {error && (
          <div style={{background:"#2a0505",border:"1px solid #ef4444",borderRadius:8,padding:"10px 16px",color:"#f87171",marginBottom:16}}>
            ⚠ Cannot connect to MES API: {error}
          </div>
        )}

        {/* Line Status Banner */}
        {data && (
          <div className={`line-banner ${lineCfg.cls}`} style={{fontSize:15,fontWeight:700}}>
            <span>产线状态: {lineCfg.label}</span>
            <span style={{width:1,height:20,background:"currentColor",opacity:0.3}}></span>
            <span>🔴 NG: {data.totalNG}</span>
            <span style={{width:1,height:20,background:"currentColor",opacity:0.3}}></span>
            <span>🟢 在线: {data.stations.filter(s=>s.isOnline).length}</span>
            <span style={{width:1,height:20,background:"currentColor",opacity:0.3}}></span>
            <span>工位: {data.stations.length}</span>
          </div>
        )}

        {/* ── MAIN FLOW ── */}
        <div className="section"><h2>📋 Station Flow <small>PCB Bare Board → Finished Pallet</small></h2></div>

        <div className="flow-row">
          {STATION_ORDER.map((code, i) => {
            const station = statusMap[code];
            return (
              <React.Fragment key={code}>
                <StationCard station={station ?? {
                  stationCode: code,
                  stationName: STATION_META[code]?.shortName ?? code,
                  sequenceOrder: i + 1,
                  status: "offline",
                  lastEvent: null,
                  ngCount: 0,
                  isOnline: false,
                }} />
                {i < STATION_ORDER.length - 1 && <Arrow />}
              </React.Fragment>
            );
          })}
          {/* Ship Out */}
          <div className="arrow-connector"><Arrow /></div>
          <div className="station-card" style={{borderColor:"#059669",background:"rgba(5,150,105,0.08)",width:110}}>
            <div className="icon">✅</div>
            <h3>Ship Out</h3>
            <div className="sub">Finished</div>
          </div>
        </div>

        {/* ── REWORK LOOP ── */}
        <div className="rework-box">
          <h3>🔄 Rework Loop</h3>
          <div className="rework-flow">
            <span className="rework-step" style={{background:"rgba(239,68,68,0.15)",color:"#f87171",border:"1px solid rgba(239,68,68,0.3)"}}>🚫 NG Detected</span>
            <span className="rework-arrow">→</span>
            <span className="rework-step" style={{background:"rgba(250,204,21,0.15)",color:"#fde047",border:"1px solid rgba(250,204,21,0.3)"}}>🛠️ 回修站 Repair</span>
            <span className="rework-arrow">→</span>
            <span className="rework-step" style={{background:"rgba(34,197,94,0.15)",color:"#4ade80",border:"1px solid rgba(34,197,94,0.3)"}}>✅ Post-Repair Test</span>
            <span className="rework-arrow">→</span>
            <span className="rework-step" style={{background:"rgba(59,130,246,0.15)",color:"#60a5fa",border:"1px solid rgba(59,130,246,0.3)"}}>⬆ Re-enter Flow</span>
          </div>
          <div style={{textAlign:"center",fontSize:11,color:"#64748b",marginTop:8}}>≥3 repairs → Scrap 🗑️</div>
        </div>

        {/* ── STATION DETAILS TABLE ── */}
        <div className="section"><h2>📊 Station Details</h2></div>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th><th>Station</th><th>Code</th><th>IP</th><th>HTTP</th><th>WS</th><th>Data Source</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {STATION_ORDER.map((code, i) => {
              const s = statusMap[code];
              const meta = STATION_META[code];
              const httpPort = HTTP_PORTS[code];
              const wsPort = WS_PORTS[code];
              const statusLabel = s ? ({running:"运行中",idle:"空闲",ng:"NG",stale:"超时",offline:"离线"} as const)[s.status] : "离线";
              const statusColor = s ? ({running:"#4ade80",idle:"#fbbf24",ng:"#f87171",stale:"#94a3b8",offline:"#6b7280"} as const)[s.status] : "#6b7280";
              return (
                <tr key={code}>
                  <td>{i+1}</td>
                  <td>{meta?.shortName ?? code}</td>
                  <td style={{fontFamily:"monospace",fontSize:11,color:"#facc15"}}>{code}</td>
                  <td className="port">{meta?.ip ?? "—"}</td>
                  <td className="port">{httpPort ?? "—"}</td>
                  <td className="port">{wsPort ?? "—"}</td>
                  <td><span className="badge-cell" style={{background:"rgba(34,197,94,0.1)",color:"#4ade80",border:"1px solid rgba(34,197,94,0.2)"}}>{meta?.dataSrc ?? "—"}</span></td>
                  <td style={{color:statusColor,fontWeight:600}}>
                    {s?.isOnline === false ? "⚫ " : "🟢 "}{statusLabel}
                    {s && s.ngCount > 0 && ` ⚠${s.ngCount}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── SUMMARY ── */}
        <div className="section"><h2>📈 Summary</h2></div>
        <div className="summary-grid">
          <div className="summary-card"><div className="num" style={{color:"#4ade80"}}>13</div><div className="label">Total Stations</div></div>
          <div className="summary-card"><div className="num" style={{color:"#4ade80"}}>{data?.stations.filter(s=>s.status==="running").length ?? 0}</div><div className="label">Running</div></div>
          <div className="summary-card"><div className="num" style={{color:"#f87171"}}>{data?.totalNG ?? 0}</div><div className="label">NG Count (2h)</div></div>
          <div className="summary-card"><div className="num" style={{color:"#4ade80"}}>{data?.stations.filter(s=>s.isOnline).length ?? 0}</div><div className="label">Online</div></div>
          <div className="summary-card"><div className="num" style={{color:"#fbbf24"}}>4</div><div className="label">Folder Watch</div></div>
          <div className="summary-card"><div className="num" style={{color:"#67e8f9"}}>6</div><div className="label">Scanner Input</div></div>
          <div className="summary-card"><div className="num" style={{color:"#c084fc"}}>1</div><div className="label">Log Ticker</div></div>
          <div className="summary-card"><div className="num" style={{color:"#4ade80"}}>7</div><div className="label">MES-Mapped</div></div>
          <div className="summary-card"><div className="num" style={{color:"#94a3b8"}}>4</div><div className="label">Local Only</div></div>
          <div className="summary-card"><div className="num" style={{color:"#38bdf8"}}>11</div><div className="label">Station Servers</div></div>
        </div>

        {/* ── ARCHITECTURE ── */}
        <div className="section"><h2>🏗️ Data Architecture <small>Per-Station SQLite → Forwarder → MES API</small></h2></div>
        <div className="arch-diagram">
          <div className="arch-row">
            <div className="arch-box station">station_server.py<br/><small style={{color:"#64748b",fontWeight:400}}>Python HTTP + WebSocket</small></div>
            <div className="arch-line">← reads/writes →</div>
            <div className="arch-box sqlite">fct_local.db<br/><small style={{color:"#64748b",fontWeight:400}}>SQLite (sn_records, ng_pool)</small></div>
          </div>
          <div className="arch-row">
            <div className="arch-box sqlite" style={{fontSize:11}}>Notification<br/><small>POST /notify/{'{sn|ng}'}</small></div>
            <div className="arch-line">→ event →</div>
            <div className="arch-box fwd">Forwarder<br/><small style={{color:"#64748b",fontWeight:400}}>Python/Node.js</small></div>
            <div className="arch-line">→ batch POST →</div>
            <div className="arch-box mes">MES API<br/><small style={{color:"#64748b",fontWeight:400}}>192.168.6.155:8080</small></div>
          </div>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center",marginTop:4}}>
            <span style={{fontSize:10,color:"#94a3b8",background:"#1e293b",padding:"3px 9px",borderRadius:6}}>ICT: D:\SRC → station_server → MES /stations/ict/batch</span>
            <span style={{fontSize:10,color:"#94a3b8",background:"#1e293b",padding:"3px 9px",borderRadius:6}}>FCT/Hipot/Pack: ATS\测试报表 → station_server → MES /stations/fct/batch</span>
            <span style={{fontSize:10,color:"#94a3b8",background:"#1e293b",padding:"3px 9px",borderRadius:6}}>组装ATE: Scanner → SQLite → Node.js fwd → /stations/scan/batch</span>
            <span style={{fontSize:10,color:"#94a3b8",background:"#1e293b",padding:"3px 9px",borderRadius:6}}>分板: d1000B.txt → SQLite lookup → /stations/depanel</span>
          </div>
        </div>

        <div className="footer">
          SMT Station Topology · Auto-refreshes every 10s · Powered by /api/mes/andon-board
        </div>
      </div>
    </>
  );
}
