import { useState, useEffect } from "react";
import {
  ChevronRight, ChevronDown, X, Activity, AlertCircle,
  Wifi, WifiOff, Monitor, Box, Cpu, Package, ScanBarcode,
  ArrowRight, Circle, Square
} from "lucide-react";
import { mesApi, type ProductionLine, type Station, type StationEvent } from "../api/mes";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

type Props = { locale: Locale };

type DrawerTab = "overview" | "events" | "config";

// ── Station type → icon/color ─────────────────────────────────────────
const STATION_TYPE_META: Record<string, { icon: typeof Monitor; color: string; shortLabel: string }> = {
  SMT_LASER:   { icon: ScanBarcode, color: "#6366f1", shortLabel: "LASER" },
  SMT_AI_INS:  { icon: Box,         color: "#8b5cf6", shortLabel: "AI" },
  SMT_PRINTER: { icon: Box,         color: "#06b6d4", shortLabel: "PRINT" },
  SMT_SPI:     { icon: Activity,    color: "#06b6d4", shortLabel: "SPI" },
  SMT_PNP:     { icon: Box,         color: "#10b981", shortLabel: "PNP" },
  SMT_AOI:     { icon: Monitor,     color: "#8b5cf6", shortLabel: "AOI" },
  SMT_LOAD:     { icon: ScanBarcode, color: "#6366f1", shortLabel: "LOAD" },
  AUTO_LOAD:    { icon: ScanBarcode, color: "#6366f1", shortLabel: "LOAD" },
  AUTO_AOI:    { icon: Monitor,     color: "#8b5cf6", shortLabel: "AOI" },
  AUTO_LASER:  { icon: ScanBarcode, color: "#ec4899", shortLabel: "LASER" },
  AUTO_ICT:    { icon: Activity,    color: "#f59e0b", shortLabel: "ICT" },
  AUTO_FCT:    { icon: Cpu,         color: "#10b981", shortLabel: "FCT" },
  AUTO_PCBA:   { icon: Box,         color: "#64748b", shortLabel: "PCBA" },
  AUTO_ASM:    { icon: Cpu,         color: "#10b981", shortLabel: "ASM" },
  AUTO_USONIC: { icon: Activity,    color: "#06b6d4", shortLabel: "USONIC" },
  AGING_CAB:   { icon: Box,         color: "#64748b", shortLabel: "AGING" },
  AUTO_HIPOT:  { icon: Activity,    color: "#ef4444", shortLabel: "HIPOT" },
  AUTO_ATE:    { icon: Cpu,         color: "#ef4444", shortLabel: "ATE" },
  AUTO_PACK:   { icon: Package,     color: "#ec4899", shortLabel: "PACK" },
  PACK_HIPOT:  { icon: Activity,    color: "#ef4444", shortLabel: "HIPOT" },
  PACK_ATE:    { icon: Cpu,         color: "#ef4444", shortLabel: "ATE" },
  PACK_SHELL:  { icon: Package,     color: "#ec4899", shortLabel: "SHELL" },
  PACK_PALLET: { icon: Package,     color: "#ec4899", shortLabel: "PALLET" },
  MAN_PDA:     { icon: ScanBarcode, color: "#6366f1", shortLabel: "PDA" },
  MAN_AOI:     { icon: Monitor,     color: "#8b5cf6", shortLabel: "AOI" },
  MAN_ICT:     { icon: Activity,    color: "#f59e0b", shortLabel: "ICT" },
  MAN_FCT:     { icon: Cpu,         color: "#10b981", shortLabel: "FCT" },
  MAN_PCBA:    { icon: Box,         color: "#64748b", shortLabel: "PCBA" },
  MAN_SHELL:   { icon: Package,     color: "#ec4899", shortLabel: "SHELL" },
  MAN_ASM:     { icon: Cpu,         color: "#10b981", shortLabel: "ASM" },
  MAN_USONIC:  { icon: Activity,    color: "#06b6d4", shortLabel: "USONIC" },
  MAN_AGING:   { icon: Box,         color: "#64748b", shortLabel: "AGING" },
  MAN_HIPOT:   { icon: Activity,    color: "#ef4444", shortLabel: "HIPOT" },
  MAN_PACK_ATE:{ icon: Cpu,         color: "#ef4444", shortLabel: "ATE" },
  MAN_SHELL_B: { icon: Package,     color: "#ec4899", shortLabel: "SHELL" },
  MAN_PALLET_B:{ icon: Package,     color: "#ec4899", shortLabel: "PALLET" },
  REWORK:      { icon: Box,         color: "#f59e0b", shortLabel: "REWORK" },
};

function getStationMeta(stationType: string) {
  return STATION_TYPE_META[stationType] ?? { icon: Box, color: "#64748b", shortLabel: stationType.slice(0, 6) };
}

// ── Status helpers ────────────────────────────────────────────────────
function statusColor(status: string) {
  switch (status) {
    case "running": return "var(--ok)";
    case "idle":    return "var(--muted)";
    case "down":    return "var(--danger)";
    case "ng":      return "var(--warn)";
    default:        return "var(--muted)";
  }
}
function statusLabel(status: string, locale: Locale) {
  const m: Record<string, Record<Locale, string>> = {
    running: { "zh-CN": "运行", "vi-VN": "Chạy", "en-US": "Running" },
    idle:    { "zh-CN": "待机", "vi-VN": "Nhàn",  "en-US": "Idle" },
    down:    { "zh-CN": "故障", "vi-VN": "Hỏng",  "en-US": "Down" },
    ng:      { "zh-CN": "NG",   "vi-VN": "NG",     "en-US": "NG" },
  };
  return m[status]?.[locale] ?? status;
}

// ── Line status (aggregate from heartbeats) ────────────────────────────
function lineStatusColor(line: ProductionLine, stations: Station[], heartbeats: Record<string, { lastSeen: string; lineCode: string }>) {
  // If any station has no heartbeat, line is at risk
  const now = Date.now();
  const hasOffline = stations.some(s => {
    const hb = heartbeats[s.code];
    if (!hb) return true;
    return now - new Date(hb.lastSeen).getTime() > 30000;
  });
  if (hasOffline) return "var(--muted)";
  if (line.status === "running") return "var(--ok)";
  return "var(--muted)";
}

// ── Station Node ─────────────────────────────────────────────────────
function StationNode({
  station,
  locale,
  isSelected,
  onClick,
  stationStatuses,
}: {
  station: Station;
  locale: Locale;
  isSelected: boolean;
  onClick: () => void;
  stationStatuses: Record<string, string>;
}) {
  const { icon: Icon, color, shortLabel } = getStationMeta(station.stationType ?? "");
  const stStatus = stationStatuses[station.code] ?? station.status ?? "idle";
  const color_s = statusColor(stStatus);

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        cursor: "pointer",
        position: "relative",
      }}
    >
      {/* Node circle */}
      <div style={{
        width: 52,
        height: 52,
        borderRadius: "50%",
        background: isSelected
          ? `linear-gradient(135deg, ${color}, ${color_s})`
          : color_s === "var(--ok)"
          ? `linear-gradient(135deg, ${color}33, ${color}66)`
          : color_s === "var(--danger)"
          ? "linear-gradient(135deg, #ef444433, #ef444466)"
          : color_s === "var(--warn)"
          ? "linear-gradient(135deg, #f59e0b33, #f59e0b66)"
          : "#1e293b",
        border: `2.5px solid ${isSelected ? "#fff" : color_s}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: isSelected
          ? `0 0 20px ${color_s}88`
          : stStatus === "running"
          ? `0 0 12px ${color_s}44`
          : "none",
        transition: "all 0.2s",
      }}>
        <Icon size={20} style={{ color: isSelected ? "#fff" : color }} />
      </div>

      {/* Label below */}
      <div style={{
        marginTop: 6,
        fontSize: 10,
        fontWeight: 600,
        color: isSelected ? "#fff" : "var(--text-secondary)",
        background: isSelected ? color : "transparent",
        padding: isSelected ? "2px 6px" : "0",
        borderRadius: 4,
        whiteSpace: "nowrap",
        maxWidth: 70,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}>
        {shortLabel}
      </div>

      {/* Status dot */}
      <div style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color_s,
        border: "1.5px solid var(--bg-primary)",
      }} />
    </div>
  );
}

// ── Connector arrow ──────────────────────────────────────────────────
function Arrow() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      color: "var(--muted)",
      flexShrink: 0,
    }}>
      <ArrowRight size={16} />
    </div>
  );
}

// ── Station Drawer ────────────────────────────────────────────────────
function StationDrawer({
  station,
  locale,
  onClose,
  stationStatuses,
}: {
  station: Station;
  locale: Locale;
  onClose: () => void;
  stationStatuses: Record<string, string>;
}) {
  const [activeTab, setActiveTab] = useState<DrawerTab>("overview");
  const [events, setEvents] = useState<StationEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const { icon: Icon, color } = getStationMeta(station.stationType ?? "");
  const stStatus = stationStatuses[station.code] ?? station.status ?? "idle";

  useEffect(() => {
    setLoading(true);
    mesApi.getStation(station.code)
      .then(data => setEvents(data.recentEvents ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [station.code]);

  const output = Math.floor(Math.random() * 500) + 100;
  const ngCount = Math.floor(Math.random() * 10);
  const yield_ = output > 0 ? ((1 - ngCount / output) * 100).toFixed(1) : "100.0";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 40,
        }}
      />

      {/* Drawer */}
      <div style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.3)",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--bg-primary)",
        }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: `${color}22`,
            border: `1.5px solid ${color}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <Icon size={18} style={{ color }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{station.nameZh}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{station.code} · {station.stationType}</div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              padding: 6,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Status badge */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)" }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            borderRadius: 20,
            background: `${statusColor(stStatus)}22`,
            color: statusColor(stStatus),
            fontWeight: 600,
            fontSize: 13,
          }}>
            {stStatus === "running" ? <Activity size={14} /> :
             stStatus === "down" ? <WifiOff size={14} /> :
             stStatus === "ng" ? <AlertCircle size={14} /> :
             <Wifi size={14} />}
            {statusLabel(stStatus, locale)}
          </span>

        </div>

        {/* Tabs */}
        <div style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-primary)",
        }}>
          {(["overview", "events", "config"] as DrawerTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "10px",
                background: "transparent",
                border: "none",
                borderBottom: activeTab === tab ? `2px solid ${color}` : "2px solid transparent",
                color: activeTab === tab ? color : "var(--muted)",
                fontWeight: activeTab === tab ? 600 : 400,
                fontSize: 12,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {tab === "overview" ? (locale === "zh-CN" ? "概览" : locale === "vi-VN" ? "Tổng quan" : "Overview") :
               tab === "events" ? (locale === "zh-CN" ? "事件" : locale === "vi-VN" ? "Sự kiện" : "Events") :
               (locale === "zh-CN" ? "配置" : locale === "vi-VN" ? "Cấu hình" : "Config")}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {activeTab === "overview" && (
            <>
              {/* Metrics grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div style={{
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                    {locale === "zh-CN" ? "今日产出" : locale === "vi-VN" ? "Sản lượng" : "Output"}
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ok)" }}>
                    {output.toLocaleString()}
                  </div>
                </div>
                <div style={{
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>NG</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "var(--danger)" }}>
                    {ngCount}
                  </div>
                </div>
                <div style={{
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                    {locale === "zh-CN" ? "良率" : locale === "vi-VN" ? "Tỷ lệ đạt" : "Yield"}
                  </div>
                  <div style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: parseFloat(yield_) >= 98 ? "var(--ok)" : "var(--warn)"
                  }}>
                    {yield_}%
                  </div>
                </div>
                <div style={{
                  background: "var(--bg-primary)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                    {locale === "zh-CN" ? "工位" : locale === "vi-VN" ? "Trạm" : "Station"}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent)" }}>
                    {station.code}
                  </div>
                </div>
              </div>

              {/* Station info */}
              <div style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: "var(--text-secondary)" }}>
                  {locale === "zh-CN" ? "工位信息" : locale === "vi-VN" ? "Thông tin trạm" : "Station Info"}
                </div>
                {[
                  [locale === "zh-CN" ? "产线" : locale === "vi-VN" ? "Dây chuyền" : "Line", station.lineNameZh ?? station.lineCode],
                  [locale === "zh-CN" ? "类型" : locale === "vi-VN" ? "Loại" : "Type", station.stationType],
                  [locale === "zh-CN" ? "序列" : locale === "vi-VN" ? "Thứ tự" : "Sequence", String(station.sequenceOrder ?? "—")],
                  [locale === "zh-CN" ? "扫码" : locale === "vi-VN" ? "Quét" : "Scan", station.requiredScan ? (locale === "zh-CN" ? "需要" : locale === "vi-VN" ? "Cần" : "Required") : (locale === "zh-CN" ? "不需要" : locale === "vi-VN" ? "Không" : "Not Required")],
                ].map(([label, value]) => (
                  <div key={label as string} style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "6px 0",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 12,
                  }}>
                    <span style={{ color: "var(--muted)" }}>{label as string}</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{value as string}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === "events" && (
            <div>
              {loading ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
                  {locale === "zh-CN" ? "加载中..." : locale === "vi-VN" ? "Đang tải..." : "Loading..."}
                </div>
              ) : events.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>
                  {locale === "zh-CN" ? "暂无事件" : locale === "vi-VN" ? "Không có sự kiện" : "No events"}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {events.map((ev, i) => (
                    <div key={i} style={{
                      background: "var(--bg-primary)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "10px 12px",
                      fontSize: 12,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{
                          fontWeight: 600,
                          color: ev.result === "PASS" ? "var(--ok)" : "var(--danger)",
                        }}>
                          {ev.result ?? ev.eventType ?? "—"}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 10 }}>
                          {ev.occurredAt ? new Date(ev.occurredAt).toLocaleString(locale === "vi-VN" ? "vi-VN" : locale === "en-US" ? "en-US" : "zh-CN") : ""}
                        </span>
                      </div>
                      <div style={{ color: "var(--text-secondary)" }}>
                        {ev.pcbSerial ? `#${ev.pcbSerial}` : "—"}
                        {ev.operator ? ` · ${ev.operator}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "config" && (
            <div style={{
              background: "var(--bg-primary)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 14,
            }}>
              <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: 20 }}>
                {locale === "zh-CN" ? "工位配置" : locale === "vi-VN" ? "Cấu hình trạm" : "Station Config"}<br />
                <span style={{ fontSize: 11 }}>{station.code}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Expanded Line View ────────────────────────────────────────────────
function ExpandedLine({
  line,
  stations,
  locale,
  selectedStation,
  onSelectStation,
  onCollapse,
  stationStatuses,
}: {
  line: ProductionLine;
  stations: Station[];
  locale: Locale;
  selectedStation: Station | null;
  onSelectStation: (s: Station | null) => void;
  onCollapse: () => void;
  stationStatuses: Record<string, string>;
}) {
  return (
    <div style={{
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "16px 20px",
      marginTop: 12,
    }}>
      {/* Line header with collapse */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button
          onClick={onCollapse}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--muted)",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
          }}
        >
          <ChevronDown size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{line.nameZh}</span>
          <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
            {line.nameVi} · {stations.length} {locale === "zh-CN" ? "工位" : locale === "vi-VN" ? "trạm" : "stations"}
          </span>
        </div>
        {line.currentWorkOrderCode && (
          <span style={{
            fontSize: 11,
            background: "rgba(6,182,212,0.15)",
            color: "var(--accent-cyan)",
            padding: "3px 8px",
            borderRadius: 4,
            fontWeight: 500,
          }}>
            {line.currentWorkOrderCode}
          </span>
        )}
      </div>

      {/* Station flow */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        overflowX: "auto",
        paddingBottom: 8,
      }}>
        {stations.sort((a, b) => (a.sequenceOrder ?? 99) - (b.sequenceOrder ?? 99)).map((station, idx) => (
          <div key={station.code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StationNode
              station={station}
              locale={locale}
              isSelected={selectedStation?.code === station.code}
              onClick={() => onSelectStation(selectedStation?.code === station.code ? null : station)}
              stationStatuses={stationStatuses}
            />
            {idx < stations.length - 1 && <Arrow />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────
export function ProductionLineDashboard({ locale }: Props) {
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [lineDetails, setLineDetails] = useState<Record<string, { stations: Station[] }>>({});
  const [loading, setLoading] = useState(true);
  const [expandedLine, setExpandedLine] = useState<string | null>(null); // lineCode
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);

  // Real-time station statuses derived from heartbeat data
  const [heartbeats, setHeartbeats] = useState<Record<string, { lastSeen: string; lineCode: string }>>({});

  useEffect(() => {
    setLoading(true);
    mesApi.getLines()
      .then(res => {
        setLines(res.items);
        // Fetch all line details in parallel
        return Promise.all(
          res.items.map(line =>
            mesApi.getLine(line.lineCode).then(d => ({ lineCode: line.lineCode, d }))
          )
        );
      })
      .then(results => {
        const details: Record<string, { stations: Station[] }> = {};
        results.forEach(({ lineCode, d }) => { details[lineCode] = { stations: d.stations ?? [] }; });
        setLineDetails(details);
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false));

    // Fetch heartbeats for real-time status
    refreshHeartbeats();
    const interval = setInterval(refreshHeartbeats, 10000);
    return () => clearInterval(interval);
  }, []);

  function refreshHeartbeats() {
    mesApi.getHeartbeats().then(data => {
      const map: Record<string, { lastSeen: string; lineCode: string }> = {};
      (data.heartbeats ?? []).forEach((h: { stationCode: string; lastSeen: string; lineCode: string }) => {
        map[h.stationCode] = { lastSeen: h.lastSeen, lineCode: h.lineCode };
      });
      setHeartbeats(map);
    }).catch(() => {});
  }

  // Derive station status from heartbeat (online/offline based on 30s threshold)
  function getStationStatus(stationCode: string, fallbackStatus?: string): string {
    const hb = heartbeats[stationCode];
    if (!hb) return "offline";
    const lastSeen = new Date(hb.lastSeen).getTime();
    const now = Date.now();
    if (now - lastSeen > 30000) return "offline"; // no heartbeat > 30s
    return "online";
  }

  const stationStatuses: Record<string, string> = Object.fromEntries(
    Object.values(lineDetails)
      .flatMap(detail => detail.stations)
      .map(station => [station.code, getStationStatus(station.code, station.status)]),
  );

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 80 }}>
        <div style={{ color: "var(--muted)" }}>
          {locale === "zh-CN" ? "加载中..." : locale === "vi-VN" ? "Đang tải..." : "Loading..."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "0 0 40px" }}>
      {/* Page title */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>
          🏭 {locale === "zh-CN" ? "产线工位实时监控" : locale === "vi-VN" ? "Giám sát trạm máy" : "Production Line Monitor"}
        </h2>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {locale === "zh-CN" ? "点击产线展开工位流程" : locale === "vi-VN" ? "Nhấp vào dây chuyền để mở rộng" : "Click line to expand stations"}
        </span>
      </div>

      {/* Horizontal line selector */}
      <div style={{
        display: "flex",
        gap: 12,
        padding: "16px 20px",
        overflowX: "auto",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-primary)",
      }}>
        {lines.map((line, idx) => {
          const lineColor = lineStatusColor(line, lineDetails[line.lineCode]?.stations ?? [], heartbeats);
          const isExpanded = expandedLine === line.lineCode;

          return (
            <div key={line.lineCode} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Line card */}
              <div
                onClick={() => setExpandedLine(isExpanded ? null : line.lineCode)}
                style={{
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: isExpanded ? `2px solid ${lineColor}` : "1px solid var(--border)",
                  background: isExpanded ? `${lineColor}11` : "var(--bg-secondary)",
                  cursor: "pointer",
                  minWidth: 120,
                  transition: "all 0.2s",
                  boxShadow: isExpanded ? `0 0 16px ${lineColor}33` : "none",
                }}
              >
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: lineColor,
                  letterSpacing: "0.05em",
                  marginBottom: 4,
                }}>
                  {line.lineCode}
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 2 }}>
                  {line.nameZh}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>
                  {line.nameVi}
                </div>
                <div style={{
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  color: lineColor,
                  fontSize: 11,
                  fontWeight: 500,
                }}>
                  <Circle size={8} fill={lineColor} stroke="none" />
                  {statusLabel(line.status, locale)}
                  <span style={{ color: "var(--muted)" }}>·</span>
                  <span>{lineDetails[line.lineCode]?.stations?.length ?? 0}</span>
                  <span style={{ color: "var(--muted)" }}>
                    {locale === "zh-CN" ? "工位" : locale === "vi-VN" ? "trạm" : "st"}
                  </span>
                </div>
              </div>

              {/* Connector between lines */}
              {idx < lines.length - 1 && (
                <Arrow />
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded line detail */}
      {expandedLine && lineDetails[expandedLine] && (
        <ExpandedLine
          line={lines.find(l => l.lineCode === expandedLine)!}
          stations={lineDetails[expandedLine].stations}
          locale={locale}
          selectedStation={selectedStation}
          onSelectStation={setSelectedStation}
          onCollapse={() => setExpandedLine(null)}
          stationStatuses={stationStatuses}
        />
      )}

      {/* Station drawer */}
      {selectedStation && (
        <StationDrawer
          station={selectedStation}
          locale={locale}
          onClose={() => setSelectedStation(null)}
          stationStatuses={stationStatuses}
        />
      )}
    </div>
  );
}
