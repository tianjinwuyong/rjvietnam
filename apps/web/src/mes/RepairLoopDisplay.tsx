import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi, type StationEvent } from "../api/mes";

type RepairLoopDisplayProps = { locale: Locale };

const copy = {
  "zh-CN": {
    title: "维修闭环监控", subtitle: "MES 只读视图：状态、领取、SLA、返回和离线同步",
    refresh: "刷新", loading: "加载中…", offline: "MES 暂不可用", noData: "暂无维修事件",
    events: "维修事件", active: "活动 NG", overdue: "SLA 超时", outbox: "离线待同步",
    source: "来源", status: "状态", serial: "SN", station: "工站", time: "时间",
  },
  "en-US": {
    title: "Repair loop monitor", subtitle: "MES read-only view: status, pickup, SLA, return and offline sync",
    refresh: "Refresh", loading: "Loading…", offline: "MES unavailable", noData: "No repair events",
    events: "Repair events", active: "Active NG", overdue: "SLA breached", outbox: "Outbox pending",
    source: "Source", status: "Status", serial: "SN", station: "Station", time: "Time",
  },
  "vi-VN": {
    title: "Giám sát vòng sửa chữa", subtitle: "Chế độ chỉ đọc MES: trạng thái, nhận, SLA, trả và đồng bộ ngoại tuyến",
    refresh: "Làm mới", loading: "Đang tải…", offline: "MES không khả dụng", noData: "Chưa có sự kiện sửa chữa",
    events: "Sự kiện sửa chữa", active: "NG đang hoạt động", overdue: "Quá SLA", outbox: "Outbox chờ đồng bộ",
    source: "Nguồn", status: "Trạng thái", serial: "SN", station: "Trạm", time: "Thời gian",
  },
} as const;

export function RepairLoopDisplay({ locale }: RepairLoopDisplayProps) {
  const labels = copy[locale] ?? copy["en-US"];
  const [events, setEvents] = useState<StationEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await mesApi.getEvents({ eventType: "REPAIR", limit: 100 });
      setEvents(response.items ?? []);
    } catch {
      setEvents([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const active = events.filter((event) => !["CLOSED", "PASS"].includes(String(event.result).toUpperCase())).length;
  const overdue = events.filter((event) => String(event.eventType).toUpperCase().includes("SLA_BREACH")).length;

  return (
    <section aria-labelledby="repair-loop-title" style={{ display: "grid", gap: 14 }}>
      <header className="surface-panel" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
        <div>
          <h3 id="repair-loop-title" style={{ margin: 0, fontSize: 18 }}>{labels.title}</h3>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 12 }}>{labels.subtitle}</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} aria-label={labels.refresh}
          style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", borderRadius: 8, padding: "8px 12px", cursor: loading ? "wait" : "pointer" }}>
          {loading ? labels.loading : labels.refresh}
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {[[labels.events, events.length, "var(--info)"], [labels.active, active, "var(--warning)"], [labels.overdue, overdue, "var(--danger)"], [labels.outbox, "—", "var(--muted)"]].map(([label, value, color]) => (
          <div key={String(label)} className="surface-panel" style={{ borderTop: `3px solid ${color}` }}>
            <div style={{ color: "var(--muted)", fontSize: 11 }}>{label}</div>
            <strong style={{ display: "block", marginTop: 6, fontSize: 24 }}>{value}</strong>
          </div>
        ))}
      </div>

      <div className="surface-panel" style={{ overflowX: "auto" }}>
        {error && <div role="status" style={{ color: "var(--warning)", marginBottom: 10 }}>{labels.offline}</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr>{[labels.serial, labels.source, labels.station, labels.status, labels.time].map((heading) => <th key={heading} scope="col" style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--border)" }}>{heading}</th>)}</tr></thead>
          <tbody>{events.map((event) => <tr key={event.id}><td style={{ padding: 8 }}><code>{event.pcbSerial || "—"}</code></td><td style={{ padding: 8 }}>{event.traceKey || "MES"}</td><td style={{ padding: 8 }}>{event.stationCode}</td><td style={{ padding: 8 }}>{event.result}</td><td style={{ padding: 8 }}>{event.occurredAt ? new Date(event.occurredAt).toLocaleString(locale) : "—"}</td></tr>)}
            {events.length === 0 && <tr><td colSpan={5} style={{ padding: 22, textAlign: "center", color: "var(--muted)" }}>{labels.noData}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
