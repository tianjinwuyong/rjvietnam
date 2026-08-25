import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";

interface NgReview {
  id: number;
  ng_event_id: number | null;
  work_order_code: string | null;
  line_code: string | null;
  station_code: string | null;
  ng_reason_code: string | null;
  ng_reason_text: string | null;
  ng_qty: number;
  review_status: "pending" | "reviewed" | "closed";
  root_cause: string | null;
  improvement_action: string | null;
  reviewed_at: string | null;
  closed_at: string | null;
  created_at: string;
  line_name?: string;
  ng_sn?: string;
}

interface NgSummary {
  byStatus: { review_status: string; count: number; total_ng_qty: number }[];
  byStation: { station_code: string; ng_count: number; total_qty: number }[];
  byReason: { ng_reason_text: string; count: number }[];
}

export function PmcNgReview({ locale }: { locale: Locale }) {
  const [reviews, setReviews] = useState<NgReview[]>([]);
  const [summary, setSummary] = useState<NgSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [selected, setSelected] = useState<NgReview | null>(null);
  const [rootCause, setRootCause] = useState("");
  const [improvement, setImprovement] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"reviewed" | "closed">("reviewed");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  const handleAutoImport = async () => {
    setImporting(true);
    try {
      const res: any = await pmcApi.ngAutoImport();
      const count = res.data?.imported ?? res.imported ?? 0;
      setMsg({ ok: true, text: `${t("pmc.ng.autoImport", locale)}${count}${t("pmc.ng.ngRecords", locale)}` });
      fetchReviews();
      fetchSummary();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? t("pmc.ng.importFailed", locale) });
    } finally {
      setImporting(false);
    }
  };

  const fetchReviews = () => {
    setLoading(true);
    pmcApi.getNgReviews(statusFilter !== "all" ? statusFilter : undefined).then((r: any) => {
      setReviews(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  const fetchSummary = () => {
    pmcApi.getNgSummary().then((r: any) => {
      setSummary(r.data);
    }).catch(() => {});
  };

  useEffect(() => { fetchReviews(); fetchSummary(); }, [statusFilter]);

  const openReview = (r: NgReview) => {
    setSelected(r);
    setRootCause(r.root_cause ?? "");
    setImprovement(r.improvement_action ?? "");
    setReviewStatus(r.review_status === "closed" ? "closed" : "reviewed");
    setMsg(null);
  };

  const submitReview = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await pmcApi.patchNgReview(selected.id, { rootCause, improvementAction: improvement, reviewStatus });
      setMsg({ ok: true, text: t("pmc.submitReview", locale) + " OK" });
      setSelected(null);
      fetchReviews();
      fetchSummary();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = (s: string) =>
    s === "closed" ? "#22c55e" : s === "reviewed" ? "#f59e0b" : "#ef4444";

  const totalNG = summary?.byStatus.find((s) => s.review_status === "pending")?.total_ng_qty ?? 0;
  const reviewedNG = summary?.byStatus.find((s) => s.review_status === "reviewed")?.total_ng_qty ?? 0;
  const closedNG = summary?.byStatus.find((s) => s.review_status === "closed")?.total_ng_qty ?? 0;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{t("pmc.ngReview", locale)}</h2>
        <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>{t("pmc.ngReviewDesc", locale)}</p>
      </div>

      {/* KPI summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("pmc.pendingReview", locale)}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#ef4444" }}>{totalNG}</div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("pmc.reviewed", locale)}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#f59e0b" }}>{reviewedNG}</div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("pmc.closedLoop", locale)}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#22c55e" }}>{closedNG}</div>
        </div>
        {summary?.byStation.slice(0, 1).map((s) => (
          <div key={s.station_code} className="surface-panel" style={{ padding: "12px 16px" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Top NG Station</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{s.station_code}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{s.total_qty} NG</div>
          </div>
        ))}
      </div>

      {/* Status filter tabs + auto-import */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        {["pending", "reviewed", "closed", "all"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid", cursor: "pointer",
              background: statusFilter === s ? "var(--primary)" : "transparent",
              color: statusFilter === s ? "#fff" : "var(--text)",
              borderColor: statusFilter === s ? "var(--primary)" : "var(--border)" }}>
            {s === "all" ? t("pmc.all", locale) : s === "pending" ? t("pmc.pendingReview", locale) : s === "reviewed" ? t("pmc.reviewed", locale) : t("pmc.closedLoop", locale)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={handleAutoImport} disabled={importing}
          style={{ padding: "6px 16px", borderRadius: 6, border: "1px solid #f59e0b", cursor: "pointer",
            background: importing ? "#fef3c7" : "#fffbeb", color: "#92400e", fontSize: 12 }}>
          {importing ? t("pmc.ng.importing", locale) : "⚡ " + t("pmc.ng.autoImportBtn", locale)}
        </button>
      </div>

      {/* Review list */}
      <div className="surface-panel">
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Loading...</div>
        ) : reviews.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>No records</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["ID", t("pmc.workOrderCode", locale), t("mes.line", locale), t("mes.station", locale), t("pmc.ngReason", locale), t("pmc.ngRate", locale), t("pmc.ngReviewStatus", locale), t("pmc.rootCause", locale), ""].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 10px" }}>#{r.id}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{r.work_order_code ?? "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{r.line_name ?? r.line_code ?? "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{r.station_code ?? "—"}</td>
                  <td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ng_reason_text ?? r.ng_reason_code ?? "—"}</td>
                  <td style={{ padding: "8px 10px" }}>{r.ng_qty}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, color: "#fff", background: statusColor(r.review_status) }}>
                      {r.review_status}
                    </span>
                  </td>
                  <td style={{ padding: "8px 10px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.root_cause ?? "—"}</td>
                  <td style={{ padding: "8px 10px" }}>
                    {r.review_status !== "closed" && (
                      <button onClick={() => openReview(r)} style={{ padding: "4px 12px", borderRadius: 4, border: "none", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 12 }}>
                        {t("pmc.ngReview", locale)}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Review modal */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div className="surface-panel" style={{ padding: 24, width: "100%", maxWidth: 500 }}>
            <h3 style={{ margin: "0 0 16px" }}>{t("pmc.ngReview", locale)} — #{selected.id}</h3>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("pmc.ngReason", locale)}</div>
              <div>{selected.ng_reason_text ?? selected.ng_reason_code ?? "—"}</div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("pmc.rootCause", locale)} *</div>
              <textarea value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={3}
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                placeholder={t("pmc.ng.rootCausePlaceholder", locale)} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("pmc.improvement", locale)} *</div>
              <textarea value={improvement} onChange={(e) => setImprovement(e.target.value)} rows={3}
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                placeholder={t("pmc.ng.improvementPlaceholder", locale)} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("pmc.ngReviewStatus", locale)}</div>
              <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as any)}
                style={{ padding: 8, borderRadius: 6, border: "1px solid var(--border)", fontSize: 13 }}>
                <option value="reviewed" key="reviewed-opt">{t("pmc.reviewed", locale)}</option>
                <option value="closed" key="closed-opt">{t("pmc.closedLoop", locale)}</option>
              </select>
            </div>
            {msg && <div style={{ padding: "8px 12px", borderRadius: 6, marginBottom: 12, background: msg.ok ? "#22c55e22" : "#ef444422", color: msg.ok ? "#22c55e" : "#ef4444", fontSize: 13 }}>{msg.text}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={submitReview} disabled={submitting || !rootCause || !improvement}
                style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: submitting || !rootCause ? "#ccc" : "var(--primary)", color: "#fff", cursor: submitting ? "not-allowed" : "pointer", fontSize: 13 }}>
                {submitting ? "..." : t("pmc.submitReview", locale)}
              </button>
              <button onClick={() => setSelected(null)}
                style={{ padding: "8px 20px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 13 }}>
                {t("common.cancel", locale)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
