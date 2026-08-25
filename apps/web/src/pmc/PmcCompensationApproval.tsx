import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { pmcApi } from "../api";

interface NgCompensationReason {
  code: string;
  nameZh: string;
  nameEn: string;
  nameVi: string;
  costBearer: "SUPPLIER" | "INTERNAL";
  sortOrder: number;
}

interface NgCompensation {
  id: string;
  requestNo: string;
  workOrderCode: string;
  lineCode: string | null;
  stationCode: string | null;
  materialCode: string;
  materialNameZh: string | null;
  lotNo: string | null;
  compensationQty: number;
  unitCostUsd: string;
  estimatedCostUsd: string;
  reasonCode: string;
  reasonNote: string | null;
  ngDescription: string | null;
  status: string;
  filedByName: string | null;
  filedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  issuedQty: number | null;
  issuedAt: string | null;
  isSupplierBorne: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#f59e0b",
  APPROVED: "#22c55e",
  DISPUTED: "#ef4444",
  ISSUED: "#3b82f6",
  CLOSED: "#6b7280",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  DISPUTED: "DISPUTED",
  ISSUED: "ISSUED",
  CLOSED: "CLOSED",
};

export function PmcCompensationApproval({ locale }: { locale: Locale }) {
  const [items, setItems] = useState<NgCompensation[]>([]);
  const [reasons, setReasons] = useState<NgCompensationReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [selected, setSelected] = useState<NgCompensation | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [action, setAction] = useState<"APPROVED" | "DISPUTED">("APPROVED");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchReasons = () => {
    pmcApi.getNgCompensationReasons().then((r: any) => {
      setReasons(r.items ?? []);
    }).catch(() => {});
  };

  const fetchItems = () => {
    setLoading(true);
    const params: any = {};
    if (statusFilter) params.status = statusFilter;
    pmcApi.getNgCompensations(params).then((r: any) => {
      setItems(r.items ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchReasons(); }, []);
  useEffect(() => { fetchItems(); }, [statusFilter]);

  const openReview = (item: NgCompensation) => {
    setSelected(item);
    setReviewNote("");
    setAction("APPROVED");
    setMsg(null);
  };

  const submitReview = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const currentUser = (window as any).__currentUser;
      const userName = currentUser?.username ?? "PMC_CN_01";
      const displayName = currentUser?.display_name ?? "PMC User";
      await pmcApi.patchNgCompensation(parseInt(selected.id), {
        status: action,
        reviewNote,
        reviewedBy: userName,
        reviewedByName: displayName,
      });
      setMsg({ ok: true, text: action === "APPROVED" ? t("pmc.compensation.approved", locale) : t("pmc.compensation.disputeSubmitted", locale) });
      setSelected(null);
      fetchItems();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? t("pmc.compensation.operationFailed", locale) });
    } finally {
      setSubmitting(false);
    }
  };

  const reasonLabel = (code: string) => {
    const r = reasons.find((x) => x.code === code);
    if (!r) return code;
    const lang = locale.slice(0, 2) as "zh" | "en" | "vi";
    return r[`name${lang.charAt(0).toUpperCase() + lang.slice(1)}` as keyof NgCompensationReason] as string ?? code;
  };

  const pendingCount = items.filter((i) => i.status === "PENDING").length;
  const approvedCount = items.filter((i) => i.status === "APPROVED").length;
  const disputedCount = items.filter((i) => i.status === "DISPUTED").length;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{t("pmc.compensation.title", locale)}</h2>
        <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>{t("pmc.compensation.subtitle", locale)}</p>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 20 }}>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("pmc.compensation.pending", locale)}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#f59e0b" }}>{pendingCount}</div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("pmc.compensation.approved", locale)}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#22c55e" }}>{approvedCount}</div>
        </div>
        <div className="surface-panel" style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>{t("pmc.compensation.disputed", locale)}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#ef4444" }}>{disputedCount}</div>
        </div>
      </div>

      {/* Status filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {["PENDING", "APPROVED", "DISPUTED", "ISSUED", "CLOSED", "all"].map((s) => (
          <button key={s} onClick={() => setStatusFilter(s === "all" ? "" : s)}
            style={{
              padding: "6px 16px", borderRadius: 6, border: "1px solid",
              cursor: "pointer", fontSize: 12, fontWeight: 600,
              background: statusFilter === (s === "all" ? "" : s) ? STATUS_COLORS[s] ?? "var(--primary)" : "transparent",
              color: statusFilter === (s === "all" ? "" : s) ? "#fff" : "var(--text)",
              borderColor: statusFilter === (s === "all" ? "" : s) ? STATUS_COLORS[s] ?? "var(--primary)" : "var(--border)",
            }}>
            {s === "all" ? t("pmc.compensation.all", locale) : t(`pmc.compensation.${s.toLowerCase()}`, locale)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="surface-panel">
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>{t("pmc.compensation.loading", locale)}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>{t("pmc.compensation.noData", locale)}</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {[t("pmc.compensation.id", locale), t("pmc.compensation.requestNo", locale), t("pmc.compensation.workOrder", locale), t("pmc.compensation.material", locale), t("pmc.compensation.qty", locale), t("pmc.compensation.reason", locale), t("pmc.compensation.supplierBorne", locale), t("pmc.compensation.applicant", locale), t("pmc.compensation.status", locale), t("pmc.compensation.applyTime", locale), t("pmc.compensation.action", locale)].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 10px" }}>#{item.id}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{item.requestNo}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12 }}>{item.workOrderCode}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <div style={{ fontFamily: "monospace", fontSize: 12 }}>{item.materialCode}</div>
                      {item.materialNameZh && <div style={{ fontSize: 11, color: "var(--muted)" }}>{item.materialNameZh}</div>}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>
                      {item.compensationQty}
                    </td>
                    <td style={{ padding: "8px 10px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {reasonLabel(item.reasonCode)}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      {item.isSupplierBorne ? (
                        <span style={{ color: "#ef4444", fontSize: 11, fontWeight: 700 }}>{t("pmc.compensation.supplier", locale)}</span>
                      ) : (
                        <span style={{ color: "#6b7280", fontSize: 11 }}>{t("pmc.compensation.factory", locale)}</span>
                      )}
                    </td>
                    <td style={{ padding: "8px 10px" }}>{item.filedByName ?? "—"}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, color: "#fff",
                        background: STATUS_COLORS[item.status] ?? "#6b7280",
                      }}>
                        {STATUS_LABELS[item.status] ?? item.status}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", fontSize: 11, color: "var(--muted)" }}>
                      {item.filedAt ? new Date(item.filedAt).toLocaleDateString() : "—"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      {item.status === "PENDING" && (
                        <button onClick={() => openReview(item)}
                          style={{ padding: "4px 12px", borderRadius: 4, border: "none", background: "var(--primary)", color: "#fff", cursor: "pointer", fontSize: 12 }}>
                          {t("pmc.compensation.review", locale)}
                        </button>
                      )}
                      {(item.status === "APPROVED" || item.status === "DISPUTED") && (
                        <button onClick={() => openReview(item)}
                          style={{ padding: "4px 12px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 12 }}>
                          {t("pmc.compensation.view", locale)}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review modal */}
      {selected && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }}
          onClick={() => setSelected(null)}
        >
          <div className="surface-panel" style={{ padding: 24, width: "100%", maxWidth: 520, maxHeight: "80vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px" }}>{t("pmc.compensation.title", locale)} — {selected.requestNo}</h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 13, marginBottom: 16 }}>
              {([
                [t("pmc.compensation.workOrderLabel", locale), selected.workOrderCode],
                [t("pmc.compensation.materialLabel", locale), `${selected.materialCode}${selected.materialNameZh ? ` (${selected.materialNameZh})` : ""}`],
                [t("pmc.compensation.lot", locale), selected.lotNo ?? "—"],
                [t("pmc.compensation.compensationQty", locale), `${selected.compensationQty} 件`],
                [t("pmc.compensation.unitCost", locale), `$${parseFloat(selected.unitCostUsd).toFixed(4)}`],
                [t("pmc.compensation.estimatedCost", locale), `$${parseFloat(selected.estimatedCostUsd).toFixed(2)}`],
                [t("pmc.compensation.reason", locale), reasonLabel(selected.reasonCode)],
                [t("pmc.compensation.costBearer", locale), selected.isSupplierBorne ? t("pmc.compensation.supplier", locale) : t("pmc.compensation.factory", locale)],
                [t("pmc.compensation.ngDescription", locale), selected.ngDescription ?? "—"],
                [t("pmc.compensation.applicant", locale), selected.filedByName ?? "—"],
                [t("pmc.compensation.applyTime", locale), selected.filedAt ? new Date(selected.filedAt).toLocaleString() : "—"],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>{label}</div>
                  <div>{value}</div>
                </div>
              ))}
            </div>

            {selected.status === "PENDING" ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("pmc.compensation.approvalActionRequired", locale)}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => setAction("APPROVED")}
                      style={{
                        flex: 1, padding: "10px", borderRadius: 6, border: "2px solid",
                        borderColor: action === "APPROVED" ? "#22c55e" : "var(--border)",
                        background: action === "APPROVED" ? "#22c55e22" : "transparent",
                        color: action === "APPROVED" ? "#22c55e" : "var(--text)",
                        cursor: "pointer", fontWeight: 700, fontSize: 14,
                      }}
                    >
                      ✓ {t("pmc.compensation.approve", locale)}
                    </button>
                    <button
                      onClick={() => setAction("DISPUTED")}
                      style={{
                        flex: 1, padding: "10px", borderRadius: 6, border: "2px solid",
                        borderColor: action === "DISPUTED" ? "#ef4444" : "var(--border)",
                        background: action === "DISPUTED" ? "#ef444422" : "transparent",
                        color: action === "DISPUTED" ? "#ef4444" : "var(--text)",
                        cursor: "pointer", fontWeight: 700, fontSize: 14,
                      }}
                    >
                      ✗ {t("pmc.compensation.dispute", locale)}
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    {t("pmc.compensation.reviewNotes", locale)} {action === "DISPUTED" ? "*" : ""}
                  </div>
                  <textarea
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    rows={3}
                    required={action === "DISPUTED"}
                    placeholder={action === "DISPUTED" ? t("pmc.compensation.disputeReasonRequired", locale) : t("pmc.compensation.optionalNote", locale)}
                    style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                  />
                </div>

                {msg && (
                  <div style={{
                    padding: "8px 12px", borderRadius: 6, marginBottom: 12,
                    background: msg.ok ? "#22c55e22" : "#ef444422",
                    color: msg.ok ? "#22c55e" : "#ef4444", fontSize: 13,
                  }}>
                    {msg.text}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={submitReview}
                    disabled={submitting || (action === "DISPUTED" && !reviewNote.trim())}
                    style={{
                      padding: "10px 20px", borderRadius: 6, border: "none",
                      background: submitting || (action === "DISPUTED" && !reviewNote.trim()) ? "#ccc" : action === "APPROVED" ? "#22c55e" : "#ef4444",
                      color: "#fff", cursor: submitting ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14,
                    }}
                  >
                    {submitting ? t("pmc.compensation.processing", locale) : action === "APPROVED" ? t("pmc.compensation.confirmApprove", locale) : t("pmc.compensation.submitDispute", locale)}
                  </button>
                  <button onClick={() => setSelected(null)}
                    style={{ padding: "10px 20px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 14 }}>
                    {t("pmc.compensation.cancel", locale)}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 6, background: "#f3f4f6" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>{t("pmc.compensation.reviewResult", locale)}</div>
                  <div style={{ fontWeight: 700, color: STATUS_COLORS[selected.status] }}>
                    {t(`pmc.compensation.${selected.status.toLowerCase()}`, locale)}
                  </div>
                  {selected.reviewNote && (
                    <div style={{ marginTop: 4, fontSize: 13 }}>{t("pmc.compensation.notes", locale)}: {selected.reviewNote}</div>
                  )}
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    {selected.reviewedByName} {t("pmc.compensation.at", locale)} {selected.reviewedAt ? new Date(selected.reviewedAt).toLocaleString() : "—"}
                  </div>
                </div>
                <button onClick={() => setSelected(null)}
                  style={{ padding: "10px 20px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 14 }}>
                    {t("pmc.compensation.close", locale)}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
