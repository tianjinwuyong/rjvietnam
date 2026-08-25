import { useState, useMemo } from "react";
import { CalendarClock, Clock, CheckCircle, Trash2 } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface ExpiryLot {
  id: number;
  materialCode: string;
  materialNameZh: string;
  lotNo: string;
  receivedDate: string;
  expiryDate: string;
  remainingDays: number;
  qty: number;
  location: string;
  alertLevel: "expired" | "critical" | "warning" | "normal";
}

const _mockExpiryLots: ExpiryLot[] = [
  { id: 1, materialCode: "CAP-CER-100UF", materialNameZh: "贴片电容 100μF", lotNo: "LOT-20250115-001", receivedDate: "2025-01-15", expiryDate: "2025-06-15", remainingDays: -12, qty: 5000, location: "STORE-001-A1", alertLevel: "expired" },
  { id: 2, materialCode: "RES-SMD-10K", materialNameZh: "贴片电阻 10KΩ", lotNo: "LOT-20250301-002", receivedDate: "2025-03-01", expiryDate: "2025-09-01", remainingDays: 66, qty: 15000, location: "STORE-001-A2", alertLevel: "critical" },
  { id: 3, materialCode: "LED-RED-0805", materialNameZh: "红色LED 0805", lotNo: "LOT-20250410-003", receivedDate: "2025-04-10", expiryDate: "2025-10-10", remainingDays: 105, qty: 8000, location: "STORE-001-B1", alertLevel: "warning" },
  { id: 4, materialCode: "IC-MCU-STM32", materialNameZh: "STM32单片机", lotNo: "LOT-20250601-004", receivedDate: "2025-06-01", expiryDate: "2027-06-01", remainingDays: 730, qty: 500, location: "STORE-001-C2", alertLevel: "normal" },
  { id: 5, materialCode: "CONN-USB-C-30P", materialNameZh: "USB-C连接器", lotNo: "LOT-20250520-005", receivedDate: "2025-05-20", expiryDate: "2025-08-20", remainingDays: 54, qty: 3000, location: "STORE-002-A1", alertLevel: "critical" },
  { id: 6, materialCode: "PCB-AURORA-CTRL", materialNameZh: "控制板PCB", lotNo: "LOT-20250610-006", receivedDate: "2025-06-10", expiryDate: "2026-06-10", remainingDays: 348, qty: 200, location: "STORE-002-B2", alertLevel: "normal" },
  { id: 7, materialCode: "CAP-CER-100UF", materialNameZh: "贴片电容 100μF", lotNo: "LOT-20250201-007", receivedDate: "2025-02-01", expiryDate: "2025-08-01", remainingDays: 35, qty: 12000, location: "STORE-001-A1", alertLevel: "critical" },
  { id: 8, materialCode: "RES-SMD-10K", materialNameZh: "贴片电阻 10KΩ", lotNo: "LOT-20250620-008", receivedDate: "2025-06-20", expiryDate: "2026-06-20", remainingDays: 358, qty: 20000, location: "STORE-001-A2", alertLevel: "normal" },
  { id: 9, materialCode: "LED-RED-0805", materialNameZh: "红色LED 0805", lotNo: "LOT-20250625-009", receivedDate: "2025-06-25", expiryDate: "2025-09-25", remainingDays: 90, qty: 25000, location: "STORE-001-B1", alertLevel: "warning" },
  { id: 10, materialCode: "CONN-USB-C-30P", materialNameZh: "USB-C连接器", lotNo: "LOT-20250401-010", receivedDate: "2025-04-01", expiryDate: "2025-07-01", remainingDays: 4, qty: 1000, location: "STORE-002-A1", alertLevel: "critical" },
  { id: 11, materialCode: "IC-MCU-STM32", materialNameZh: "STM32单片机", lotNo: "LOT-20241115-011", receivedDate: "2024-11-15", expiryDate: "2026-11-15", remainingDays: 506, qty: 300, location: "STORE-001-C2", alertLevel: "normal" },
  { id: 12, materialCode: "CAP-CER-100UF", materialNameZh: "贴片电容 100μF", lotNo: "LOT-20241201-012", receivedDate: "2024-12-01", expiryDate: "2025-06-01", remainingDays: -26, qty: 8000, location: "STORE-001-A1", alertLevel: "expired" },
];

const alertColors: Record<string, string> = { expired: "var(--danger)", critical: "var(--warn)", warning: "#f59e0b", normal: "var(--ok)" };

export function WmsExpiryControl({ locale }: { locale: Locale }) {
  const [lots] = useState<ExpiryLot[]>(_mockExpiryLots);
  const [filterLevel, setFilterLevel] = useState("");

  const stats = useMemo(() => ({
    expired: lots.filter((l) => l.alertLevel === "expired").reduce((s, l) => s + l.qty, 0),
    critical: lots.filter((l) => l.alertLevel === "critical").reduce((s, l) => s + l.qty, 0),
    warning: lots.filter((l) => l.alertLevel === "warning").reduce((s, l) => s + l.qty, 0),
    normal: lots.filter((l) => l.alertLevel === "normal").reduce((s, l) => s + l.qty, 0),
  }), [lots]);

  const filtered = filterLevel ? lots.filter((l) => l.alertLevel === filterLevel) : lots;
  const sorted = useMemo(() => [...filtered].sort((a, b) => a.remainingDays - b.remainingDays), [filtered]);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><CalendarClock size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.expiryControl", locale)}</h2>
            <p>{t("wms.expiryMonitor", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 4, fontSize: 11, color: "var(--muted)" }}>
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: alertColors.expired }} /> {t("wms.expired", locale)}
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: alertColors.critical, marginLeft: 8 }} /> ≤3m
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: alertColors.warning, marginLeft: 8 }} /> ≤6m
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: alertColors.normal, marginLeft: 8 }} /> OK
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div style={{ display: "flex", gap: 16 }}>
          {[
            { label: t("wms.expired", locale), value: stats.expired.toLocaleString(), color: alertColors.expired, count: lots.filter((l) => l.alertLevel === "expired").length },
            { label: t("wms.critical", locale), value: stats.critical.toLocaleString(), color: alertColors.critical, count: lots.filter((l) => l.alertLevel === "critical").length },
            { label: t("wms.warning", locale), value: stats.warning.toLocaleString(), color: alertColors.warning, count: lots.filter((l) => l.alertLevel === "warning").length },
            { label: t("wms.normal", locale), value: stats.normal.toLocaleString(), color: alertColors.normal, count: lots.filter((l) => l.alertLevel === "normal").length },
          ].map((card) => (
            <div key={card.label} style={{
              flex: 1, padding: "14px 18px", borderRadius: 8, background: "var(--nav)", cursor: "pointer",
              border: filterLevel === card.label ? `2px solid ${card.color}` : "2px solid transparent",
            }} onClick={() => setFilterLevel(filterLevel === card.label ? "" : card.label)}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{card.label}</div>
              <strong style={{ fontSize: 20, color: card.color }}>{card.value}</strong>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>{card.count} {t("wms.lots", locale)}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-panel">
        <div className="section-header">
          <div><h3>{t("wms.lotHistory", locale)}</h3></div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>{sorted.length} {t("wms.lots", locale)}</div>
        </div>
        <div className="table-shell" style={{ maxHeight: 500, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>{t("common.material", locale)}</th>
                <th>{t("common.lot", locale)}</th>
                <th>{t("wms.receivedDate", locale)}</th>
                <th>{t("wms.expiryDate", locale)}</th>
                <th>{t("wms.daysRemaining", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("common.location", locale)}</th>
                <th>{t("common.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((lot) => (
                <tr key={lot.id}>
                  <td><strong>{lot.materialCode}</strong><br /><span style={{ fontSize: 10, color: "var(--muted)" }}>{lot.materialNameZh}</span></td>
                  <td><code style={{ fontSize: 10 }}>{lot.lotNo}</code></td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{lot.receivedDate}</td>
                  <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{lot.expiryDate}</td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 4,
                      background: alertColors[lot.alertLevel], color: "#fff", fontWeight: 600, fontSize: 12,
                    }}>
                      {lot.remainingDays <= 0 ? t("wms.expired", locale) : `${lot.remainingDays}d`}
                    </span>
                  </td>
                  <td>{lot.qty.toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{lot.location}</td>
                  <td>
                    <span className={`badge badge-${lot.alertLevel === "expired" ? "danger" : lot.alertLevel === "critical" ? "warning" : lot.alertLevel === "warning" ? "info" : "ok"}`}>
                      {lot.alertLevel === "expired" ? <Trash2 size={12} /> : <Clock size={12} />}
                      <span style={{ marginLeft: 4 }}>{t(`wms.alertLevel`, locale)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
