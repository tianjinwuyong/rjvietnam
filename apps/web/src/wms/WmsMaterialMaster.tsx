import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale, MaterialLot } from "../../../../packages/shared-types/src/factory";
import { wmsApi } from "../api";

function fmtDate(s: string | undefined): string {
  if (!s) return "\u2014";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "\u2014" : d.toLocaleDateString();
}

export function WmsMaterialMaster({ locale }: { locale: Locale }) {
  const [lots, setLots] = useState<MaterialLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [iqcFilter, setIqcFilter] = useState("");
  const [lowEdit, setLowEdit] = useState<{ lot: MaterialLot; value: string } | null>(null);
  const [savingLow, setSavingLow] = useState(false);

  const load = () => {
    setLoading(true);
    wmsApi.getMaterialLots({ limit: 500 }).then((r: any) => {
      setLots(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(load, []);

  const saveLowLevel = async () => {
    if (!lowEdit) return;
    const v = Number(lowEdit.value);
    if (!Number.isFinite(v) || v < 0) return;
    setSavingLow(true);
    try {
      await wmsApi.setLowStockLevel(lowEdit.lot.id as number, v);
      setLowEdit(null);
      load();
    } finally {
      setSavingLow(false);
    }
  };

  const filtered = lots.filter((l) => {
    const matchText = !filter
      || (l.materialCode ?? "").toLowerCase().includes(filter.toLowerCase())
      || (l.name_zh ?? "").includes(filter)
      || (l.vietnamCode ?? "").toLowerCase().includes(filter.toLowerCase())
      || (l.lotNo ?? "").toLowerCase().includes(filter.toLowerCase());
    const matchIqc = !iqcFilter || l.iqcStatus === iqcFilter;
    return matchText && matchIqc;
  });

  const iqcColor = (s: string) =>
    s === "released" ? "#22c55e" : s === "rejected" ? "#dc2626" : s === "pending" ? "#f59e0b" : s === "hold" ? "#dc2626" : "#6b7280";
  const iqcLabel = (s: string) => {
    const v = (s ?? "").toLowerCase();
    if (v === "released") return locale === "vi-VN" ? "Thông qua" : locale === "en-US" ? "RELEASED" : "放行";
    if (v === "rejected") return locale === "vi-VN" ? "Từ chối" : locale === "en-US" ? "REJECTED" : "拒绝";
    if (v === "pending") return locale === "vi-VN" ? "Chờ KT" : locale === "en-US" ? "PENDING" : "待检";
    if (v === "hold") return locale === "vi-VN" ? "Tạm giữ" : locale === "en-US" ? "HOLD" : "暂扣";
    return (s ?? "").toUpperCase() || "—";
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("wms.subnav.materialMaster", locale)}</h2>
            <p>{t("wms.subnav.basicData", locale)}</p>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {filtered.length} lots
          </div>
        </div>
        <div className="toolbar">
          <input className="input" placeholder={t("common.search", locale)}
            value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 220 }} />
          <select className="input" value={iqcFilter} onChange={(e) => setIqcFilter(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">All IQC Status</option>
            <option value="pending">Pending</option>
            <option value="hold">Hold</option>
            <option value="released">Released</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </section>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("wms.materialMaster.seq", locale)}</th>
                <th>标记</th>
                <th>{t("wms.materialMaster.code", locale)}</th>
                <th>{t("wms.materialMaster.vietnamCode", locale)}</th>
                <th>{t("wms.materialMaster.name", locale)}</th>
                <th>Lot No</th>
                <th>{t("wms.materialMaster.supplier", locale)}</th>
                <th>{t("wms.materialMaster.qty", locale)}</th>
                <th>{t("wms.materialMaster.issued", locale)}</th>
                <th>{t("wms.materialMaster.reserved", locale)}</th>
                <th>{t("wms.materialMaster.locationQr", locale)}</th>
                <th>{t("wms.materialMaster.receivedDate", locale)}</th>
                <th>{t("wms.materialMaster.manufacturingDate", locale)}</th>
                <th>{t("wms.materialMaster.expiryDate", locale)}</th>
                <th>IQC</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={15} className="empty-state">{t("common.loading", locale)}</td></tr>
               : filtered.length === 0 ? <tr><td colSpan={15} className="empty-state">{t("common.empty", locale)}</td></tr>
               : filtered.map((lot, idx) => {
                const isTest = /^TST-/i.test(lot.lotNo ?? "") || /^TEST\d*/i.test(lot.palletQr ?? "") || /TEST14/i.test(lot.palletQr ?? "");
                const onHand = Number(lot.onHand ?? 0);
                const lowLevel = Number(lot.lowStockLevel ?? 0);
                const isLow = lowLevel > 0 && onHand < lowLevel;
                return (
                <tr key={lot.id} style={isTest ? { background: "rgba(244, 114, 182, .14)" } : undefined}>
                  <td>{idx + 1}</td>
                  <td>{isTest ? <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "#f472b6", color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: ".5px" }}>TEST</span> : <span style={{ color: "var(--muted)", fontSize: 11 }}>—</span>}</td>
                  <td><code>{lot.materialCode}</code></td>
                  <td><code>{lot.vietnamCode || "\u2014"}</code></td>
                  <td><strong>{lot.name_zh ?? lot.name_en}</strong></td>
                  <td><code>{lot.lotNo}</code></td>
                  <td>{lot.supplierCode ?? "\u2014"}</td>
                  <td className={isLow ? "wms-low-stock-blink" : undefined}
                    title={t("wms.materialMaster.clickToSetLow", locale)}
                    onClick={() => setLowEdit({ lot, value: String(lot.lowStockLevel ?? 0) })}
                    style={isLow ? { cursor: "pointer" } : { color: onHand <= 0 ? "#dc2626" : "#16a34a", fontWeight: 700, cursor: "pointer" }}>
                    {Math.round(onHand).toLocaleString()} {lot.uom ?? "PCS"}
                  </td>
                  <td style={{ color: Number(lot.qty ?? 0) - Number(lot.onHand ?? 0) > 0 ? "#dc2626" : undefined, fontWeight: 700 }}>
                    {Math.round(Number(lot.qty ?? 0) - Number(lot.onHand ?? 0)).toLocaleString()}
                  </td>
                  <td style={{ color: (lot.reservedQty ?? 0) > 0 ? "#f59e0b" : undefined }}>
                    {Math.round(Number(lot.reservedQty ?? 0)).toLocaleString()}
                  </td>
                  <td><code style={{ fontSize: 10 }}>{lot.locationQr || "—"}</code></td>
                  <td><code>{fmtDate(lot.receivedDate)}</code></td>
                  <td><code>{fmtDate(lot.manufacturingDate)}</code></td>
                  <td><code>{fmtDate(lot.expiryDate)}</code></td>
                  <td>
                    <span style={{ color: iqcColor(lot.iqcStatus ?? ""), fontWeight: 700 }}>
                      {iqcLabel(lot.iqcStatus ?? "")}
                    </span>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {lowEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
          onClick={() => { if (!savingLow) setLowEdit(null); }}>
          <div style={{ background: "var(--panel, #fff)", borderRadius: 10, padding: 20, minWidth: 300, boxShadow: "0 12px 40px rgba(0,0,0,.3)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 4px" }}>{t("wms.materialMaster.lowLevel", locale)}</h3>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--muted)" }}>
              <code>{lowEdit.lot.lotNo}</code> · {t("wms.materialMaster.lowLevelHint", locale)}
            </p>
            <input className="input" type="number" min={0} autoFocus
              value={lowEdit.value} onChange={(e) => setLowEdit({ ...lowEdit, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") saveLowLevel(); }}
              style={{ width: "100%", marginBottom: 12 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" disabled={savingLow} onClick={() => setLowEdit(null)}>
                {t("common.cancel", locale)}
              </button>
              <button className="btn btn-primary" disabled={savingLow} onClick={saveLowLevel}>
                {t("common.save", locale)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
