// Legacy QMS widgets consume multiple backend envelope versions.
// @ts-nocheck
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { qmsApi, QmsCustomerStandard } from "../api/qms";

export function QmsCustomerStandards({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [list, setList] = useState<QmsCustomerStandard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    qmsApi.listCustomerStandards()
      .then((r: QmsCustomerStandard[] | { data?: QmsCustomerStandard[] }) => setList(Array.isArray(r) ? r : r.data ?? []))
      .catch(e => console.error("Customer standards:", e))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="surface-panel" style={{ padding: 16 }} role="region" aria-label={t("qms.customerStandardsTitle")} data-testid="qms.customer-standards">
      <h2 style={{ color: 'var(--text)', fontSize: 20, marginBottom: 16 }}>{t("qms.custStdTitle")}</h2>
      {loading ? <div style={{ color: 'var(--muted)' }}>{t("qms.loading")}</div> : (
        <table className="data-table">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              {[t("qms.customerCode"), t("qms.customerName"), t("qms.type"), "AQL", t("qms.samplePlan"), t("qms.specialReq"), t("qms.active")].map(h => (
                <th key={h} style={{ padding: "10px 12px", color: 'var(--muted)', fontSize: 12, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map(s => (
              <tr key={s.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "10px 12px", color: "var(--info)" }}>{s.customer_code}</td>
                <td style={{ padding: "10px 12px", color: 'var(--text)' }}>{s.customer_name}</td>
                <td style={{ padding: "10px 12px", color: 'var(--muted)' }}>{s.inspection_type}</td>
                <td style={{ padding: "10px 12px", color: "var(--warn)", fontWeight: 600 }}>{s.aql_level}</td>
                <td style={{ padding: "10px 12px", color: 'var(--muted)' }}>{s.sample_plan ?? "-"}</td>
                <td style={{ padding: "10px 12px", color: 'var(--muted)', maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.special_requirements ?? "-"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: s.is_active ? "var(--ok)" : "var(--muted)", fontSize: 12 }}>{s.is_active ? "✓" : "✗"}</span>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, color: 'var(--muted)', textAlign: "center" }}>{t("qms.noData")}</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
