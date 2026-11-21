import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, WifiOff } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient, type ListEnvelope } from "../api/client";

type ExchangeEvent = {
  event_id: string;
  direction: string;
  event_type: string;
  entity_type: string;
  entity_key: string;
  source_node: string;
  destination_node: string;
  delivery_state: string;
  attempt_count: number;
  last_error?: string;
  created_at: string;
  acknowledged_at?: string;
};
type Conflict = {
  id: number;
  event_id: string;
  status: string;
  detected_at: string;
  reason?: string;
};
type OperationsSnapshot = {
  generatedAt: string;
  health: {
    mes: boolean;
    wms: boolean;
    stationsOnline: number;
    stationsTotal: number;
    pdaDevices24h: number;
    exchangePending: number;
    exchangeQuarantined: number;
  };
  workOrders: Array<{
    id: number;
    code: string;
    status: string;
    plannedQty: number;
    completedQty: number;
  }>;
  stations: Array<{
    stationCode: string;
    lineCode?: string;
    online: boolean;
    lastSeen: string;
  }>;
  pda: Array<{
    id: number;
    scanValue: string;
    scanType: string;
    occurredAt: string;
  }>;
  wms: Record<string, number>;
};
const T = {
  "zh-CN": {
    title: "MES ↔ WMS 同步中心",
    sub: "监控事件积压、重试、隔离和数据冲突",
    refresh: "刷新",
    all: "全部",
    pending: "待发送",
    delivering: "等待确认",
    ack: "已确认",
    quarantine: "已隔离",
    conflicts: "待处理冲突",
    event: "事件",
    entity: "对象",
    flow: "流向",
    state: "状态",
    attempts: "尝试",
    time: "时间",
    error: "错误",
    action: "处理",
    keep: "保留原数据",
    accept: "采用新数据",
    empty: "暂无记录",
    offline: "无法连接权威服务",
    reason: "人工核对后处理",
  },
  "vi-VN": {
    title: "Trung tâm đồng bộ MES ↔ WMS",
    sub: "Theo dõi tồn đọng, thử lại, cách ly và xung đột dữ liệu",
    refresh: "Làm mới",
    all: "Tất cả",
    pending: "Chờ gửi",
    delivering: "Chờ xác nhận",
    ack: "Đã xác nhận",
    quarantine: "Đã cách ly",
    conflicts: "Xung đột chờ xử lý",
    event: "Sự kiện",
    entity: "Đối tượng",
    flow: "Luồng",
    state: "Trạng thái",
    attempts: "Lần thử",
    time: "Thời gian",
    error: "Lỗi",
    action: "Xử lý",
    keep: "Giữ dữ liệu cũ",
    accept: "Dùng dữ liệu mới",
    empty: "Không có dữ liệu",
    offline: "Không thể kết nối dịch vụ chuẩn",
    reason: "Đã đối chiếu thủ công",
  },
  "en-US": {
    title: "MES ↔ WMS synchronization center",
    sub: "Monitor event backlog, retries, quarantine and data conflicts",
    refresh: "Refresh",
    all: "All",
    pending: "Pending",
    delivering: "Awaiting ACK",
    ack: "Acknowledged",
    quarantine: "Quarantined",
    conflicts: "Pending conflicts",
    event: "Event",
    entity: "Entity",
    flow: "Flow",
    state: "State",
    attempts: "Attempts",
    time: "Time",
    error: "Error",
    action: "Action",
    keep: "Keep existing",
    accept: "Accept incoming",
    empty: "No records",
    offline: "Authoritative service unavailable",
    reason: "Manually reviewed",
  },
} as const;

const PDA_DEVICE_SLOTS = [
  "PDA-IQC-01",
  "PDA-IQC-02",
  "PDA-IQC-03",
  "PDA-IQC-04",
  "PDA-IQC-05",
] as const;
const RECEIVING_DEVICE_SLOTS = [
  "PDA-RECV-01",
  "PDA-RECV-02",
  "PDA-RECV-03",
  "PDA-RECV-04",
  "PDA-RECV-05",
] as const;
const PDA_REALTIME_ROLE = "IQC检验员";

function ReceivingPdaPanel({ ops, devices }: { ops: OperationsSnapshot | null; devices: any[] }) {
  return (
    <section className="surface-panel">
      <div className="section-header">
        <div>
          <h3>多PDA实时收料</h3>
          <p>WMS 分配收料设备，支持最多 5 台 PDA 并行收料。</p>
        </div>
        <span className="badge badge-info">角色：收料员</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
          gap: 10,
        }}
      >
        {RECEIVING_DEVICE_SLOTS.map((device, index) => {
          const event = ops?.pda[index];
          const managed = devices.find((item) => item.deviceId === device);
          const online = managed ? Boolean(managed.online) : Boolean(event) || index === 0;
          return (
            <div
              key={device}
              style={{
                border: `1px solid ${online ? "#86efac" : "#cbd5e1"}`,
                borderRadius: 9,
                padding: 12,
                background: online ? "#f0fdf4" : "#f8fafc",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <strong>{device}</strong>
                <span className={`badge badge-${online ? "ok" : "danger"}`}>
                  {online ? "ONLINE" : "OFFLINE"}
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#047857" }}>
                角色：收料员
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>
                当前批次：
                <strong>
                  {event?.scanValue || (online ? "等待扫描" : "—")}
                </strong>
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>
                收料员：{(event as any)?.operatorName || "待分配"}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>
                最后心跳：
                {event?.occurredAt
                  ? new Date(event.occurredAt).toLocaleTimeString()
                  : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function WmsSyncHealth({ locale }: { locale: Locale }) {
  const c = T[locale],
    [events, setEvents] = useState<ExchangeEvent[]>([]),
    [conflicts, setConflicts] = useState<Conflict[]>([]),
    [ops, setOps] = useState<OperationsSnapshot | null>(null),
    [receivingPdas, setReceivingPdas] = useState<any[]>([]),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, x] = await Promise.all([
        apiClient.get<ListEnvelope<ExchangeEvent>>(
          "/wms/mes-exchange/events?state=ALL&limit=500",
        ),
        apiClient.get<ListEnvelope<Conflict>>(
          "/wms/mes-exchange/conflicts?status=PENDING",
        ),
      ]);
      const snapshot = await apiClient.get<OperationsSnapshot>(
        `/api/integration/operations-snapshot${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`,
      );
      const receiving = await apiClient
        .get<{ items: any[] }>("/wms/pda-devices?pool=RECEIVING")
        .catch(() => ({ items: [] }));
      setEvents(e.items);
      setConflicts(x.items);
      setOps(snapshot);
      setReceivingPdas(receiving.items || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : c.offline);
    } finally {
      setLoading(false);
    }
  }, [c.offline, search]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [load]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        ["PENDING", "DELIVERING", "ACKNOWLEDGED", "QUARANTINED"].map((s) => [
          s,
          events.filter((e) => e.delivery_state === s).length,
        ]),
      ),
    [events],
  );
  const decide = async (
    id: number,
    decision: "KEEP_EXISTING" | "ACCEPT_INCOMING",
  ) => {
    try {
      await apiClient.post(`/wms/mes-exchange/conflicts/${id}/decision`, {
        decision,
        reason: c.reason,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="screen-stack">
      <ReceivingPdaPanel ops={ops} devices={receivingPdas} />
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>MES · WMS · Station · PDA 一体化运行中心</h2>
            <p>统一权威数据、事件传递、断网续接和现场状态</p>
          </div>
          <div className="toolbar">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void load();
              }}
              placeholder="SN / 工单 / 批次 / 工位 / 事件"
            />
            <button
              className="action-button"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw size={14} />
              {c.refresh}
            </button>
          </div>
        </div>
        {error && (
          <p style={{ color: "var(--danger)" }}>
            <WifiOff size={14} /> {error}
          </p>
        )}
        {ops && (
          <div className="metric-grid">
            {[
              ["MES", ops.health.mes ? "ONLINE" : "OFFLINE"],
              ["WMS", ops.health.wms ? "ONLINE" : "OFFLINE"],
              [
                "Station",
                `${ops.health.stationsOnline}/${ops.health.stationsTotal}`,
              ],
              ["PDA 24h", ops.health.pdaDevices24h],
              ["待确认事件", ops.health.exchangePending],
              ["隔离事件", ops.health.exchangeQuarantined],
            ].map(([label, value]) => (
              <div className="metric-card" key={String(label)}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}
        <div className="metric-grid">
          {[
            [c.all, events.length],
            [c.pending, counts.PENDING],
            [c.delivering, counts.DELIVERING],
            [c.ack, counts.ACKNOWLEDGED],
            [c.quarantine, counts.QUARANTINED],
            [c.conflicts, conflicts.length],
          ].map(([label, value]) => (
            <div className="metric-card" key={String(label)}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h3>多PDA实时IQC检测</h3>
            <p>支持 3–5 台 PDA 并行显示；数据每 15 秒刷新一次。</p>
          </div>
          <span className="badge badge-info">角色：{PDA_REALTIME_ROLE}</span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: 10,
          }}
        >
          {PDA_DEVICE_SLOTS.map((device, index) => {
            const event = ops?.pda[index];
            const online = Boolean(event) || index === 0;
            return (
              <div
                key={device}
                style={{
                  border: `1px solid ${online ? "#86efac" : "#cbd5e1"}`,
                  borderRadius: 9,
                  padding: 12,
                  background: online ? "#f0fdf4" : "#f8fafc",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <strong>{device}</strong>
                  <span className={`badge badge-${online ? "ok" : "danger"}`}>
                    {online ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "#047857" }}>
                  角色：{PDA_REALTIME_ROLE}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>
                  当前批次：
                  <strong>
                    {event?.scanValue || (online ? "等待扫描" : "—")}
                  </strong>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>
                  状态：{event?.scanType || (online ? "IQC待机" : "未连接")}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>
                  最后心跳：
                  {event?.occurredAt
                    ? new Date(event.occurredAt).toLocaleTimeString()
                    : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {ops && (
        <section className="surface-panel">
          <div className="section-header">
            <h3>统一搜索结果</h3>
            <span>{new Date(ops.generatedAt).toLocaleString()}</span>
          </div>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>来源</th>
                  <th>对象</th>
                  <th>状态</th>
                  <th>时间/进度</th>
                </tr>
              </thead>
              <tbody>
                {ops.workOrders.map((x) => (
                  <tr key={`wo-${x.id}`}>
                    <td>MES</td>
                    <td>{x.code}</td>
                    <td>{x.status}</td>
                    <td>
                      {x.completedQty}/{x.plannedQty}
                    </td>
                  </tr>
                ))}
                {ops.stations.map((x) => (
                  <tr key={`st-${x.stationCode}`}>
                    <td>Station</td>
                    <td>{x.stationCode}</td>
                    <td>
                      <span
                        className={`badge badge-${x.online ? "ok" : "danger"}`}
                      >
                        {x.online ? "ONLINE" : "OFFLINE"}
                      </span>
                    </td>
                    <td>{new Date(x.lastSeen).toLocaleString()}</td>
                  </tr>
                ))}
                {ops.pda.map((x) => (
                  <tr key={`pda-${x.id}`}>
                    <td>PDA</td>
                    <td>{x.scanValue}</td>
                    <td>{x.scanType}</td>
                    <td>{new Date(x.occurredAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="surface-panel">
        <div className="section-header">
          <h3>
            <AlertTriangle size={16} /> {c.conflicts}
          </h3>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>{c.event}</th>
                <th>{c.time}</th>
                <th>{c.action}</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.length ? (
                conflicts.map((x) => (
                  <tr key={x.id}>
                    <td>{x.id}</td>
                    <td>{x.event_id}</td>
                    <td>{new Date(x.detected_at).toLocaleString()}</td>
                    <td>
                      <button
                        onClick={() => void decide(x.id, "KEEP_EXISTING")}
                      >
                        {c.keep}
                      </button>{" "}
                      <button
                        onClick={() => void decide(x.id, "ACCEPT_INCOMING")}
                      >
                        {c.accept}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>
                    <CheckCircle2 size={14} /> {c.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{c.event}</th>
                <th>{c.entity}</th>
                <th>{c.flow}</th>
                <th>{c.state}</th>
                <th>{c.attempts}</th>
                <th>{c.time}</th>
                <th>{c.error}</th>
              </tr>
            </thead>
            <tbody>
              {events.length ? (
                events.map((e) => (
                  <tr key={e.event_id}>
                    <td>
                      {e.event_type}
                      <br />
                      <small>{e.event_id}</small>
                    </td>
                    <td>
                      {e.entity_type}: {e.entity_key}
                    </td>
                    <td>
                      {e.source_node} → {e.destination_node}
                    </td>
                    <td>
                      <span
                        className={`badge badge-${e.delivery_state === "ACKNOWLEDGED" ? "ok" : e.delivery_state === "QUARANTINED" ? "danger" : "warning"}`}
                      >
                        {e.delivery_state}
                      </span>
                    </td>
                    <td>{e.attempt_count}</td>
                    <td>{new Date(e.created_at).toLocaleString()}</td>
                    <td>{e.last_error || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>{c.empty}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
