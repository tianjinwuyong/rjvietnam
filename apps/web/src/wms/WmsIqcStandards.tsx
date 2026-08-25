import { useCallback, useEffect, useState } from "react";
import { CheckCircle, RefreshCw, Ruler, XCircle } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { wmsApi, type IqcPlan } from "../api/wms";

export function WmsIqcStandards({ locale }: { locale: Locale }) {
  const [plans, setPlans] = useState<IqcPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await wmsApi.getIqcPlans();
      setPlans(response.items);
    } catch (cause) {
      setPlans([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (id: number, decision: "APPROVE" | "REJECT") => {
    setBusyId(id);
    setError("");
    try {
      await wmsApi.decideIqcPlan(id, decision);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const nameFor = (item: IqcPlan["characteristics"][number]) =>
    locale === "vi-VN" ? item.name_vi ?? item.name_zh : locale === "en-US" ? item.name_en ?? item.name_zh : item.name_zh;

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Ruler size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />{t("wms.subnav.iqcStandards", locale)}</h2>
            <p>{t("wms.iqcStandardsDesc", locale)}</p>
          </div>
          <button className="action-button" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> {t("common.refresh", locale)}
          </button>
        </div>
        {error && <div style={{ color: "var(--danger)", padding: 8 }}>{error}</div>}
      </section>

      <section className="surface-panel">
        <div className="table-shell">
          <table>
            <thead><tr>
              <th>{t("common.code", locale)}</th><th>{t("common.material", locale)}</th>
              <th>{t("common.version", locale)}</th><th>{t("wms.testItem", locale)}</th>
              <th>{t("common.status", locale)}</th><th>{t("table.action", locale)}</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6}>{t("common.loading", locale)}</td></tr> : plans.length === 0 ?
                <tr><td colSpan={6}>{t("common.noData", locale)}</td></tr> : plans.map((plan) => (
                  <tr key={plan.id}>
                    <td><strong>{plan.planCode}</strong></td>
                    <td>{plan.materialCode ?? plan.categoryCode ?? "—"}</td>
                    <td>{plan.revision}</td>
                    <td>{plan.characteristics.map(nameFor).join(" · ")}</td>
                    <td><span className={`badge badge-${plan.status === "ACTIVE" ? "ok" : plan.status === "DRAFT" ? "warning" : "danger"}`}>{plan.status}</span></td>
                    <td>
                      {plan.status === "DRAFT" && <div className="toolbar">
                        <button className="action-button" type="button" disabled={busyId === plan.id} onClick={() => void decide(plan.id, "APPROVE")}><CheckCircle size={13} /></button>
                        <button className="action-button" type="button" style={{ background: "var(--danger)" }} disabled={busyId === plan.id} onClick={() => void decide(plan.id, "REJECT")}><XCircle size={13} /></button>
                      </div>}
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
