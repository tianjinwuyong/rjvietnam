import { lazy, Suspense, useState, useEffect } from "react";
import {
  ChevronRight, ChevronDown, Factory, Layers, Activity, AlertCircle,
  Wifi, WifiOff, Monitor, Box, Cpu, Package, ScanBarcode,
  Circle, RefreshCw,
} from "lucide-react";
import { mesApi, type ProductionLine, type Station } from "../api/mes";
import type { Locale } from "../../../../packages/shared-types/src/factory";
const LazyFctStationMonitor = lazy(() => import("./FctStationMonitor").then(m => ({ default: m.FctStationMonitor })));

type Props = { locale: Locale };

// ── Station type → icon/color ─────────────────────────────────────────
const STATION_TYPE_META: Record<string, { icon: typeof Monitor; color: string; shortLabel: string }> = {
  SMT_LASER:   { icon: ScanBarcode, color: "#6366f1", shortLabel: "LASER" },
  SMT_AI_INS:  { icon: Box,         color: "#8b5cf6", shortLabel: "AI" },
  SMT_PRINTER: { icon: Box,         color: "#06b6d4", shortLabel: "PRINT" },
  SMT_SPI:     { icon: Activity,    color: "#06b6d4", shortLabel: "SPI" },
  SMT_PNP:     { icon: Box,         color: "#10b981", shortLabel: "PNP" },
  SMT_AOI:     { icon: Monitor,     color: "#8b5cf6", shortLabel: "AOI" },
  SMT_LOAD:    { icon: ScanBarcode, color: "#6366f1", shortLabel: "LOAD" },
  AUTO_LOAD:   { icon: ScanBarcode, color: "#6366f1", shortLabel: "LOAD" },
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

function statusColor(status: string) {
  switch (status) {
    case "running": return "var(--ok)";
    case "idle":   return "var(--muted)";
    case "down":   return "var(--danger)";
    case "ng":     return "var(--warn)";
    default:       return "var(--muted)";
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

// ── Station Row ─────────────────────────────────────────────────────────
function StationRow({
  station,
  locale,
  heartbeats,
  onSelect,
  isSelected,
}: {
  station: Station;
  locale: Locale;
  heartbeats: Record<string, { lastSeen: string; lineCode: string }>;
  onSelect: (s: Station) => void;
  isSelected: boolean;
}) {
  const { icon: Icon, color } = getStationMeta(station.stationType ?? "");
  const hb = heartbeats[station.code];
  const now = Date.now();
  const isOnline = hb && (now - new Date(hb.lastSeen).getTime() <= 30000);
  const onlineColor = isOnline ? "var(--ok)" : "var(--muted)";

  return (
    <div
      onClick={() => onSelect(station)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px 8px 52px",
        cursor: "pointer",
        background: isSelected ? "rgba(6,182,212,0.08)" : "transparent",
        borderBottom: "1px solid var(--border)",
        transition: "background 0.15s",
      }}
    >
      {/* Online dot */}
      <div style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: onlineColor,
        flexShrink: 0,
      }} />

      <Icon size={14} style={{ color, flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
          {station.nameZh}
        </div>
        <div style={{ fontSize: 10, color: "var(--muted)" }}>
          {station.code} · {station.stationType}
        </div>
      </div>

      <div style={{
        fontSize: 11,
        color: onlineColor,
        fontWeight: 500,
      }}>
        {isOnline
          ? (locale === "zh-CN" ? "在线" : locale === "vi-VN" ? "Online" : "Online")
          : (locale === "zh-CN" ? "离线" : locale === "vi-VN" ? "Offline" : "Offline")
        }
      </div>
    </div>
  );
}

// ── Line Branch ─────────────────────────────────────────────────────────
function LineBranch({
  line,
  stations,
  locale,
  isExpanded,
  onToggle,
  selectedStation,
  onSelectStation,
  heartbeats,
}: {
  line: ProductionLine;
  stations: Station[];
  locale: Locale;
  isExpanded: boolean;
  onToggle: () => void;
  selectedStation: Station | null;
  onSelectStation: (s: Station | null) => void;
  heartbeats: Record<string, { lastSeen: string; lineCode: string }>;
}) {
  const now = Date.now();
  const onlineCount = stations.filter(s => {
    const hb = heartbeats[s.code];
    return hb && (now - new Date(hb.lastSeen).getTime() <= 30000);
  }).length;

  const lineColor = line.status === "running" ? "var(--ok)" : "var(--muted)";

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      {/* Line header */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          cursor: "pointer",
          background: isExpanded ? "rgba(6,182,212,0.06)" : "transparent",
          transition: "background 0.15s",
        }}
      >
        {isExpanded
          ? <ChevronDown size={16} style={{ color: "var(--muted)" }} />
          : <ChevronRight size={16} style={{ color: "var(--muted)" }} />
        }

        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `${lineColor}22`,
          border: `1px solid ${lineColor}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Layers size={16} style={{ color: lineColor }} />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
            {line.nameZh}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {line.nameVi}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 10,
            background: "rgba(6,182,212,0.12)",
            color: "var(--accent-cyan)",
            padding: "2px 8px",
            borderRadius: 10,
            fontWeight: 500,
          }}>
            {stations.length} {locale === "zh-CN" ? "工位" : locale === "vi-VN" ? "trạm" : "st"}
          </span>
          <span style={{
            fontSize: 10,
            background: `${lineColor}22`,
            color: lineColor,
            padding: "2px 8px",
            borderRadius: 10,
            fontWeight: 500,
          }}>
            {onlineCount}/{stations.length} {locale === "zh-CN" ? "在线" : locale === "vi-VN" ? "online" : "online"}
          </span>
        </div>
      </div>

      {/* Station list */}
      {isExpanded && (
        <div style={{ background: "var(--bg-secondary)" }}>
          {stations.sort((a, b) => (a.sequenceOrder ?? 99) - (b.sequenceOrder ?? 99)).map(station => (
            <StationRow
              key={station.code}
              station={station}
              locale={locale}
              heartbeats={heartbeats}
              onSelect={onSelectStation}
              isSelected={selectedStation?.code === station.code}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Station Detail Panel ───────────────────────────────────────────────
function StationDetail({
  station,
  locale,
  heartbeats,
  onClose,
}: {
  station: Station;
  locale: Locale;
  heartbeats: Record<string, { lastSeen: string; lineCode: string }>;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [ngRecords, setNgRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { icon: Icon, color } = getStationMeta(station.stationType ?? "");
  const hb = heartbeats[station.code];
  const now = Date.now();
  const isOnline = hb && (now - new Date(hb.lastSeen).getTime() <= 30000);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const [data, ngData] = await Promise.all([
          mesApi.getStation(station.code),
          mesApi.getStationNgDefects(station.code, 30),
        ]);
        if (!cancelled) {
          setEvents(data.recentEvents ?? []);
          setNgRecords(ngData.items ?? []);
          setLastRefresh(new Date());
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setEvents([]);
          setNgRecords([]);
          setLoading(false);
        }
      }
    }

    load();
    const interval = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [station.code]);

  return (
    <div style={{
      width: 360,
      borderLeft: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-secondary)",
    }}>
      {/* Header */}
      <div style={{
        padding: 16,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-primary)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
            <div style={{ fontWeight: 600, fontSize: 14 }}>{station.nameZh}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{station.code}</div>
          </div>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              padding: 4,
            }}
            title={locale === "zh-CN" ? "刷新" : "Refresh"}
          >
            <RefreshCw size={14} style={{ opacity: loading ? 0.5 : 1 }} />
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
        {lastRefresh && (
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
            {locale === "zh-CN" ? "刷新" : "Refresh"}: {lastRefresh.toLocaleTimeString("zh-CN")}
            {loading && " ..."}
          </div>
        )}

        {/* Status */}
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 12,
            background: isOnline ? "rgba(16,185,129,0.15)" : "rgba(100,116,139,0.15)",
            color: isOnline ? "var(--ok)" : "var(--muted)",
            fontSize: 12,
            fontWeight: 600,
          }}>
            {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
            {isOnline
              ? (locale === "zh-CN" ? "在线" : "Online")
              : (locale === "zh-CN" ? "离线" : "Offline")
            }
          </span>
          <span style={{
            padding: "4px 10px",
            borderRadius: 12,
            background: `${color}15`,
            color: color,
            fontSize: 12,
            fontWeight: 600,
          }}>
            {station.stationType}
          </span>
        </div>
      </div>

      {/* Events */}
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8, padding: "0 4px" }}>
          {locale === "zh-CN" ? "最近事件" : locale === "vi-VN" ? "Sự kiện gần đây" : "Recent Events"}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 20, color: "var(--muted)", fontSize: 12 }}>
            {locale === "zh-CN" ? "加载中..." : "Loading..."}
          </div>
        ) : events.length === 0 ? (
          <div style={{ textAlign: "center", padding: 20, color: "var(--muted)", fontSize: 12 }}>
            {locale === "zh-CN" ? "暂无事件" : "No events"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {events.map((ev, i) => (
              <div key={i} style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 10px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: ev.result === "PASS" ? "var(--ok)" : "var(--danger)",
                  }}>
                    {ev.result ?? ev.eventType ?? "—"}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>
                    {ev.occurredAt ? new Date(ev.occurredAt).toLocaleString(locale === "vi-VN" ? "vi-VN" : locale === "en-US" ? "en-US" : "zh-CN") : ""}
                  </span>
                </div>
                {ev.pcbSerial && (
                  <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>
                    SN: {ev.pcbSerial}
                  </div>
                )}
                {ev.operator && (
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {locale === "zh-CN" ? "操作员" : "Operator"}: {ev.operator}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* NG Records */}
      <div style={{ borderTop: "1px solid var(--border)", flex: "0 0 40%", overflowY: "auto", padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", marginBottom: 8, padding: "0 4px", display: "flex", alignItems: "center", gap: 6 }}>
          <span>⚠</span>
          {locale === "zh-CN" ? "NG记录" : locale === "vi-VN" ? "Bản ghi NG" : "NG Records"} ({ngRecords.length})
        </div>
        {ngRecords.length === 0 ? (
          <div style={{ textAlign: "center", padding: 16, color: "var(--muted)", fontSize: 12 }}>
            {locale === "zh-CN" ? "无NG记录" : "No NG records"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ngRecords.map((ng, i) => (
              <div key={i} style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 8,
                padding: "8px 10px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)" }}>
                    {ng.defectCode ?? "NG"}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>
                    {ng.occurredAt ? new Date(ng.occurredAt).toLocaleString("zh-CN") : ""}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>
                  SN: <strong style={{ color: "var(--accent)" }}>{ng.pcbSerial ?? "—"}</strong>
                </div>
                {ng.defectDesc && (
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {ng.defectDesc}
                  </div>
                )}
                {ng.operator && (
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {locale === "zh-CN" ? "操作员" : "Operator"}: {ng.operator}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────
export function FactoryLinesTree({ locale }: Props) {
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [lineStations, setLineStations] = useState<Record<string, Station[]>>({});
  const [loading, setLoading] = useState(true);
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [heartbeats, setHeartbeats] = useState<Record<string, { lastSeen: string; lineCode: string }>>({});

  useEffect(() => {
    setLoading(true);
    mesApi.getLines()
      .then(res => {
        const lineItems = res.items;
        setLines(lineItems);
        return Promise.all(
          lineItems.map(line => mesApi.getLine(line.lineCode))
        ).then(details => ({ lineItems, details }));
      })
      .then(({ lineItems, details }) => {
        const stations: Record<string, Station[]> = {};
        details.forEach((d, i) => {
          const code = lineItems[i]?.lineCode;
          if (code) stations[code] = d.stations ?? [];
        });
        setLineStations(stations);
        // Auto-expand first line
        if (lineItems[0]) {
          setExpandedLines(new Set([lineItems[0].lineCode]));
        }
      })
      .catch(() => setLines([]))
      .finally(() => setLoading(false));

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

  function toggleLine(lineCode: string) {
    setExpandedLines(prev => {
      const next = new Set(prev);
      if (next.has(lineCode)) next.delete(lineCode);
      else next.add(lineCode);
      return next;
    });
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 80 }}>
        <div style={{ color: "var(--muted)" }}>
          {locale === "zh-CN" ? "加载中..." : "Loading..."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Tree panel */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Root: MES */}
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-primary)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, rgba(6,182,212,0.2), rgba(6,182,212,0.35))",
              border: "1.5px solid var(--accent-cyan)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Factory size={18} style={{ color: "var(--accent-cyan)" }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--accent-cyan)" }}>MES</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {locale === "zh-CN" ? "越南瑞晶工厂" : "Vietnam Ruijing Factory"}
              </div>
            </div>
          </div>
        </div>

        {/* Lines */}
        <div>
          {lines.sort((a, b) => a.lineCode.localeCompare(b.lineCode)).map(line => (
            <LineBranch
              key={line.lineCode}
              line={line}
              stations={lineStations[line.lineCode] ?? []}
              locale={locale}
              isExpanded={expandedLines.has(line.lineCode)}
              onToggle={() => toggleLine(line.lineCode)}
              selectedStation={selectedStation}
              onSelectStation={(s) => setSelectedStation(s)}
              heartbeats={heartbeats}
            />
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selectedStation && (
        selectedStation.stationType?.toUpperCase().includes("FCT")
          ? <Suspense fallback={<div style={{ padding: 16 }}>Loading station monitor…</div>}><LazyFctStationMonitor locale={locale} /></Suspense>
          : <StationDetail
              station={selectedStation}
              locale={locale}
              heartbeats={heartbeats}
              onClose={() => setSelectedStation(null)}
            />
      )}
    </div>
  );
}
