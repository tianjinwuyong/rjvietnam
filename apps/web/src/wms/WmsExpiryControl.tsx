import { useEffect, useState, useMemo } from "react";
import { CalendarClock, Clock, CheckCircle, Trash2 } from "lucide-react";
import { t } from "../i18n";
import { apiClient } from "../api/client";
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

/** 服务端 /wms/inventory-expiry：bucket = expired / d7 / d30 / ok */
interface ExpiryRow {
  id: number; lotNo: string; materialCode: string; materialName: string;
  unit?: string; receivedQty: number; expiryDate: string; manufacturingDate?: string | null;
  daysLeft: number; bucket: "expired" | "d7" | "d30" | "ok";
}

const BUCKET_TO_LEVEL: Record<ExpiryRow["bucket"], ExpiryLot["alertLevel"]> = {
  expired: "expired", d7: "critical", d30: "warning", ok: "normal",
};

const alertColors: Record<string, string> = { expired: "var(--danger)", critical: "var(--warn)", warning: "#f59e0b", normal: "var(--ok)" };

export function WmsExpiryControl({ locale }: { locale: Locale }) {
  const [lots, setLots] = useState<ExpiryLot[]>([]);
  const [filterLevel, setFilterLevel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiClient.get<{ data: ExpiryRow[] }>("/wms/inventory-expiry")
      .then((r) => {
        if (!alive) return;
        setLots((r.data || []).map((x) => ({
          id: x.id, materialCode: x.materialCode, materialNameZh: x.materialName || "",
          lotNo: x.lotNo, receivedDate: x.manufacturingDate || "", expiryDate: x.expiryDate,
          remainingDays: Number(x.daysLeft ?? 0), qty: Number(x.receivedQty ?? 0),
          location: "", alertLevel: BUCKET_TO_LEVEL[x.bucket] || "normal",
        })));
        setError("");
      })
      .catch((err) => { if (alive) setError(String(err?.message || err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const stats = useMemo(() => ({
    expired: lots.filter((l) => l.alertLevel === "expired").reduce((s, l) => s + l.qty, 0),
    critical: lots.filter((l) => l.alertLevel === "critical").reduce((s, l) => s + l.qty, 0),
    warning: lots.filter((l) => l.alertLevel === "warning").reduce((s, l) => s + l.qty, 0),
    normal: lots.filter((l) => l.alertLevel === "normal").reduce((s, l) => s + l.qty, 0),
  }), [lots]);

  const filtered = lots
    .filter((l) => (filterLevel ? l.alertLevel === filterLevel : true))
    .filter((l) => (q.trim()
      ? `${l.materialCode} ${l.materialNameZh} ${l.lotNo}`.toLowerCase().includes(q.trim().toLowerCase())
      : true));
  const sorted = useMemo(() => [...filtered].sort((a, b) => a.remainingDays - b.remainingDays), [filtered]);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><CalendarClock size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.expiryControl", locale)}</h2>
            <p>{t("wms.expiryMonitor", locale)}</p>
          </div>
          <div className="toolbar" style={{ gap: 8, fontSize: 11, color: "var(--muted)", alignItems: "center" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("common.search", locale)}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
            {loading ? <span>{t("common.loading", locale)}</span> : null}
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: alertColors.expired }} /> {t("wms.expired", locale)}
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: alertColors.critical, marginLeft: 8 }} /> ≤7d
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: alertColors.warning, marginLeft: 8 }} /> ≤30d
            <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: alertColors.normal, marginLeft: 8 }} /> OK
          </div>
        </div>
        {error ? (
          <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{error}</p>
        ) : null}
      </section>

      <section className="surface-panel">
        <div style={{ display: "flex", gap: 16 }}>
          {([
            { level: "expired", label: t("wms.expired", locale), value: stats.expired.toLocaleString(), color: alertColors.expired },
            { level: "critical", label: t("wms.critical", locale), value: stats.critical.toLocaleString(), color: alertColors.critical },
            { level: "warning", label: t("wms.warning", locale), value: stats.warning.toLocaleString(), color: alertColors.warning },
            { level: "normal", label: t("wms.normal", locale), value: stats.normal.toLocaleString(), color: alertColors.normal },
          ] as const).map((card) => (
            <div key={card.level} style={{
              flex: 1, padding: "14px 18px", borderRadius: 8, background: "var(--nav)", cursor: "pointer",
              border: filterLevel === card.level ? `2px solid ${card.color}` : "2px solid transparent",
            }} onClick={() => setFilterLevel(filterLevel === card.level ? "" : card.level)}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{card.label}</div>
              <strong style={{ fontSize: 20, color: card.color }}>{card.value}</strong>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>{lots.filter((l) => l.alertLevel === card.level).length} {t("wms.lots", locale)}</div>
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
