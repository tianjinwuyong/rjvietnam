import { useState, useEffect, useCallback, createElement } from "react";
import {
  Activity, CheckCircle, XCircle, AlertCircle, Wifi, WifiOff,
  ChevronRight, Monitor, Cpu, Box, Package, Eye, Wrench,
} from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const AUTO_API = "/api/mes/auto-line/dashboard";

interface LineInfo {
  id: number;
  code: string;
  nameZh: string;
  status: string;
}

interface TodayTotals {
  total: number;
  passed: number;
  failed: number;
  yield: string;
}

interface StationData {
  id: number;
  code: string;
  nameZh: string;
  status: string;
  stationType: string;
  equipmentCode: string | null;
  todayTotal: number;
  todayPass: number;
  todayFail: number;
  todayNg: number;
  lastEventAt: string | null;
  passRate: number;
}

interface EventData {
  id: number;
  stationCode: string;
  stationName: string;
  eventType: string;
  result: string;
  occurredAt: string;
}

interface DashboardData {
  line: LineInfo;
  todayTotals: TodayTotals;
  stations: StationData[];
  recentEvents: EventData[];
}

const STATION_ORDER = [
  "AUTO-LOAD-01",
  "AUTO-AOI-01",
  "AUTO-ICT-01",
  "AUTO-FCT-01",
  "AUTO-PCBA-01",
  "AUTO-ASM-01",
  "AUTO-USONIC-01",
  "AGING-CAB-01",
  "AUTO-HIPOT-01",
  "AUTO-ATE-01",
  "AUTO-PACK-01",
];

const STATION_ICONS: Record<string, typeof Monitor> = {
  "AUTO-LOAD-01": Monitor,
  "AUTO-AOI-01": Eye,
  "AUTO-ICT-01": Monitor,
  "AUTO-FCT-01": Cpu,
  "AUTO-PCBA-01": Wrench,
  "AUTO-ASM-01": Cpu,
  "AUTO-USONIC-01": Activity,
  "AGING-CAB-01": Box,
  "AUTO-HIPOT-01": Cpu,
  "AUTO-ATE-01": Cpu,
  "AUTO-PACK-01": Package,
};

function PassRateBar({ rate }: { rate: number }) {
  const color = rate >= 95 ? "var(--ok)" : rate >= 85 ? "var(--warn)" : "var(--danger)";
  return (
    <div className="passrate-bar" title={`${rate}%`}>
      <div className="passrate-fill" style={{ width: `${rate}%`, background: color }} />
      <span className="passrate-label" style={{ color }}>{rate}%</span>
    </div>
  );
}

function StationCard({ station }: { station: StationData }) {
  const Icon = STATION_ICONS[station.code] || Cpu;
  const isOnline = station.status === "running" || station.todayTotal > 0;
  const hasDefect = station.todayFail > 0 || station.todayNg > 0;
  const borderColor = hasDefect ? "var(--warn)" : isOnline ? "var(--ok)" : "var(--muted)";

  return (
    <div
      className="manu-station-card"
      style={{ borderColor, opacity: isOnline ? 1 : 0.6 }}
    >
      <div className="manu-station-header">
        <Icon size={22} />
        <span className="manu-station-name">{station.nameZh}</span>
      </div>
      {station.equipmentCode && (
        <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>
          {station.equipmentCode}
        </div>
      )}
      <div className="manu-station-stats">
        <div className="manu-stat-row">
          <span className="manu-stat-label">产出</span>
          <span className="manu-stat-value ok">{station.todayTotal}</span>
        </div>
        <div className="manu-stat-row">
          <span className="manu-stat-label">良品</span>
          <span className="manu-stat-value ok">{station.todayPass}</span>
        </div>
        <div className="manu-stat-row">
          <span className="manu-stat-label">不良</span>
          <span className="manu-stat-value" style={{ color: hasDefect ? "var(--danger)" : "var(--muted)" }}>
            {station.todayFail + station.todayNg}
          </span>
        </div>
      </div>
      <PassRateBar rate={station.passRate} />
      <div className="manu-station-footer">
        {isOnline ? (
          <span className="manu-status-dot ok" />
        ) : (
          <span className="manu-status-dot muted" />
        )}
        <span className="manu-station-time">
          {station.lastEventAt
            ? new Date(station.lastEventAt).toLocaleTimeString("zh-CN")
            : "—"}
        </span>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: EventData }) {
  const isPass = event.result === "pass";
  return (
    <tr>
      <td style={{ padding: "6px 10px", fontSize: 12, color: "var(--muted)" }}>
        {new Date(event.occurredAt).toLocaleTimeString("zh-CN")}
      </td>
      <td style={{ padding: "6px 10px", fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
        {event.stationName}
      </td>
      <td style={{ padding: "6px 10px" }}>
        <span className={`badge tone-${isPass ? "ok" : "danger"}`} style={{ fontSize: 11 }}>
          {isPass ? "PASS" : "FAIL"}
        </span>
      </td>
      <td style={{ padding: "6px 10px", fontSize: 11, color: "var(--muted)" }}>
        {event.eventType}
      </td>
    </tr>
  );
}

export function AutoLineDashboard({ locale }: { locale: Locale }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [selectedStation, setSelectedStation] = useState<StationData | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const token = sessionStorage.getItem("auth_token");
      const res = await fetch(AUTO_API, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("API error");
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setData(json.data);
      setConnected(true);
      setLastRefresh(new Date());
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const orderedStations: StationData[] = [];
  if (data) {
    const stationMap = new Map(data.stations.map(s => [s.code, s]));
    for (const code of STATION_ORDER) {
      const s = stationMap.get(code);
      if (s) orderedStations.push(s);
    }
  }

  const totals = data?.todayTotals;

  if (selectedStation) {
    return (
      <div className="screen-stack">
        <div className="surface-panel" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="action-button" onClick={() => setSelectedStation(null)}>
            ← 返回
          </button>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{selectedStation.nameZh}</h2>
          <span className="badge tone-info">{selectedStation.code}</span>
        </div>
        <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div className="stat-card">
            <span>今日产出</span>
            <strong style={{ fontSize: 36, color: "var(--ok)" }}>{selectedStation.todayTotal}</strong>
          </div>
          <div className="stat-card">
            <span>良品</span>
            <strong style={{ fontSize: 36, color: "var(--ok)" }}>{selectedStation.todayPass}</strong>
          </div>
          <div className="stat-card">
            <span>不良</span>
            <strong style={{ fontSize: 36, color: selectedStation.todayFail > 0 ? "var(--danger)" : "var(--muted)" }}>
              {selectedStation.todayFail + selectedStation.todayNg}
            </strong>
          </div>
          <div className="stat-card">
            <span>良率</span>
            <strong style={{ fontSize: 36, color: selectedStation.passRate >= 95 ? "var(--ok)" : "var(--warn)" }}>
              {selectedStation.passRate}%
            </strong>
          </div>
        </div>
        <div className="surface-panel">
          <div className="section-header"><h2>最近事件</h2></div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>时间</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>结果</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>类型</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentEvents
                .filter(e => e.stationCode === selectedStation.code)
                .slice(0, 20)
                .map(e => (
                  <tr key={e.id}>
                    <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted)" }}>
                      {new Date(e.occurredAt).toLocaleTimeString("zh-CN")}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <span className={`badge tone-${e.result === "pass" ? "ok" : "danger"}`}>
                        {e.result.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted)" }}>{e.eventType}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>自动线实时监控</h2>
            <p>{data?.line.nameZh} — {data?.line.code}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: connected ? "#052e16" : "#2d0a0a",
              color: connected ? "var(--ok)" : "var(--danger)",
              padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
            }}>
              {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {connected ? "在线" : "离线"}
            </div>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {lastRefresh.toLocaleTimeString("zh-CN")}
            </span>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat-card">
          <span>今日总产出</span>
          <strong style={{ fontSize: 28, color: "var(--accent)" }}>
            {totals?.total?.toLocaleString() ?? "—"}
          </strong>
        </div>
        <div className="stat-card">
          <span>良品</span>
          <strong style={{ fontSize: 28, color: "var(--ok)" }}>
            {totals?.passed?.toLocaleString() ?? "—"}
          </strong>
        </div>
        <div className="stat-card">
          <span>不良</span>
          <strong style={{ fontSize: 28, color: (totals?.failed ?? 0) > 0 ? "var(--danger)" : "var(--muted)" }}>
            {totals?.failed?.toLocaleString() ?? "—"}
          </strong>
        </div>
        <div className="stat-card">
          <span>良率</span>
          <strong style={{
            fontSize: 28,
            color: Number(totals?.yield ?? 100) >= 95 ? "var(--ok)" : "var(--warn)"
          }}>
            {totals?.yield ?? "—"}%
          </strong>
        </div>
      </div>

      {/* Station Flow (left to right) */}
      <div className="surface-panel" style={{ overflowX: "auto" }}>
        <div className="section-header">
          <h2>工艺流程</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>点击工站查看详情</span>
        </div>
        {loading && orderedStations.length === 0 ? (
          <div className="placeholder-view">加载中...</div>
        ) : (
          <div style={{ display: "flex", alignItems: "stretch", gap: 4, padding: "16px 0", minWidth: 1200 }}>
            {orderedStations.map((station, i) => (
              <div key={station.code} style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 80 }}>
                <div
                  onClick={() => setSelectedStation(station)}
                  className="manu-flow-card"
                  style={{
                    flex: 1,
                    borderColor: station.todayFail > 0 ? "var(--warn)" : station.todayTotal > 0 ? "var(--ok)" : "var(--border)",
                  }}
                >
                  <div className="manu-flow-icon">
                    {createElement(STATION_ICONS[station.code] || Cpu, { size: 20 })}
                  </div>
                  <div className="manu-flow-name">{station.nameZh}</div>
                  <div className="manu-flow-total">{station.todayTotal}</div>
                  {station.todayFail > 0 && (
                    <div className="manu-flow-fail">{station.todayFail} NG</div>
                  )}
                </div>
                {i < orderedStations.length - 1 && (
                  <ChevronRight size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Station Cards Grid */}
      <div className="surface-panel">
        <div className="section-header"><h2>各工站详情</h2></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {orderedStations.map(station => (
            <StationCard key={station.code} station={station} />
          ))}
        </div>
      </div>

      {/* Recent Events Table */}
      <div className="surface-panel">
        <div className="section-header"><h2>最近事件</h2></div>
        <div style={{ maxHeight: 300, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>时间</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>工站</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>结果</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>类型</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentEvents.map(e => <EventRow key={e.id} event={e} />)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
