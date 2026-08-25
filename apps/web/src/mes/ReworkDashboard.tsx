import { useState, useEffect, useCallback } from "react";
import {
  Wifi, WifiOff, Wrench, CheckCircle, XCircle, Clock,
} from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";

const REWORK_API = "/api/mes/rework/dashboard";

interface ReworkLine {
  id: number;
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  status: string;
}

interface TodayStats {
  total: number;
  repaired: number;
  scrapped: number;
  inProgress: number;
}

interface OpenRecord {
  id: number;
  sn: string;
  sourceStation: string | null;
  sourceLine: string | null;
  defectCode: string | null;
  defectReason: string | null;
  repairCount: number;
  operator: string | null;
  createdAt: string;
}

interface RecentRecord {
  id: number;
  sn: string;
  sourceStation: string | null;
  sourceLine: string | null;
  defectCode: string | null;
  repairCount: number;
  result: string;
  operator: string | null;
  repairedAt: string | null;
  createdAt: string;
}

interface StationData {
  id: number;
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  status: string;
  todayEvents: number;
}

interface DashboardData {
  line: ReworkLine;
  todayStats: TodayStats;
  openRecords: OpenRecord[];
  recentRecords: RecentRecord[];
  stations: StationData[];
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong style={{ fontSize: 32, color: color ?? "var(--accent)" }}>{value}</strong>
    </div>
  );
}

function RecordRow({ record, isOpen }: { record: OpenRecord | RecentRecord; isOpen: boolean }) {
  const r = record as OpenRecord;
  const isRepaired = "result" in record && record.result === "repaired";
  const isScrapped = "result" in record && record.result === "scrapped";

  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ padding: "8px 12px", fontSize: 12 }}>
        {((record as RecentRecord).repairedAt
          ? new Date((record as RecentRecord).repairedAt!)
          : new Date(record.createdAt)).toLocaleTimeString("zh-CN")}
      </td>
      <td style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
        {record.sn}
      </td>
      <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted)" }}>
        {record.sourceStation ?? "—"}
      </td>
      <td style={{ padding: "8px 12px", fontSize: 11, color: "var(--muted)" }}>
        {record.defectCode ?? "—"}
      </td>
      <td style={{ padding: "8px 12px", fontSize: 12 }}>
        <span style={{ color: "var(--warn)", fontSize: 11 }}>
          第{record.repairCount}次
        </span>
      </td>
      <td style={{ padding: "8px 12px", fontSize: 12 }}>
        {isOpen ? (
          <span className="badge tone-warn" style={{ fontSize: 11 }}>待修</span>
        ) : isRepaired ? (
          <span className="badge tone-ok" style={{ fontSize: 11 }}>已修复</span>
        ) : (
          <span className="badge tone-danger" style={{ fontSize: 11 }}>报废</span>
        )}
      </td>
      <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--muted)" }}>
        {record.operator ?? "—"}
      </td>
    </tr>
  );
}

export function ReworkDashboard({ locale }: { locale: Locale }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(REWORK_API);
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

  const stats = data?.todayStats;
  const station = data?.stations[0];

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>回修站实时监控</h2>
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
        <StatCard label="今日返修总数" value={stats?.total ?? 0} />
        <StatCard label="已修复" value={stats?.repaired ?? 0} color="var(--ok)" />
        <StatCard label="报废" value={stats?.scrapped ?? 0} color="var(--danger)" />
        <StatCard label="待处理" value={stats?.inProgress ?? 0} color="var(--warn)" />
      </div>

      {/* Station Status */}
      {station && (
        <div className="surface-panel">
          <div className="section-header">
            <h2>回修站状态</h2>
            <span className={`badge ${station.status === "running" ? "tone-ok" : "tone-muted"}`}>
              {station.status === "running" ? "运行中" : "空闲"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 0" }}>
            <Wrench size={32} style={{ color: "var(--accent)" }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{station.nameZh}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{station.code}</div>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>
                {station.todayEvents}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>今日处理次数</div>
            </div>
          </div>
        </div>
      )}

      {/* Open Records */}
      <div className="surface-panel">
        <div className="section-header">
          <h2>待处理 <span style={{ color: "var(--warn)", fontSize: 14 }}>{data?.openRecords.length ?? 0}</span></h2>
        </div>
        {loading && data?.openRecords.length === 0 ? (
          <div className="placeholder-view">加载中...</div>
        ) : data?.openRecords.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            暂无待处理返修记录
          </div>
        ) : (
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>进入时间</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>SN</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>来源工站</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>缺陷代码</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>次数</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>状态</th>
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>操作员</th>
                </tr>
              </thead>
              <tbody>
                {data?.openRecords.map(r => (
                  <RecordRow key={r.id} record={r} isOpen={true} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Completed */}
      <div className="surface-panel">
        <div className="section-header"><h2>最近完成</h2></div>
        <div style={{ maxHeight: 280, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>完成时间</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>SN</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>来源</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>缺陷</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>次数</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>结果</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>操作员</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentRecords.map(r => (
                <RecordRow key={r.id} record={r} isOpen={false} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
