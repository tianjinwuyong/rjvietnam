import { useState, useEffect, useMemo } from "react";
import { pdaApi, type PdaHeartbeat, type PdaDevice } from "../api/pda";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

const S = {
  wrapper: { padding: "16px" },
  statsRow: { display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" as const },
  statCard: (bg: string) => ({
    flex: "1 1 140px", background: bg, borderRadius: "8px", padding: "12px 16px", minWidth: "120px",
  }),
  statLabel: { fontSize: "12px", color: "var(--muted)", marginBottom: "4px" },
  statValue: { fontSize: "24px", fontWeight: "700" as const, color: "var(--text-primary)" },
  searchBar: {
    display: "flex", gap: "8px", marginBottom: "16px", alignItems: "center" as const,
  },
  input: {
    flex: 1, padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)",
    background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "14px",
  },
  select: {
    padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)",
    background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: "14px",
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" },
  card: {
    background: "var(--surface-2)", borderRadius: "8px", border: "1px solid var(--border)",
    padding: "14px", position: "relative" as const,
  },
  cardHeader: { display: "flex", alignItems: "center" as const, gap: "10px", marginBottom: "10px" },
  indicator: (online: boolean) => ({
    width: "10px", height: "10px", borderRadius: "50%",
    background: online ? "var(--ok)" : "var(--danger)",
    boxShadow: online ? "0 0 6px var(--ok)" : "none",
    flexShrink: 0,
  }),
  deviceCode: { fontSize: "15px", fontWeight: "600" as const, color: "var(--text-primary)" },
  model: { fontSize: "12px", color: "var(--muted)", marginLeft: "8px" },
  badge: (bg: string) => ({
    fontSize: "11px", padding: "2px 8px", borderRadius: "10px", background: bg,
    color: "#fff", marginLeft: "auto" as const,
  }),
  infoRow: { display: "flex", justifyContent: "space-between" as const, fontSize: "13px", padding: "3px 0", color: "var(--text-primary)" },
  infoLabel: { color: "var(--muted)" },
  empty: { textAlign: "center" as const, padding: "48px", color: "var(--muted)", fontSize: "14px" },
  error: { textAlign: "center" as const, padding: "24px", color: "var(--danger)", fontSize: "14px" },
  loading: { textAlign: "center" as const, padding: "48px", color: "var(--muted)", fontSize: "14px" },
  barWrap: { display: "flex", gap: "8px", alignItems: "center" as const, marginTop: "12px", marginBottom: "16px" },
  barTrack: { flex: 1, background: "var(--bg-secondary)", borderRadius: "4px", height: "8px" },
  bar: (pct: number, color: string) => ({
    height: "8px", borderRadius: "4px", background: color, width: `${Math.max(pct, 2)}%`,
    transition: "width 0.5s ease",
  }),
  barLabel: { fontSize: "11px", color: "var(--muted)", minWidth: "60px" },
};

export function PdaOnlineMonitor({ locale }: { locale: Locale }) {
  const [heartbeats, setHeartbeats] = useState<PdaHeartbeat[]>([]);
  const [devices, setDevices] = useState<PdaDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const fetchData = async () => {
    try {
      const [hbRes, devRes] = await Promise.all([
        pdaApi.getHeartbeats(),
        pdaApi.getDevices({ limit: 200 }),
      ]);
      setHeartbeats(hbRes.heartbeats ?? []);
      setDevices(devRes.items ?? []);
      setError(null);
    } catch (e) {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 10000);
    return () => clearInterval(iv);
  }, []);

  const items = useMemo(() => {
    const hbMap = new Map<string, PdaHeartbeat>();
    heartbeats.forEach((h) => hbMap.set(h.deviceCode, h));

    let list = devices.map((d) => {
      const hb = hbMap.get(d.deviceCode);
      return { device: d, heartbeat: hb ?? null, online: !!hb?.online };
    });

    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(
        (x) =>
          x.device.deviceCode.toLowerCase().includes(q) ||
          x.device.deviceModel.toLowerCase().includes(q) ||
          (x.device.lineCode ?? "").toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      if (statusFilter === "online") list = list.filter((x) => x.online);
      else if (statusFilter === "offline") list = list.filter((x) => !x.online);
      else list = list.filter((x) => x.device.deviceStatus === statusFilter);
    }
    list.sort((a, b) =>
      a.online === b.online
        ? a.device.deviceCode < b.device.deviceCode ? -1 : 1
        : a.online ? -1 : 1
    );
    return list;
  }, [heartbeats, devices, searchQ, statusFilter]);

  const stats = useMemo(() => {
    const total = devices.length;
    const online = heartbeats.filter((h) => h.online).length;
    const offline = total - online;
    const inRepair = devices.filter((d) => d.deviceStatus === "IN_REPAIR").length;
    const assigned = devices.filter((d) => d.deviceStatus === "ASSIGNED").length;
    return { total, online, offline, inRepair, assigned };
  }, [devices, heartbeats]);

  const now = Date.now();

  if (loading) return <div style={S.loading}>加载中...</div>;
  if (error) return <div style={S.error}>{error}</div>;

  return (
    <div style={S.wrapper}>
      {/* Stats header */}
      <div style={S.statsRow}>
        {[
          { label: "设备总数", value: stats.total, bg: "var(--accent-cyan)" },
          { label: "在线", value: stats.online, bg: "var(--ok)" },
          { label: "离线", value: stats.offline, bg: "var(--danger)" },
          { label: "维修中", value: stats.inRepair, bg: "var(--warn)" },
          { label: "已领用", value: stats.assigned, bg: "var(--accent)" },
        ].map((s) => (
          <div key={s.label} style={S.statCard(s.bg)}>
            <div style={S.statLabel}>{s.label}</div>
            <div style={S.statValue}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Online rate bar */}
      {stats.total > 0 && (
        <div style={S.barWrap}>
          <span style={S.barLabel}>在线率: {stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 0}%</span>
          <div style={S.barTrack}>
            <div style={S.bar((stats.online / stats.total) * 100, "var(--ok)")} />
          </div>
        </div>
      )}

      {/* Search & filter */}
      <div style={S.searchBar}>
        <input
          style={S.input}
          placeholder="搜索设备编号/型号/产线..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <select style={S.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">全部</option>
          <option value="online">在线</option>
          <option value="offline">离线</option>
          <option value="ASSIGNED">已领用</option>
          <option value="IN_REPAIR">维修中</option>
          <option value="IN_STOCK">在库</option>
        </select>
      </div>

      {/* Device grid */}
      {items.length === 0 ? (
        <div style={S.empty}>暂无设备</div>
      ) : (
        <div style={S.grid}>
          {items.map(({ device, heartbeat, online }) => {
            const lastSeen = heartbeat?.lastSeen;
            const msAgo = lastSeen ? now - new Date(lastSeen).getTime() : Infinity;
            const minAgo = Math.round(msAgo / 60000);
            const timeLabel =
              online && msAgo < 30000
                ? "在线"
                : minAgo < 60
                  ? `${minAgo}分钟前`
                  : `${Math.round(minAgo / 60)}小时前`;

            const statusColor: Record<string, string> = {
              IN_STOCK: "var(--accent-cyan)", ASSIGNED: "var(--ok)",
              IN_REPAIR: "var(--warn)", LOST: "var(--danger)",
              DAMAGED: "var(--danger)", RETIRED: "var(--muted)", QUARANTINED: "var(--danger)",
            };

            return (
              <div key={device.id} style={S.card}>
                <div style={S.cardHeader}>
                  <div style={S.indicator(online)} />
                  <span style={S.deviceCode}>{device.deviceCode}</span>
                  <span style={S.model}>{device.deviceModel}</span>
                  <span style={S.badge(statusColor[device.deviceStatus] ?? "var(--muted)")}>
                    {device.deviceStatus}
                  </span>
                </div>
                <div style={S.infoRow}>
                  <span style={S.infoLabel}>最后在线</span>
                  <span>{timeLabel}</span>
                </div>
                {device.lineCode && (
                  <div style={S.infoRow}>
                    <span style={S.infoLabel}>产线</span>
                    <span>{device.lineCode}</span>
                  </div>
                )}
                {device.assignedTo && (
                  <div style={S.infoRow}>
                    <span style={S.infoLabel}>领用人</span>
                    <span>{device.assignedTo}</span>
                  </div>
                )}
                {device.appVersion && (
                  <div style={S.infoRow}>
                    <span style={S.infoLabel}>版本</span>
                    <span>{device.appVersion}</span>
                  </div>
                )}
                {heartbeat?.batteryPct != null && (
                  <div style={S.infoRow}>
                    <span style={S.infoLabel}>电量</span>
                    <span style={{ color: heartbeat.batteryPct < 20 ? "var(--danger)" : "var(--text-primary)" }}>
                      {heartbeat.batteryPct}%
                    </span>
                  </div>
                )}
                {device.serialNo && (
                  <div style={S.infoRow}>
                    <span style={S.infoLabel}>序列号</span>
                    <span>{device.serialNo}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
