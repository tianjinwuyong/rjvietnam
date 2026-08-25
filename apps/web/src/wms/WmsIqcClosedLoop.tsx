import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";

type DashboardData = {
  summary: {
    open_lots: number;
    blocked_lots: number;
    overdue_lots: number;
    waiting_closure: number;
    avg_decision_minutes: number;
  };
  lots: Array<any>;
  dispositions: Array<any>;
  capas: Array<any>;
};

const words = {
  "zh-CN": {
    title: "IQC 物料管理闭环",
    sub: "收货建批 → 风险抽样 → 原始测量 → 质量判定 → 数量分流 → 供应商整改 → 受控关单",
    open: "开放检验批",
    blocked: "冻结批次",
    overdue: "超时批次",
    closing: "等待关单",
    avg: "平均判定分钟",
    lots: "检验批",
    handover: "待确认处置",
    capa: "供应商 CAPA",
    empty: "暂无数据",
    refresh: "刷新",
  },
  "en-US": {
    title: "IQC Material Closed Loop",
    sub: "Receipt lot → Risk sampling → Measurements → Decision → Disposition → Supplier CAPA → Controlled close",
    open: "Open lots",
    blocked: "Blocked",
    overdue: "Overdue",
    closing: "Waiting close",
    avg: "Avg decision min",
    lots: "Inspection lots",
    handover: "Pending disposition",
    capa: "Supplier CAPA",
    empty: "No data",
    refresh: "Refresh",
  },
  "vi-VN": {
    title: "Vòng kín vật liệu IQC",
    sub: "Nhận lô → Lấy mẫu rủi ro → Đo lường → Phán định → Phân luồng → CAPA → Đóng",
    open: "Lô mở",
    blocked: "Bị khóa",
    overdue: "Quá hạn",
    closing: "Chờ đóng",
    avg: "Phút trung bình",
    lots: "Lô kiểm tra",
    handover: "Xử lý chờ nhận",
    capa: "CAPA nhà cung cấp",
    empty: "Không có dữ liệu",
    refresh: "Làm mới",
  },
} as const;

export function WmsIqcClosedLoop({ locale }: { locale: Locale }) {
  const w = words[locale];
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await apiClient.get<DashboardData>("/quality/iqc-loop/dashboard"));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const metrics = [
    [w.open, data?.summary.open_lots ?? 0],
    [w.blocked, data?.summary.blocked_lots ?? 0],
    [w.overdue, data?.summary.overdue_lots ?? 0],
    [w.closing, data?.summary.waiting_closure ?? 0],
    [w.avg, data?.summary.avg_decision_minutes ?? 0],
  ];

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div><h2>{w.title}</h2><p>{w.sub}</p></div>
          <button onClick={() => void load()}>{w.refresh}</button>
        </div>
        {error && <p style={{ color: "#dc2626" }}>{error}</p>}
        <div className="metric-grid">
          {metrics.map(([label, value], index) => (
            <div className="metric-card" key={String(label)} style={{ borderTop: `4px solid ${index === 2 ? "#dc2626" : "#2563eb"}` }}>
              <span>{label}</span><strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <h3>{w.lots}</h3>
        <div className="table-shell"><table>
          <thead><tr><th>Lot</th><th>Supplier</th><th>Material</th><th>Qty</th><th>Risk/Mode</th><th>Sample</th><th>Status</th><th>Due</th></tr></thead>
          <tbody>{data?.lots.length ? data.lots.map((row) => (
            <tr key={row.id}><td>{row.inspection_lot_no}</td><td>{row.supplier_code}</td><td>{row.material_code}</td><td>{row.received_qty} {row.uom}</td><td>{row.risk_level}/{row.inspection_mode}</td><td>{row.sample_size}</td><td>{row.status}</td><td>{new Date(row.due_at).toLocaleString()}</td></tr>
          )) : <tr><td colSpan={8}>{w.empty}</td></tr>}</tbody>
        </table></div>
      </section>

      <section className="surface-panel">
        <h3>{w.handover}</h3>
        <div className="table-shell"><table>
          <thead><tr><th>Document</th><th>Type</th><th>Qty</th><th>Destination</th><th>Status</th></tr></thead>
          <tbody>{data?.dispositions.length ? data.dispositions.map((row) => (
            <tr key={row.id}><td>{row.document_no}</td><td>{row.disposition_type}</td><td>{row.qty}</td><td>{row.destination || "-"}</td><td>{row.status}</td></tr>
          )) : <tr><td colSpan={5}>{w.empty}</td></tr>}</tbody>
        </table></div>
      </section>

      <section className="surface-panel">
        <h3>{w.capa}</h3>
        <div className="table-shell"><table>
          <thead><tr><th>CAPA</th><th>Supplier</th><th>Severity</th><th>Status</th><th>Containment due</th><th>Response due</th></tr></thead>
          <tbody>{data?.capas.length ? data.capas.map((row) => (
            <tr key={row.id}><td>{row.capa_no}</td><td>{row.supplier_code}</td><td>{row.severity}</td><td>{row.status}</td><td>{new Date(row.containment_due_at).toLocaleString()}</td><td>{new Date(row.full_response_due_at).toLocaleString()}</td></tr>
          )) : <tr><td colSpan={6}>{w.empty}</td></tr>}</tbody>
        </table></div>
      </section>
    </div>
  );
}
