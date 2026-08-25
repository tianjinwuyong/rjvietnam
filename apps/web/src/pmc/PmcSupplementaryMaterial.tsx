import { useEffect, useState, type ChangeEvent } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { pmcApi } from "../api";

type SortKey = "workOrderCode" | "materialCode" | "requiredQty" | "status" | "createdAt";

interface SuppItem {
  id: number;
  requiredQty: number;
  uom: string;
  reason: string;
  status: string;
  createdAt: string;
  workOrderCode: string;
  plannedQty: number;
  productCode: string;
  productNameZh: string;
  materialCode: string;
  materialNameZh: string;
  requestedByName: string;
}

const statusBadge: Record<string, "warning" | "info" | "ok" | "muted"> = {
  pending: "warning",
  approved: "info",
  issued: "ok",
  closed: "muted",
};

function PmcSupplementaryMaterial({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<SuppItem[]>([]);
  const [summary, setSummary] = useState<Array<{ status: string; count: string; total_qty: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [woFilter, setWoFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ workOrderCode: "", materialCode: "", requiredQty: "", uom: "PCS", reason: "", requestedByName: "PMC" });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedWo, setSelectedWo] = useState<string>("");

  const fetchData = () => {
    setLoading(true);
    const params: any = {};
    if (woFilter) params.workOrderCode = woFilter;
    if (filter) params.status = filter;
    pmcApi.getSupplementaryMaterials(params).then((r: any) => {
      setItems(r.items ?? []);
      setSummary(r.summary ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [woFilter, filter]);

  const handleCreate = async () => {
    if (!form.workOrderCode || !form.materialCode || !form.requiredQty || !form.reason) {
      setMsg({ ok: false, text: t("pmc.validationRequired", locale) });
      return;
    }
    setSubmitting(true);
    try {
      await pmcApi.createSupplementaryMaterial({
        workOrderCode: form.workOrderCode,
        materialCode: form.materialCode,
        requiredQty: Number(form.requiredQty),
        uom: form.uom,
        reason: form.reason,
        requestedByName: form.requestedByName,
      });
      setMsg({ ok: true, text: t("pmc.submitOK", locale) });
      setShowForm(false);
      setForm({ workOrderCode: "", materialCode: "", requiredQty: "", uom: "PCS", reason: "", requestedByName: "PMC" });
      fetchData();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: number, newStatus: string) => {
    try {
      await pmcApi.patchSupplementaryMaterial(id, { status: newStatus });
      fetchData();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Cancel this request?")) return;
    try {
      await pmcApi.deleteSupplementaryMaterial(id);
      fetchData();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    }
  };

  const sorted = [...items]
    .filter((s) => !woFilter || s.workOrderCode.includes(woFilter))
    .filter((s) => !filter || s.status === filter)
    .sort((a, b) => {
      const aVal = a[sortKey as keyof SuppItem];
      const bVal = b[sortKey as keyof SuppItem];
      const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal as string) : (aVal as number) - (bVal as number);
      return sortAsc ? cmp : -cmp;
    });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const pendingCount = summary.find((s) => s.status === "pending")?.count ?? "0";
  const approvedCount = summary.find((s) => s.status === "approved")?.count ?? "0";
  const issuedCount = summary.find((s) => s.status === "issued")?.count ?? "0";

  return (
    <div className="screen-stack">
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div className="surface-panel" style={{ padding: "10px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("pmc.pendingReview", locale)}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#f59e0b" }}>{pendingCount}</div>
        </div>
        <div className="surface-panel" style={{ padding: "10px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Approved</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#3b82f6" }}>{approvedCount}</div>
        </div>
        <div className="surface-panel" style={{ padding: "10px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Issued</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#22c55e" }}>{issuedCount}</div>
        </div>
      </div>

      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.supplementary.title", locale)}</h2>
            <p>{t("pmc.supplementary.subtitle", locale)}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? t("common.cancel", locale) : t("pmc.supplementary.add", locale)}
          </button>
        </div>

        {showForm && (
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="form-field">
              <label>{t("common.workOrder", locale)} *</label>
              <input className="input" value={form.workOrderCode} onChange={(e) => setForm({ ...form, workOrderCode: e.target.value })} placeholder="e.g. 260101L0010001" />
            </div>
            <div className="form-field">
              <label>{t("table.material", locale)} *</label>
              <input className="input" value={form.materialCode} onChange={(e) => setForm({ ...form, materialCode: e.target.value })} placeholder="e.g. RES-0402-10K" />
            </div>
            <div className="form-field">
              <label>{t("pmc.supplementary.qty", locale)} *</label>
              <input className="input" type="number" value={form.requiredQty} onChange={(e) => setForm({ ...form, requiredQty: e.target.value })} placeholder="1000" />
            </div>
            <div className="form-field">
              <label>UOM</label>
              <input className="input" value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })} placeholder="PCS" />
            </div>
            <div className="form-field" style={{ gridColumn: "1/-1" }}>
              <label>{t("pmc.supplementary.reason", locale)} *</label>
              <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="BOMqty insufficient / rework / material defect" />
            </div>
            {msg && (
              <div style={{ gridColumn: "1/-1", padding: "8px 12px", borderRadius: 6, background: msg.ok ? "#22c55e22" : "#ef444422", color: msg.ok ? "#22c55e" : "#ef4444", fontSize: 13 }}>
                {msg.text}
              </div>
            )}
            <div style={{ gridColumn: "1/-1" }}>
              <button className="btn btn-primary" onClick={handleCreate} disabled={submitting}>
                {submitting ? t("common.loading", locale) : t("pmc.supplementary.add", locale)}
              </button>
            </div>
          </div>
        )}

        <div className="toolbar">
          <input className="input" placeholder={t("pmc.supplementary.search", locale)} value={woFilter} onChange={(e: ChangeEvent<HTMLInputElement>) => setWoFilter(e.target.value)} style={{ maxWidth: 220 }} />
          <select className="input" value={filter} onChange={(e: ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="">{t("common.all", locale)}</option>
            <option value="pending">{t("pmc.status.pending", locale)}</option>
            <option value="approved">Approved</option>
            <option value="issued">Issued</option>
            <option value="closed">{t("common.closed", locale)}</option>
          </select>
        </div>
      </section>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th onClick={() => toggleSort("workOrderCode")}>{t("common.workOrder", locale)}</th>
                <th onClick={() => toggleSort("materialCode")}>{t("table.material", locale)}</th>
                <th onClick={() => toggleSort("requiredQty")}>{t("pmc.supplementary.qty", locale)}</th>
                <th>{t("pmc.supplementary.reason", locale)}</th>
                <th onClick={() => toggleSort("status")}>{t("common.status", locale)}</th>
                <th>{t("common.operator", locale)}</th>
                <th onClick={() => toggleSort("createdAt")}>{t("common.date", locale)}</th>
                <th>{t("common.actions", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="empty-state">{t("common.loading", locale)}</td></tr>
              ) : sorted.length === 0 ? (
                <tr><td colSpan={8} className="empty-state">{t("common.empty", locale)}</td></tr>
              ) : sorted.map((item) => (
                <tr key={item.id}>
                  <td><code>{item.workOrderCode}</code><br/><small style={{ color: "var(--muted)" }}>{item.productCode}</small></td>
                  <td>
                    <div>{item.materialCode}</div>
                    <small style={{ color: "var(--muted)" }}>{item.materialNameZh}</small>
                  </td>
                  <td>{Number(item.requiredQty).toLocaleString()} {item.uom}</td>
                  <td style={{ maxWidth: 200 }}><span title={item.reason}>{item.reason.length > 50 ? item.reason.slice(0, 50) + "…" : item.reason}</span></td>
                  <td><span className={`badge badge-${statusBadge[item.status] ?? "muted"}`}>{item.status}</span></td>
                  <td>{item.requestedByName}</td>
                  <td>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ""}</td>
                  <td>
                    {item.status === "pending" && (
                      <>
                        <button className="btn-link" style={{ color: "#3b82f6", marginRight: 8 }} onClick={() => handleStatusChange(item.id, "approved")}>Approve</button>
                        <button className="btn-link" style={{ color: "#ef4444", marginRight: 8 }} onClick={() => handleDelete(item.id)}>Cancel</button>
                      </>
                    )}
                    {item.status === "approved" && (
                      <button className="btn-link" style={{ color: "#22c55e" }} onClick={() => handleStatusChange(item.id, "issued")}>Issue</button>
                    )}
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

export { PmcSupplementaryMaterial };
