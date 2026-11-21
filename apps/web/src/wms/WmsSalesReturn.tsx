import { useState } from "react";
import { Undo2, Plus, CheckCircle, XCircle, Clock, Search } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

interface SalesReturnRecord {
  id: number;
  returnNo: string;
  customerCode: string;
  customerName: string;
  materialCode: string;
  materialNameZh: string;
  qty: number;
  reason: string;
  returnDate: string;
  status: "pending" | "approved" | "rejected" | "completed";
  inspector: string;
  disposition: string;
}


const statusColors: Record<string, string> = { pending: "var(--warn)", approved: "var(--info)", rejected: "var(--danger)", completed: "var(--ok)" };

export function WmsSalesReturn({ locale }: { locale: Locale }) {
  const [records] = useState<SalesReturnRecord[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newReturn, setNewReturn] = useState({ customerCode: "", materialCode: "", qty: 0, reason: "" });

  const submitReturn = () => {
    if (!newReturn.materialCode || !newReturn.qty) return;
    setNewReturn({ customerCode: "", materialCode: "", qty: 0, reason: "" });
    setShowForm(false);
  };

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Undo2 size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.salesReturn", locale)}</h2>
            <p>{t("wms.returnSubtitle", locale)}</p>
          </div>
          <button className="action-button" type="button" style={{ background: "var(--info)" }} onClick={() => setShowForm(true)}>
            <Plus size={14} /> {t("wms.newReturn", locale)}
          </button>
        </div>
      </section>

      {showForm && (
        <section className="surface-panel">
          <div className="section-header"><div><h3>{t("wms.newReturn", locale)}</h3></div></div>
          <div className="toolbar" style={{ gap: 12, flexWrap: "wrap" }}>
            <input className="input" style={{ padding: "4px 10px", width: 160 }} placeholder={t("wms.customerCode", locale)}
              value={newReturn.customerCode} onChange={(e) => setNewReturn((p) => ({ ...p, customerCode: e.target.value }))} />
            <input className="input" style={{ padding: "4px 10px", width: 160 }} placeholder={t("common.material", locale)}
              value={newReturn.materialCode} onChange={(e) => setNewReturn((p) => ({ ...p, materialCode: e.target.value }))} />
            <input className="input" type="number" style={{ padding: "4px 10px", width: 100 }} placeholder={t("common.qty", locale)}
              value={newReturn.qty || ""} onChange={(e) => setNewReturn((p) => ({ ...p, qty: Number(e.target.value) }))} />
            <input className="input" style={{ padding: "4px 10px", width: 200 }} placeholder={t("wms.returnReason", locale)}
              value={newReturn.reason} onChange={(e) => setNewReturn((p) => ({ ...p, reason: e.target.value }))} />
            <button className="action-button" type="button" style={{ background: "var(--ok)" }} onClick={submitReturn}>
              <CheckCircle size={14} /> {t("common.submit", locale)}
            </button>
          </div>
        </section>
      )}

      <section className="surface-panel">
        <div className="section-header"><div><h3>{t("wms.returnHistory", locale)}</h3></div></div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("wms.returnNo", locale)}</th>
                <th>{t("common.customer", locale)}</th>
                <th>{t("common.material", locale)}</th>
                <th>{t("common.qty", locale)}</th>
                <th>{t("wms.returnReason", locale)}</th>
                <th>{t("common.date", locale)}</th>
                <th>{t("common.status", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <>
                  <tr key={r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{ cursor: "pointer" }}>
                    <td><code style={{ fontSize: 11 }}>{r.returnNo}</code></td>
                    <td><strong>{r.customerName}</strong><br /><code style={{ fontSize: 10, color: "var(--muted)" }}>{r.customerCode}</code></td>
                    <td>{r.materialCode}<br /><span style={{ fontSize: 11, color: "var(--muted)" }}>{r.materialNameZh}</span></td>
                    <td>{r.qty.toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{r.reason}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.returnDate}</td>
                    <td>
                      <span className="badge" style={{ background: statusColors[r.status], color: "#fff" }}>
                        {r.status === "pending" ? <Clock size={12} /> : r.status === "approved" ? <Search size={12} /> : r.status === "rejected" ? <XCircle size={12} /> : <CheckCircle size={12} />}
                        <span style={{ marginLeft: 4 }}>{t(`common.status`, locale)}</span>
                      </span>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={7} style={{ padding: "12px 20px", background: "rgba(0,0,0,0.02)" }}>
                        <div className="toolbar" style={{ gap: 24 }}>
                          <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.inspector", locale)}</span><br /><strong>{r.inspector || "—"}</strong></div>
                          <div><span style={{ fontSize: 11, color: "var(--muted)" }}>{t("wms.disposition", locale)}</span><br /><strong>{r.disposition || "—"}</strong></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
