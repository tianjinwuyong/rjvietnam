import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, Plus, Eye } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api";
import type { FirstArticleInspection, FirstArticleCheckItem } from "../api/mes";

const resultBadge: Record<string, string> = { PASS: "badge-ok", FAIL: "badge-danger" };

function FAIResultBadge({ result, locale }: { result: string; locale: Locale }) {
  return (
    <span className={`badge ${resultBadge[result] ?? "badge-info"}`}>
      {result === "PASS" ? <CheckCircle size={12} /> : <XCircle size={12} />}
      {t(`mes.firstarticle.result.${result}` as any, locale)}
    </span>
  );
}

function InspectRow({ insp, locale, onView }: { insp: FirstArticleInspection; locale: Locale; onView: (id: number) => void }) {
  return (
    <tr>
      <td>{insp.workOrderCode ?? "—"}</td>
      <td>{insp.stationCode}</td>
      <td>{insp.stationName ?? "—"}</td>
      <td>{insp.lineCode ?? "—"}</td>
      <td><FAIResultBadge result={insp.result} locale={locale} /></td>
      <td>{insp.checkedBy ?? "—"}</td>
      <td>{new Date(insp.checkedAt).toLocaleDateString()}</td>
      <td>{insp.lotNo ?? "—"}</td>
      <td>{insp.remarks ?? "—"}</td>
      <td>
        <button type="button" className="action-button" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => onView(insp.id)}>
          <Eye size={12} />
        </button>
      </td>
    </tr>
  );
}

export function FirstArticleInspectionPage({ locale }: { locale: Locale }) {
  const [inspections, setInspections] = useState<FirstArticleInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState<"all" | "PASS" | "FAIL">("all");
  const [viewId, setViewId] = useState<number | null>(null);
  const [viewData, setViewData] = useState<FirstArticleInspection & { checkItems: FirstArticleCheckItem[] } | null>(null);

  useEffect(() => { load(); }, [resultFilter]);

  function load() {
    setLoading(true);
    mesApi.getFirstArticleInspections({ result: resultFilter === "all" ? undefined : resultFilter }).then(r => {
      setInspections(r.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  function handleView(id: number) {
    setViewId(id);
    mesApi.getFirstArticleInspection(id).then(d => setViewData(d)).catch(() => setViewId(null));
  }

  const passCount = inspections.filter(i => i.result === "PASS").length;
  const failCount = inspections.filter(i => i.result === "FAIL").length;

  return (
    <div className="screen-stack">
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("mes.firstarticle.result.PASS" as any, locale)}</span>
          <strong>{passCount}</strong>
          <span className="badge badge-ok"><CheckCircle size={12} /></span>
        </article>
        <article className="stat-card">
          <span>{t("mes.firstarticle.result.FAIL" as any, locale)}</span>
          <strong>{failCount}</strong>
          <span className="badge badge-danger"><XCircle size={12} /></span>
        </article>
        <article className="stat-card">
          <span>{t("common.total" as any, locale)}</span>
          <strong>{inspections.length}</strong>
          <span className="badge badge-info">{t("mes.firstarticle.title" as any, locale)}</span>
        </article>
      </div>

      <div className="toolbar">
        {(["all", "PASS", "FAIL"] as const).map(r => (
          <button key={r} type="button" className={`action-button ${resultFilter === r ? "active" : ""}`} onClick={() => setResultFilter(r)}>
            {r === "all" ? t("mes.foolproof.filter.all" as any, locale) : t(`mes.firstarticle.result.${r}` as any, locale)}
          </button>
        ))}
      </div>

      {viewId && viewData && (
        <section className="surface-panel">
          <div className="section-header">
            <h2>{t("mes.firstarticle.detail.title" as any, locale)} — {viewData.workOrderCode}</h2>
            <button type="button" className="action-button" style={{ marginLeft: "auto" }} onClick={() => { setViewId(null); setViewData(null); }}>
              {t("common.close" as any, locale)}
            </button>
          </div>
          <div style={{ padding: "0 16px 16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
              <div><strong>{t("mes.foolproof.station" as any, locale)}:</strong> {viewData.stationCode}</div>
              <div><strong>{t("common.result" as any, locale)}:</strong> <FAIResultBadge result={viewData.result} locale={locale} /></div>
              <div><strong>{t("common.checkedBy" as any, locale)}:</strong> {viewData.checkedBy ?? "—"}</div>
            </div>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>{t("mes.firstarticle.checkItem.type" as any, locale)}</th>
                    <th>{t("mes.firstarticle.checkItem.material" as any, locale)}</th>
                    <th>{t("mes.firstarticle.checkItem.expected" as any, locale)}</th>
                    <th>{t("mes.firstarticle.checkItem.actual" as any, locale)}</th>
                    <th>{t("common.result" as any, locale)}</th>
                    <th>{t("common.notes" as any, locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {viewData.checkItems.map(item => (
                    <tr key={item.id}>
                      <td><span className="badge badge-info">{item.checkType}</span></td>
                      <td>{item.materialCode ?? "—"}</td>
                      <td>{item.expectedValue ?? "—"}</td>
                      <td>{item.actualValue ?? "—"}</td>
                      <td><FAIResultBadge result={item.result} locale={locale} /></td>
                      <td>{item.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="surface-panel">
        <div className="section-header">
          <h2>{t("mes.firstarticle.title" as any, locale)}</h2>
          <p>{t("mes.firstarticle.subtitle" as any, locale)}</p>
        </div>
        {loading ? (
          <div className="placeholder-view">{t("common.loading" as any, locale)}</div>
        ) : inspections.length === 0 ? (
          <div className="placeholder-view"><CheckCircle size={40} /><p>{t("common.noData" as any, locale)}</p></div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>{t("common.workOrder" as any, locale)}</th>
                  <th>{t("mes.foolproof.station" as any, locale)}</th>
                  <th>{t("mes.foolproof.stationName" as any, locale)}</th>
                  <th>{t("mes.foolproof.line" as any, locale)}</th>
                  <th>{t("common.result" as any, locale)}</th>
                  <th>{t("common.checkedBy" as any, locale)}</th>
                  <th>{t("common.date" as any, locale)}</th>
                  <th>{t("mes.firstarticle.lotNo" as any, locale)}</th>
                  <th>{t("common.notes" as any, locale)}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {inspections.map(i => <InspectRow key={i.id} insp={i} locale={locale} onView={handleView} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}