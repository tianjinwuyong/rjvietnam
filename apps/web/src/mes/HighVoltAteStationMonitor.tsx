import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { IctStationMonitor } from "./IctStationMonitor";

type Row = Record<string, unknown>;
type Snapshot = { stationCode?: string; bucketName?: string; payload?: Row[] };

export function HighVoltAteStationMonitor({ locale }: { locale: Locale }) {
  const [agingNg, setAgingNg] = useState<Row[]>([]);
  const [highVoltNg, setHighVoltNg] = useState<Row[]>([]);
  const [status, setStatus] = useState("");
  const refresh = useCallback(async () => {
    const raw = await fetch("/api/station/bucket-snapshots").then(r => r.json());
    const all: Snapshot[] = Array.isArray(raw) ? raw : raw.items ?? raw.snapshots ?? [];
    const own = all.filter(x => x.stationCode === "manu_hivolt_ate");
    setAgingNg(own.find(x => x.bucketName === "pending_ng")?.payload ?? []);
    setHighVoltNg(own.find(x => x.bucketName === "confirmed_ng")?.payload ?? []);
  }, []);
  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 3000); return () => clearInterval(id); }, [refresh]);

  const migrate = useCallback(async (rows: Row[], origin: "AGING_CAB" | "HIVOLT_ATE") => {
    setStatus(`MES creating ${rows.length} maintenance WO(s)…`);
    try {
      for (const row of rows) {
        const sn = String(row.sn || row.pcbSerial || "").trim().toUpperCase();
        if (!sn) continue;
        const response = await fetch("/api/station/maintenance-handovers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          sourceStation: "manu_hivolt_ate", sourceStationName: "High-Voltage ATE", ngSn: sn,
          batchId: String(row.batchId || sn), members: [row], product: row, ngOrigin: origin,
          confirmedBy: "HIVOLT_OPERATOR_PANEL", confirmedRole: "OPERATOR", submittedBy: "HIVOLT_OPERATOR_PANEL",
          returnStationCode: "manu_agingcab", validationRoute: ["manu_agingcab", "manu_hivolt_ate"],
          firstDetectedAt: Number(row.firstDetectedAt || row.time || Date.now()),
        }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${sn}: ${result.message || `HTTP ${response.status}`}`);
      }
      setStatus(`Migrated ${rows.length} NG · maintenance WO created · return Aging Cabinet`);
      await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Migration failed"); }
  }, [refresh]);

  const box = (label: string, rows: Row[], color: string, origin: "AGING_CAB" | "HIVOLT_ATE") => <>
    <div style={{ padding: 12, border: `2px solid ${color}`, borderRadius: 10, background: "#071525", color: "#e2e8f0" }}>
      <span style={{ fontSize: 11, fontWeight: 900 }}>{label}</span><strong style={{ display: "block", fontSize: 27 }}>{rows.length}</strong>
    </div>
    <button disabled={!rows.length} onClick={() => void migrate(rows, origin)} style={{ padding: 11, border: `2px solid ${color}`, borderRadius: 9, background: "#9a3412", color: "white", fontWeight: 900, opacity: rows.length ? 1 : .45 }}>MIGRATE → MAINTENANCE WO</button>
  </>;

  return <div style={{ position: "relative" }}>
    <IctStationMonitor locale={locale} stationCode="manu_hivolt_ate" stationKind="ASSEMBLY ATE" stationLabel="HIGH-VOLTAGE ATE" />
    <div style={{ position: "absolute", zIndex: 18, left: 18, top: 80, width: 270, display: "grid", gap: 8, padding: 4, background: "#07111f" }}>
      {box("AGING CAB NG BOX", agingNg, "#f59e0b", "AGING_CAB")}
      {box("HIGH-VOLTAGE ATE NG BOX", highVoltNg, "#ef4444", "HIVOLT_ATE")}
      <small style={{ color: "#fbbf24", minHeight: 28 }}>{status || "Repair return route: Aging Cabinet → High-Voltage ATE"}</small>
    </div>
  </div>;
}
