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
    <div style={{ padding: 24 }}>
      <h2 style={{ color: "#e2e8f0", fontSize: 20, marginBottom: 16 }}>{t("qms.custStdTitle")}</h2>
      {loading ? <div style={{ color: "#94a3b8" }}>{t("qms.loading")}</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              {[t("qms.customerCode"), t("qms.customerName"), t("qms.type"), "AQL", t("qms.samplePlan"), t("qms.specialReq"), t("qms.active")].map(h => (
                <th key={h} style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map(s => (
              <tr key={s.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: "10px 12px", color: "#38bdf8" }}>{s.customer_code}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0" }}>{s.customer_name}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{s.inspection_type}</td>
                <td style={{ padding: "10px 12px", color: "#fbbf24", fontWeight: 600 }}>{s.aql_level}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{s.sample_plan ?? "-"}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.special_requirements ?? "-"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: s.is_active ? "#34d399" : "#6b7280", fontSize: 12 }}>{s.is_active ? "✓" : "✗"}</span>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, color: "#64748b", textAlign: "center" }}>{t("qms.noData")}</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
