import { useEffect, useState } from "react";
import { Repeat, ArrowRight } from "lucide-react";
import { t } from "../i18n";
import { apiClient } from "../api/client";
import type { Locale } from "../../../../packages/shared-types/src/factory";

/** /wms/material-substitutions 一行（源 WMS /material/substitution） */
interface SubRow {
  id: number;
  materialCode: string;
  substituteMaterialCode: string;
  substitutionType?: string | null;
  status?: string | null;
  remark?: string | null;
  materialName?: string | null;
  substituteMaterialName?: string | null;
  substituteSpec?: string | null;
  substituteUnit?: string | null;
}

export function WmsMaterialSubstitution({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiClient.get<{ items: SubRow[] }>("/wms/material-substitutions", { q })
      .then((r) => { if (alive) { setRows(r.items || []); setError(""); } })
      .catch((err) => { if (alive) setError(String(err?.message || err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [q]);

  return (
    <div className="screen-stack">
      <section className="surface-panel">
        <div className="section-header">
          <div>
            <h2><Repeat size={18} style={{ marginRight: 8, verticalAlign: "middle" }} />物料替代关系</h2>
            <p>原 WMS 的替代料一览：主料 → 可替代料，领料/上料时按这里放行替代。</p>
          </div>
          <div className="toolbar" style={{ gap: 8, alignItems: "center" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("common.search", locale)}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
            />
            {loading ? <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("common.loading", locale)}</span> : null}
          </div>
        </div>
        {error ? <p style={{ color: "var(--danger)", fontSize: 12 }}>{error}</p> : null}
        <div className="table-shell" style={{ maxHeight: 560, overflow: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>主料</th>
                <th />
                <th>替代料</th>
                <th>替代类型</th>
                <th>状态</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.materialCode}</strong>
                    {r.materialName ? <div style={{ fontSize: 10, color: "var(--muted)" }}>{r.materialName}</div> : null}
                  </td>
                  <td><ArrowRight size={14} style={{ color: "var(--muted)" }} /></td>
                  <td>
                    <strong>{r.substituteMaterialCode}</strong>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>
                      {[r.substituteMaterialName, r.substituteSpec, r.substituteUnit].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>{r.substitutionType || "-"}</td>
                  <td><span className="badge badge-ok">{r.status || "ACTIVE"}</span></td>
                  <td style={{ fontSize: 12 }}>{r.remark || ""}</td>
                </tr>
              ))}
              {!rows.length && !loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>
                    暂无替代关系（原系统的替代表还没有同步过来，或确实没有维护）
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
