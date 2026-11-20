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


const alertColors: Record<string, string> = { expired: "var(--danger)", critical: "var(--warn)", warning: "#f59e0b", normal: "var(--ok)" };

export function WmsExpiryControl({ locale }: { locale: Locale }) {
  const [lots] = useState<ExpiryLot[]>([]);
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
