import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, ShieldCheck } from "lucide-react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { mesApi } from "../api";
import type { MaterialVerification } from "../api/mes";

const matchBadge: Record<string, string> = { PASS: "badge-ok", FAIL: "badge-danger" };

function VerificationRow({ v, locale }: { v: MaterialVerification; locale: Locale }) {
  return (
    <tr>
      <td>{v.workOrderCode ?? "—"}</td>
      <td>{v.stationCode}</td>
      <td>{v.stationName ?? "—"}</td>
      <td>{v.lineCode ?? "—"}</td>
      <td><span className="badge badge-info">{v.feederSlot ?? "—"}</span></td>
      <td>{v.materialCode ?? "—"}</td>
      <td>{v.expectedReel ?? "—"}</td>
      <td style={{ color: v.matchResult === "FAIL" ? "var(--danger)" : "inherit" }}>{v.actualReel ?? "—"}</td>
      <td>
        <span className={`badge ${matchBadge[v.matchResult] ?? "badge-info"}`}>
          {v.matchResult === "PASS" ? <CheckCircle size={12} /> : <XCircle size={12} />}
          {v.matchResult}
        </span>
      </td>
      <td>{v.verifiedBy ?? "—"}</td>
      <td>{new Date(v.verifiedAt).toLocaleDateString()}</td>
    </tr>
  );
}

export function MaterialVerificationPage({ locale }: { locale: Locale }) {
  const [records, setRecords] = useState<MaterialVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchFilter, setMatchFilter] = useState<"all" | "PASS" | "FAIL">("all");

  useEffect(() => { load(); }, [matchFilter]);

  function load() {
    setLoading(true);
    mesApi.getMaterialVerifications({ matchResult: matchFilter === "all" ? undefined : matchFilter }).then(r => {
      setRecords(r.items);
      setLoading(false);
    }).catch(() => setLoading(false));
  }

  const passCount = records.filter(r => r.matchResult === "PASS").length;
  const failCount = records.filter(r => r.matchResult === "FAIL").length;
  const matchRate = records.length ? Math.round((passCount / records.length) * 100) : 0;

  return (
    <div className="screen-stack">
      <div className="metric-grid">
        <article className="stat-card">
          <span>{t("mes.materialverify.filter.pass" as any, locale)}</span>
          <strong>{passCount}</strong>
          <span className="badge badge-ok"><CheckCircle size={12} /></span>
        </article>
        <article className="stat-card">
          <span>{t("mes.materialverify.filter.fail" as any, locale)}</span>
          <strong>{failCount}</strong>
          <span className={`badge ${failCount > 0 ? "badge-danger" : "badge-ok"}`}><XCircle size={12} /></span>
        </article>
        <article className="stat-card">
          <span>{t("mes.materialverify.matchRate" as any, locale)}</span>
          <strong>{matchRate}%</strong>
          <span className={`badge ${matchRate >= 95 ? "badge-ok" : matchRate >= 80 ? "badge-warning" : "badge-danger"}`}>
            <ShieldCheck size={12} />
          </span>
        </article>
      </div>

      <div className="toolbar">
        {(["all", "PASS", "FAIL"] as const).map(m => (
          <button key={m} type="button" className={`action-button ${matchFilter === m ? "active" : ""}`} onClick={() => setMatchFilter(m)}>
            {m === "all" ? t("mes.foolproof.filter.all" as any, locale) : t(`mes.materialverify.filter.${m.toLowerCase()}` as any, locale)}
          </button>
        ))}
      </div>

      <section className="surface-panel">
        <div className="section-header">
          <h2>{t("mes.materialverify.title" as any, locale)}</h2>
          <p>{t("mes.materialverify.subtitle" as any, locale)}</p>
        </div>
        {loading ? (
          <div className="placeholder-view">{t("common.loading" as any, locale)}</div>
        ) : records.length === 0 ? (
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
                  <th>{t("mes.foolproof.feederSlot" as any, locale)}</th>
                  <th>{t("mes.foolproof.materialCode" as any, locale)}</th>
                  <th>{t("mes.materialverify.expectedReel" as any, locale)}</th>
                  <th>{t("mes.materialverify.actualReel" as any, locale)}</th>
                  <th>{t("common.result" as any, locale)}</th>
                  <th>{t("common.verifiedBy" as any, locale)}</th>
                  <th>{t("common.date" as any, locale)}</th>
                </tr>
              </thead>
              <tbody>
                {records.map(v => <VerificationRow key={v.id} v={v} locale={locale} />)}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}