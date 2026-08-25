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

  useEffect(() => {
    wmsApi.getMaterialLots({ limit: 500 }).then((r: any) => {
      setLots(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = lots.filter((l) => {
    const matchText = !filter
      || (l.materialCode ?? "").toLowerCase().includes(filter.toLowerCase())
      || (l.name_zh ?? "").includes(filter)
      || (l.lotNo ?? "").toLowerCase().includes(filter.toLowerCase());
    const matchIqc = !iqcFilter || l.iqcStatus === iqcFilter;
    return matchText && matchIqc;
  });

  const iqcColor = (s: string) =>
    s === "released" ? "#22c55e" : s === "pending" ? "#f59e0b" : s === "hold" ? "#dc2626" : "#6b7280";

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
                <th>{t("wms.materialMaster.code", locale)}</th>
                <th>{t("wms.materialMaster.name", locale)}</th>
                <th>Lot No</th>
                <th>{t("wms.materialMaster.supplier", locale)}</th>
                <th>{t("wms.materialMaster.qty", locale)}</th>
                <th>Reserved</th>
                <th>{t("wms.materialMaster.receivedDate", locale)}</th>
                <th>{t("wms.materialMaster.manufacturingDate", locale)}</th>
                <th>{t("wms.materialMaster.expiryDate", locale)}</th>
                <th>IQC</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={11} className="empty-state">{t("common.loading", locale)}</td></tr>
               : filtered.length === 0 ? <tr><td colSpan={11} className="empty-state">{t("common.empty", locale)}</td></tr>
               : filtered.map((lot, idx) => (
                <tr key={lot.id}>
                  <td>{idx + 1}</td>
                  <td><code>{lot.materialCode}</code></td>
                  <td><strong>{lot.name_zh ?? lot.name_en}</strong></td>
                  <td><code>{lot.lotNo}</code></td>
                  <td>{lot.supplierCode ?? "\u2014"}</td>
                  <td>{(lot.qty ?? 0).toLocaleString()} {lot.uom ?? "PCS"}</td>
                  <td style={{ color: (lot.reservedQty ?? 0) > 0 ? "#f59e0b" : undefined }}>
                    {(lot.reservedQty ?? 0).toLocaleString()}
                  </td>
                  <td><code>{fmtDate(lot.receivedDate)}</code></td>
                  <td><code>{fmtDate(lot.manufacturingDate)}</code></td>
                  <td><code>{fmtDate(lot.expiryDate)}</code></td>
                  <td>
                    <span style={{ color: iqcColor(lot.iqcStatus ?? ""), fontWeight: 600 }}>
                      {lot.iqcStatus?.toUpperCase()}
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
