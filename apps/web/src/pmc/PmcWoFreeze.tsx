import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";
import type { WorkOrder } from "../api/pmc";

export function PmcWoFreeze({ locale }: { locale: Locale }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [action, setAction] = useState<"freeze" | "unfreeze">("freeze");
  const [freezeReason, setFreezeReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    pmcApi.getWorkOrders({ limit: 200 }).then((r) => {
      setWorkOrders(r.items.filter((w) => w.status !== "closed" && w.status !== "completed"));
    });
  }, []);

  async function handleSubmit() {
    if (!selectedCode) { setResult({ ok: false, msg: String(t("pmc.validationRequired", locale)) }); return; }
    if (action === "freeze" && !freezeReason.trim()) {
      setResult({ ok: false, msg: String(t("pmc.freezeReason", locale) + " — " + t("pmc.validationRequired", locale)) });
      return;
    }
    setSubmitting(true);
    setResult(null);
    const wo = workOrders.find((w) => w.code === selectedCode);
    try {
      const res: any = await pmcApi.freezeWorkOrder(selectedCode, {
        status: action === "freeze" ? "hold" : "released",
        changeReason: action === "freeze" ? freezeReason : undefined,
        operator: "VN_OP_001",
      });
      setResult({
        ok: true,
        msg: action === "freeze"
          ? String(t("pmc.freezeSuccess", locale))
          : String(t("pmc.unfreezeSuccess", locale)),
      });
      // Refresh list
      const updated = await pmcApi.getWorkOrders({ limit: 200 });
      setWorkOrders(updated.items.filter((w) => w.status !== "closed" && w.status !== "completed"));
      setFreezeReason("");
    } catch (e: any) {
      setResult({ ok: false, msg: String(e?.message ?? t("common.error", locale)) });
    } finally {
      setSubmitting(false);
    }
  }

  const wo = workOrders.find((w) => w.code === selectedCode);

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("pmc.woFreeze", locale)}</h2>
            <p>{t("pmc.woFreezeDesc", locale)}</p>
          </div>
        </div>
      </div>

      {/* WO selector */}
      <div className="surface-panel">
        <div className="section-header"><h3>{t("pmc.selectWorkOrder", locale)}</h3></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {workOrders.map((w) => (
            <button
              key={w.id}
              className={`badge ${w.code === selectedCode ? "badge-info" : "badge-muted"}`}
              style={{ cursor: "pointer", border: "none", fontSize: 12 }}
              onClick={() => { setSelectedCode(w.code); setResult(null); }}
            >
              {w.code} ({w.status})
            </button>
          ))}
        </div>
        {wo && (
          <div className="status-stack" style={{ marginTop: 12 }}>
            <div className="status-row"><span style={{ color: "var(--muted)" }}>{t("common.product", locale)}</span><span>{wo.productCode}</span></div>
            <div className="status-row"><span style={{ color: "var(--muted)" }}>{t("common.line", locale)}</span><span>{wo.lineCode}</span></div>
            <div className="status-row"><span style={{ color: "var(--muted)" }}>{t("common.qty", locale)}</span><span>{(wo.plannedQty ?? 0).toLocaleString()}</span></div>
          </div>
        )}
      </div>

      {/* Freeze / Unfreeze form */}
      <div className="surface-panel">
        <div className="section-header"><h3>{t("pmc.changeContent", locale)}</h3></div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            className={`badge ${action === "freeze" ? "badge-danger" : "badge-muted"}`}
            style={{ cursor: "pointer", border: "none", fontSize: 13, padding: "6px 12px" }}
            onClick={() => setAction("freeze")}
          >
            {t("pmc.freezeWo", locale)}
          </button>
          <button
            className={`badge ${action === "unfreeze" ? "badge-info" : "badge-muted"}`}
            style={{ cursor: "pointer", border: "none", fontSize: 13, padding: "6px 12px" }}
            onClick={() => setAction("unfreeze")}
          >
            {t("pmc.unfreezeWo", locale)}
          </button>
        </div>
        {action === "freeze" && (
          <div className="field">
            <label>{t("pmc.freezeReason", locale)} *</label>
            <textarea
              value={freezeReason}
              rows={2}
              placeholder={t("pmc.freezeReason", locale)}
              onChange={(e) => setFreezeReason(e.target.value)}
            />
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="action-button" onClick={handleSubmit} disabled={submitting || !selectedCode}>
            {submitting ? t("common.loading", locale) : t("pmc.submitChange", locale)}
          </button>
        </div>
        {result && (
          <div style={{ marginTop: 8, fontSize: 13, color: result.ok ? "var(--ok)" : "var(--danger)" }}>
            {result.msg}
          </div>
        )}
      </div>
    </div>
  );
}
