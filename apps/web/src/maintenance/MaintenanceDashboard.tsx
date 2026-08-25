import { useState, useEffect } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { maintenanceApi } from "../api";
import type { WorkOrder } from "../api/maintenance";

interface Props { locale: Locale; }

interface DashData {
  equipment_by_status: Array<{ status: string; cnt: number }>;
  equipment_by_criticality: Array<{ criticality: string; cnt: number }>;
  work_orders_by_status: Array<{ status: string; cnt: number }>;
  pm_stats_30d: Array<{ result: string; cnt: number }>;
  pm_overdue_count: number;
  recent_work_orders: WorkOrder[];
  cost_trend: Array<{ month: string; total_cost: number; wo_count: number }>;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#22c55e", online: "#22c55e", idle: "#3b82f6", maintenance: "#f59e0b",
  repair: "#ef4444", fault: "#ef4444", offline: "#6b7280", scrapped: "#374151",
};
const STATUS_LABELS: Record<string, string> = {
  active: "运行", online: "运行", idle: "待机", maintenance: "保养", repair: "维修", fault: "故障", offline: "停机", scrapped: "报废",
};
const WO_STATUS_LABELS: Record<string, string> = {
  waiting_to_process: "待处理", received: "已接单", in_processing: "维修中", completed: "已完成", fixed: "已验证", closed: "已关闭",
};

function KpiCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color?: string; icon?: string }) {
  return (
    <div className="surface-panel" style={{ padding: "14px 16px", minWidth: 140, flex: 1 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? "var(--text)", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MiniBar({ data, colorMap, labelMap, height = 120 }: {
  data: Array<{ label: string; value: number }>;
  colorMap?: Record<string, string>;
  labelMap?: Record<string, string>;
  height?: number;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, padding: "0 4px" }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>{d.value}</span>
          <div style={{
            width: "100%", maxWidth: 36, borderRadius: "3px 3px 0 0",
            height: Math.max(4, (d.value / max) * (height - 30)),
            background: colorMap?.[d.label] ?? "var(--primary)",
            transition: "height 0.3s ease",
          }} />
          <span style={{ fontSize: 9, color: "var(--muted)", textAlign: "center", lineHeight: 1.1 }}>
            {labelMap?.[d.label] ?? d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MaintenanceDashboard({ locale }: Props) {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    maintenanceApi.getEquipmentDashboard().then((res: any) => {
      setData(res);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="screen-stack">
        <section className="surface-panel"><div className="section-header"><div><h2>设备管理看板</h2></div></div></section>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[1,2,3,4,5].map(i => <div key={i} className="surface-panel" style={{ flex: 1, minWidth: 140, height: 80 }}><div className="skeleton" style={{ height: 60, width: "100%" }} /></div>)}
        </div>
      </div>
    );
  }

  const totalEquip = data.equipment_by_status.reduce((s, e) => s + Number(e.cnt), 0);
  const activeEquip = data.equipment_by_status.filter(e => ["active", "online"].includes(e.status)).reduce((s, e) => s + Number(e.cnt), 0);
  const faultEquip = data.equipment_by_status.filter(e => ["fault", "repair"].includes(e.status)).reduce((s, e) => s + Number(e.cnt), 0);
  const openWOs = data.work_orders_by_status.filter(w => !["fixed", "closed", "completed"].includes(w.status)).reduce((s, w) => s + Number(w.cnt), 0);
  const totalWOs = data.work_orders_by_status.reduce((s, w) => s + Number(w.cnt), 0);
  const pmCompleted = data.pm_stats_30d.filter(p => p.result === "completed").reduce((s, p) => s + Number(p.cnt), 0);
  const pmTotal = data.pm_stats_30d.reduce((s, p) => s + Number(p.cnt), 0);
  const critA = data.equipment_by_criticality.filter(c => c.criticality === "A").reduce((s, c) => s + Number(c.cnt), 0);

  const equipStatusBars = data.equipment_by_status.map(e => ({ label: e.status, value: Number(e.cnt) }));
  const woStatusBars = data.work_orders_by_status.map(w => ({ label: w.status, value: Number(w.cnt) }));
  const costBars = data.cost_trend.slice(-6).map(c => ({
    label: c.month?.slice(0, 7) ?? "",
    value: Math.round(Number(c.total_cost ?? 0)),
  }));

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header"><div><h2>设备管理看板</h2><p style={{ fontSize: 12, color: "var(--muted)" }}>Equipment Management Dashboard</p></div></div>
      </section>

      {/* KPI Cards */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard icon="🏭" label="设备总数" value={totalEquip} sub={`A级关键: ${critA}台`} />
        <KpiCard icon="✅" label="运行中" value={activeEquip} color="#22c55e" sub={`利用率: ${totalEquip ? Math.round(activeEquip / totalEquip * 100) : 0}%`} />
        <KpiCard icon="🔴" label="故障/维修" value={faultEquip} color="#ef4444" sub="需要关注" />
        <KpiCard icon="🔧" label="待处理工单" value={openWOs} color={openWOs > 0 ? "#f59e0b" : undefined} sub={`总工单: ${totalWOs}`} />
        <KpiCard icon="🛡️" label="30天PM完成" value={`${pmCompleted}/${pmTotal}`} color={pmCompleted < pmTotal ? "#f59e0b" : "#22c55e"} />
        <KpiCard icon="⚠️" label="PM逾期" value={data.pm_overdue_count} color={data.pm_overdue_count > 0 ? "#ef4444" : "#22c55e"} />
      </div>

      {/* Charts Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 13, marginBottom: 8 }}>设备状态分布</h3>
          <MiniBar data={equipStatusBars} colorMap={STATUS_COLORS} labelMap={STATUS_LABELS} />
        </section>
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 13, marginBottom: 8 }}>工单状态分布</h3>
          <MiniBar data={woStatusBars} labelMap={WO_STATUS_LABELS} colorMap={{
            waiting_to_process: "#f59e0b", received: "#3b82f6", in_processing: "#8b5cf6",
            completed: "#22c55e", fixed: "#10b981", closed: "#6b7280",
          }} />
        </section>
        <section className="surface-panel" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 13, marginBottom: 8 }}>月度维修成本 (USD)</h3>
          {costBars.length > 0 ? <MiniBar data={costBars} colorMap={{}} height={120} /> : <div style={{ textAlign: "center", color: "var(--muted)", padding: 24, fontSize: 12 }}>暂无数据</div>}
        </section>
      </div>

      {/* Recent Work Orders */}
      <section className="surface-panel">
        <div className="section-header"><div><h3 style={{ fontSize: 14 }}>最近工单</h3></div></div>
        <div className="table-shell"><table>
          <thead><tr><th>工单号</th><th>设备</th><th>故障描述</th><th>紧急度</th><th>优先级</th><th>状态</th><th>报修时间</th></tr></thead>
          <tbody>
            {(data.recent_work_orders ?? []).map(wo => (
              <tr key={wo.id}>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{wo.wo_no}</td>
                <td style={{ fontSize: 12 }}>{wo.equipment_name ?? wo.equipment_code ?? "-"}</td>
                <td style={{ fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wo.fault_description}</td>
                <td><span className={`badge ${wo.urgency_level === "line_down" ? "badge-danger" : wo.urgency_level === "speed_reduced" ? "badge-warning" : "badge-muted"}`} style={{ fontSize: 10 }}>
                  {wo.urgency_level === "line_down" ? "停线" : wo.urgency_level === "speed_reduced" ? "降速" : wo.urgency_level === "can_continue" ? "可继续" : "计划"}
                </span></td>
                <td><span className={`badge ${wo.priority === "high" ? "badge-danger" : wo.priority === "medium" ? "badge-warning" : "badge-muted"}`} style={{ fontSize: 10 }}>
                  {wo.priority === "high" ? "高" : wo.priority === "medium" ? "中" : "低"}
                </span></td>
                <td><span className={`badge ${["fixed","closed","completed"].includes(wo.status) ? "badge-ok" : wo.status === "in_processing" ? "badge-warning" : "badge-info"}`} style={{ fontSize: 10 }}>
                  {WO_STATUS_LABELS[wo.status] ?? wo.status}
                </span></td>
                <td style={{ fontSize: 11, color: "var(--muted)" }}>{wo.issue_time ? new Date(wo.issue_time).toLocaleString("zh-CN") : "-"}</td>
              </tr>
            ))}
            {(data.recent_work_orders ?? []).length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>暂无工单</td></tr>
            )}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
