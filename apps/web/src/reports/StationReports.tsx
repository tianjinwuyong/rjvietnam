import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

// ── Station canonical code definitions ──────────────────────────────────────────
// Mirrors services/api/src/shared/station-identity.js

interface StationDef {
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
}

const SMT_STATIONS: StationDef[] = [
  { code: "smt_pda_loading", nameZh: "PD扫码上料", nameEn: "PDA Material Loading", nameVi: "Quét cấp liệu PDA" },
  { code: "smt_laser_marking", nameZh: "镭雕机", nameEn: "Laser Marking", nameVi: "Khắc laser" },
  { code: "smt_auto_insertion", nameZh: "AI插件机", nameEn: "Automatic Insertion", nameVi: "Máy cắm linh kiện AI" },
  { code: "smt_printer", nameZh: "印刷机", nameEn: "Solder Paste Printer", nameVi: "Máy in kem hàn" },
  { code: "smt_spi", nameZh: "SPI锡膏检测", nameEn: "Solder Paste Inspection", nameVi: "Kiểm tra kem hàn SPI" },
  { code: "smt_placement", nameZh: "贴片机", nameEn: "Pick and Place", nameVi: "Máy gắn linh kiện" },
  { code: "smt_aoi", nameZh: "SMT-AOI", nameEn: "SMT AOI", nameVi: "Kiểm tra SMT-AOI" },
];

const AUTO_STATIONS: StationDef[] = [
  { code: "auto_pda", nameZh: "PDA扫码上料", nameEn: "PDA Loading", nameVi: "Nạp liệu PDA" },
  { code: "auto_aio", nameZh: "AOI", nameEn: "AOI", nameVi: "AOI" },
  { code: "auto_ict", nameZh: "ICT", nameEn: "ICT", nameVi: "ICT" },
  { code: "auto_fct", nameZh: "FCT", nameEn: "FCT", nameVi: "FCT" },
  { code: "auto_depanel", nameZh: "分板工位", nameEn: "Depanel", nameVi: "Tách bảng" },
  { code: "auto_shellbinding", nameZh: "PCBA外壳绑码", nameEn: "Shell Binding", nameVi: "Gán mã vỏ" },
  { code: "auto_assem_ate", nameZh: "组装ATE", nameEn: "Assembly ATE", nameVi: "ATE lắp ráp" },
  { code: "auto_supersonic", nameZh: "超声工位", nameEn: "Ultrasonic", nameVi: "Siêu âm" },
  { code: "auto_agingcab", nameZh: "成品老化", nameEn: "Aging", nameVi: "Lão hóa" },
  { code: "auto_hivolt_ate", nameZh: "高压ATE", nameEn: "High-voltage ATE", nameVi: "ATE cao áp" },
  { code: "auto_package_ate", nameZh: "包装ATE", nameEn: "Packaging ATE", nameVi: "ATE đóng gói" },
  { code: "auto_case_binding", nameZh: "外箱码绑定", nameEn: "Outer-box Binding", nameVi: "Gán mã thùng" },
  { code: "auto_pallet_binding", nameZh: "栈板绑码", nameEn: "Pallet Binding", nameVi: "Gán mã pallet" },
];

const MANUAL_STATIONS: StationDef[] = [
  { code: "manu_pda", nameZh: "PDA扫码上料", nameEn: "PDA Loading", nameVi: "Nạp liệu PDA" },
  { code: "manu_aio", nameZh: "AOI质量工位", nameEn: "AOI Quality", nameVi: "Kiểm tra AOI" },
  { code: "manu_ict", nameZh: "ICT", nameEn: "ICT", nameVi: "ICT" },
  { code: "manu_fct", nameZh: "FCT", nameEn: "FCT", nameVi: "FCT" },
  { code: "manu_depanel", nameZh: "分板工位", nameEn: "Depanel", nameVi: "Tách bảng" },
  { code: "manu_shellbinding", nameZh: "PCBA外壳绑码", nameEn: "Shell Binding", nameVi: "Gán mã vỏ" },
  { code: "manu_assem_ate", nameZh: "组装ATE", nameEn: "Assembly ATE", nameVi: "ATE lắp ráp" },
  { code: "manu_supersonic", nameZh: "超声工位", nameEn: "Ultrasonic", nameVi: "Siêu âm" },
  { code: "manu_agingcab", nameZh: "成品老化", nameEn: "Aging", nameVi: "Lão hóa" },
  { code: "manu_hivolt_ate", nameZh: "高压ATE", nameEn: "High-voltage ATE", nameVi: "ATE cao áp" },
  { code: "manu_package_ate", nameZh: "包装ATE", nameEn: "Packaging ATE", nameVi: "ATE đóng gói" },
  { code: "manu_case_binding", nameZh: "外箱码绑定", nameEn: "Outer-box Binding", nameVi: "Gán mã thùng" },
  { code: "manu_pallet_binding", nameZh: "栈板绑码", nameEn: "Pallet Binding", nameVi: "Gán mã pallet" },
  { code: "manu_rework", nameZh: "回修站", nameEn: "Maintenance / Rework", nameVi: "Trạm sửa chữa" },
];

type StationDomain = "smt" | "auto" | "manual";

interface StationBucket {
  stationCode: string;
  bucketName: string;
  pass?: number;
  fail?: number;
  total?: number;
  updatedAt?: string;
}

interface HeartbeatEntry {
  stationCode: string;
  online: boolean;
  receivedAt: number;
}

interface StationStatus {
  online: boolean;
  lastHeartbeat: number;
  total: number;
  pass: number;
  fail: number;
  updatedAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStations(domain: StationDomain): StationDef[] {
  if (domain === "smt") return SMT_STATIONS;
  if (domain === "auto") return AUTO_STATIONS;
  return MANUAL_STATIONS;
}

function stationName(station: StationDef, locale: Locale): string {
  if (locale === "zh-CN") return station.nameZh;
  if (locale === "vi-VN") return station.nameVi;
  return station.nameEn;
}

function domainLabel(domain: StationDomain, locale: Locale): string {
  const map = {
    smt: { "zh-CN": "SMT产线 (L001)", "vi-VN": "Dây SMT (L001)", "en-US": "SMT Line (L001)" },
    auto: { "zh-CN": "组装线 (L002)", "vi-VN": "Dây lắp ráp (L002)", "en-US": "Assembly Line (L002)" },
    manual: { "zh-CN": "手动线 (L004)", "vi-VN": "Dây thủ công (L004)", "en-US": "Manual Line (L004)" },
  };
  return map[domain][locale];
}

function recordsOf(snapshot: StationBucket | undefined): Record<string, unknown>[] {
  if (!snapshot) return [];
  return [];
}

// ── Station card ────────────────────────────────────────────────────────────────

function StationCard({
  station,
  status,
  locale,
  onClick,
}: {
  station: StationDef;
  status: StationStatus | null;
  locale: Locale;
  onClick: () => void;
}) {
  const isOnline = status?.online ?? false;
  const total = status?.total ?? 0;
  const pass = status?.pass ?? 0;
  const fail = status?.fail ?? 0;
  const yieldPct = total > 0 ? ((pass / total) * 100).toFixed(1) : "—";

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "12px 14px",
        border: `1px solid ${isOnline ? "#22c55e33" : "#64748b33"}`,
        borderRadius: 10,
        background: isOnline ? "#052e2518" : "var(--surface)",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.15s",
        minWidth: 160,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          {stationName(station, locale)}
        </span>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: isOnline ? "#22c55e" : "#64748b",
          boxShadow: isOnline ? "0 0 6px #22c55e" : "none",
        }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "ui-monospace" }}>
        {station.code}
      </div>
      {total > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 12 }}>
          <span style={{ color: "#22c55e" }}>✓ {pass}</span>
          <span style={{ color: "#ef4444" }}>✗ {fail}</span>
          <span style={{ color: "var(--muted)" }}>⚙ {total}</span>
          <span style={{ color: "#38bdf8", marginLeft: "auto" }}>{yieldPct}%</span>
        </div>
      )}
      {total === 0 && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          {isOnline ? "就绪" : "离线"}
        </div>
      )}
    </button>
  );
}

// ── Station detail panel ───────────────────────────────────────────────────────

function StationDetail({
  station,
  status,
  locale,
}: {
  station: StationDef;
  status: StationStatus | null;
  locale: Locale;
}) {
  const isOnline = status?.online ?? false;
  const total = status?.total ?? 0;
  const pass = status?.pass ?? 0;
  const fail = status?.fail ?? 0;
  const yieldPct = total > 0 ? ((pass / total) * 100).toFixed(2) : "—";
  const lastUpdate = status?.lastHeartbeat
    ? new Date(status.lastHeartbeat).toLocaleTimeString()
    : "—";

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: 20,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{stationName(station, locale)}</h2>
          <code style={{ fontSize: 12, color: "var(--muted)" }}>{station.code}</code>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            padding: "4px 12px",
            borderRadius: 999,
            background: isOnline ? "#22c55e22" : "#64748b22",
            color: isOnline ? "#22c55e" : "#64748b",
            fontSize: 12,
            fontWeight: 700,
          }}>
            {isOnline ? "ONLINE" : "OFFLINE"}
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <div style={{ background: "var(--bg)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{total}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>总数量</div>
        </div>
        <div style={{ background: "#22c55e18", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#22c55e" }}>{pass}</div>
          <div style={{ fontSize: 11, color: "#22c55e99" }}>Pass</div>
        </div>
        <div style={{ background: "#ef444418", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#ef4444" }}>{fail}</div>
          <div style={{ fontSize: 11, color: "#ef444499" }}>Fail</div>
        </div>
        <div style={{ background: "#38bdf818", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#38bdf8" }}>{yieldPct}%</div>
          <div style={{ fontSize: 11, color: "#38bdf899" }}>Yield</div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        最后更新: <span style={{ fontFamily: "ui-monospace" }}>{lastUpdate}</span>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

type Props = { locale: Locale };

export function StationReports({ locale }: Props) {
  const [selectedDomain, setSelectedDomain] = useState<StationDomain>("smt");
  const [selectedStation, setSelectedStation] = useState<StationDef | null>(null);
  const [stationStatuses, setStationStatuses] = useState<Record<string, StationStatus>>({});
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchData = useCallback(async () => {
    try {
      const [snapResponse, hbResponse] = await Promise.all([
        fetch("/api/station/bucket-snapshots", { cache: "no-store" }),
        fetch("/api/pda/heartbeats", { cache: "no-store" }),
      ]);

      if (!snapResponse.ok || !hbResponse.ok) return;

      const snapData = await snapResponse.json();
      const hbData = await hbResponse.json();

      const items: StationBucket[] = Array.isArray(snapData)
        ? snapData
        : (snapData.items ?? snapData.snapshots ?? []);

      const heartbeats: HeartbeatEntry[] = hbData.heartbeats ?? [];
      const now = Date.now();

      // Build a map of stationCode -> StationStatus
      const newStatuses: Record<string, StationStatus> = {};

      // Initialize all known stations as offline
      for (const station of [...SMT_STATIONS, ...AUTO_STATIONS, ...MANUAL_STATIONS]) {
        const heartbeat = heartbeats.find((h) => h.stationCode === station.code);
        const online = heartbeat ? now - heartbeat.receivedAt < 45_000 : false;
        newStatuses[station.code] = {
          online,
          lastHeartbeat: heartbeat?.receivedAt ?? 0,
          total: 0,
          pass: 0,
          fail: 0,
          updatedAt: now,
        };
      }

      // Aggregate bucket data per station
      for (const item of items) {
        const code = item.stationCode;
        const existing = newStatuses[code] ?? {
          online: false, lastHeartbeat: 0, total: 0, pass: 0, fail: 0, updatedAt: now,
        };

        if (item.bucketName === "stats") {
          const payload = (item as any).payload;
          if (payload && typeof payload === "object") {
            newStatuses[code] = {
              ...existing,
              total: Number(payload.total ?? existing.total),
              pass: Number(payload.pass ?? existing.pass),
              fail: Number(payload.fail ?? existing.fail),
              updatedAt: item.updatedAt ? new Date(item.updatedAt).getTime() : now,
            };
          }
        } else if (item.bucketName === "pass") {
          const rows = Array.isArray((item as any).payload) ? (item as any).payload : [];
          newStatuses[code] = { ...existing, pass: rows.length, updatedAt: item.updatedAt ? new Date(item.updatedAt).getTime() : now };
        } else if (item.bucketName === "pending_ng" || item.bucketName === "confirmed_ng") {
          const rows = Array.isArray((item as any).payload) ? (item as any).payload : [];
          newStatuses[code] = { ...existing, fail: (existing.fail ?? 0) + rows.length, updatedAt: item.updatedAt ? new Date(item.updatedAt).getTime() : now };
        }
      }

      setStationStatuses(newStatuses);
    } catch {
      // ignore fetch errors silently
    }
  }, []);

  useEffect(() => {
    void fetchData();
    timerRef.current = setInterval(fetchData, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchData]);

  const domains: StationDomain[] = ["smt", "auto", "manual"];
  const stations = getStations(selectedDomain);
  const currentStatus = selectedStation ? (stationStatuses[selectedStation.code] ?? null) : null;

  return (
    <div style={{ padding: "0 0 32px 0" }}>
      {/* Header */}
      <div style={{
        marginBottom: 20,
        padding: "16px 20px",
        background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
        borderRadius: 8,
        color: "#fff",
      }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>📊 Station Reports — Real-time</h2>
        <p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.85 }}>
          {locale === "zh-CN"
            ? "实时工站状态监控 · 选择产线和工站查看数据"
            : locale === "vi-VN"
            ? "Giám sát trạm thời gian thực · Chọn dây chuyền và trạm để xem dữ liệu"
            : "Real-time station monitoring · Select line and station to view data"}
        </p>
      </div>

      {/* Line selector tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {domains.map((domain) => (
          <button
            key={domain}
            type="button"
            onClick={() => { setSelectedDomain(domain); setSelectedStation(null); }}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: selectedDomain === domain ? "2px solid #0ea5e9" : "1px solid var(--border)",
              background: selectedDomain === domain ? "#0ea5e918" : "var(--surface)",
              color: selectedDomain === domain ? "#0ea5e9" : "var(--text)",
              fontWeight: selectedDomain === domain ? 700 : 400,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            {domainLabel(domain, locale)}
          </button>
        ))}
      </div>

      {/* Station grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 10,
        marginBottom: selectedStation ? 20 : 0,
      }}>
        {stations.map((station) => (
          <StationCard
            key={station.code}
            station={station}
            status={stationStatuses[station.code] ?? null}
            locale={locale}
            onClick={() => setSelectedStation(station)}
          />
        ))}
      </div>

      {/* Selected station detail */}
      {selectedStation && (
        <StationDetail
          station={selectedStation}
          status={currentStatus}
          locale={locale}
        />
      )}
    </div>
  );
}
