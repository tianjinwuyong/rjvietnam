import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { filterExemptions, type ExemptionTab } from "./exemptionTabs";

type ExceptionRow = {
  id: number; exceptionNo: string; exceptionType: string; severity: string;
  workOrderCode?: string | null; materialCode?: string | null; materialSn?: string | null;
  status: string; ownerDomain?: string | null; detail?: Record<string, unknown> | null;
  detectedAt?: string | null; authorizationId?: number | null; authorizationNo?: string | null;
  authorizationStatus?: string | null; authorizationValidFrom?: string | null;
  authorizationValidUntil?: string | null; authorizedBy?: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(body?.error?.message ?? body?.message ?? body?.error ?? `HTTP ${response.status}`);
  return (body.data ?? body) as T;
}

export function SmtMaterialExemptions({ locale }: { locale: Locale }) {
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [tab, setTab] = useState<ExemptionTab>("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [request, setRequest] = useState({ subject: "", body: "", workOrderCode: "", lineCode: "", exceptionId: "" });
  const load = useCallback(async () => { setBusy(true); try { setRows(await api<ExceptionRow[]>("/api/plant-manager/exception-requests")); } catch (e) { setMessage(e instanceof Error ? e.message : t("mes.smtExemption.loadFailed", locale)); } finally { setBusy(false); } }, [locale]);
  useEffect(() => { void load(); }, [load]);
  const sendRequest = async () => {
    if (!request.subject.trim() || !request.body.trim()) return setMessage(t("mes.smtExemption.requestRequired", locale));
    setBusy(true); try { await api("/api/manager/channels/LINE_MANAGERS/messages", { method: "POST", body: JSON.stringify({ payload: { subject: request.subject, body: request.body, priority: "URGENT", workOrderCode: request.workOrderCode || null, lineCode: request.lineCode || null, exceptionId: request.exceptionId || null } }) }); setRequest({ subject: "", body: "", workOrderCode: "", lineCode: "", exceptionId: "" }); setMessage(t("mes.smtExemption.requestSent", locale)); } catch (e) { setMessage(e instanceof Error ? e.message : t("mes.smtExemption.requestFailed", locale)); } finally { setBusy(false); }
  };
  const authorize = async (row: ExceptionRow) => { const reason = window.prompt(t("mes.smtExemption.reasonPrompt", locale)); if (!reason?.trim()) return; setBusy(true); try { await api(`/api/plant-manager/exception-requests/${row.id}/authorize`, { method: "POST", body: JSON.stringify({ payload: { reason, workOrderCode: row.workOrderCode, materialCode: row.materialCode, materialLotNo: row.materialSn, durationHours: 1 } }) }); setMessage(t("mes.smtExemption.authorized", locale)); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : t("mes.smtExemption.authorizeFailed", locale)); } finally { setBusy(false); } };
  const revoke = async (row: ExceptionRow) => { if (!row.authorizationId || !window.confirm(t("mes.smtExemption.revokeConfirm", locale))) return; setBusy(true); try { await api(`/api/plant-manager/authorizations/${row.authorizationId}/revoke`, { method: "POST" }); setMessage(t("mes.smtExemption.revoked", locale)); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : t("mes.smtExemption.revokeFailed", locale)); } finally { setBusy(false); } };
  const tabs: Array<{ key: ExemptionTab; label: string }> = [
    { key: "all", label: t("mes.smtExemption.tabAll", locale) }, { key: "material", label: t("mes.smtExemption.tabMaterial", locale) },
    { key: "binding", label: t("mes.smtExemption.tabBinding", locale) }, { key: "quality", label: t("mes.smtExemption.tabQuality", locale) },
    { key: "system", label: t("mes.smtExemption.tabSystem", locale) }, { key: "other", label: t("mes.smtExemption.tabOther", locale) },
  ];
  const visibleRows = filterExemptions(rows, tab);
  const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : t("mes.smtExemption.none", locale);
  const itemFor = (row: ExceptionRow) => row.detail && typeof row.detail.item === "string" ? row.detail.item : row.exceptionType;
  const approvalFor = (row: ExceptionRow) => row.authorizationNo ? `${row.authorizationStatus || "ACTIVE"} · ${row.authorizationNo}` : t("mes.smtExemption.pendingApproval", locale);
  return <div style={{ display: "grid", gap: 16 }}>
    <section className="surface-panel" style={{ padding: 18 }}>
      <h2 style={{ marginTop: 0 }}>{t("mes.smtExemption.title", locale)}</h2>
      <p style={{ color: "#475569" }}>{t("mes.smtExemption.subtitle", locale)}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10, marginTop: 14 }}>
        {[["mes.smtExemption.summaryTotal", rows.length], ["mes.smtExemption.summaryPending", rows.filter(x => !x.authorizationId).length], ["mes.smtExemption.summaryApproved", rows.filter(x => !!x.authorizationId).length], ["mes.smtExemption.summaryQuality", filterExemptions(rows, "quality").length]].map(([label, value]) => <div key={String(label)} style={{ padding: 12, border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc" }}><div style={{ color: "#64748b", fontSize: 12 }}>{t(String(label), locale)}</div><strong style={{ fontSize: 22 }}>{String(value)}</strong></div>)}
      </div>
      <div style={{ marginTop: 14, background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, padding: 12, color: "#9a3412" }}>{t("mes.smtExemption.warning", locale)}</div>
      {message && <div style={{ marginTop: 10, color: "#0f766e" }}>{message}</div>}
    </section>
    <section className="surface-panel" style={{ padding: 18 }}><h3>{t("mes.smtExemption.requestTitle", locale)}</h3><div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8 }}><input placeholder={t("mes.smtExemption.subject", locale)} value={request.subject} onChange={e => setRequest({ ...request, subject: e.target.value })} /><input placeholder={t("mes.smtExemption.workOrder", locale)} value={request.workOrderCode} onChange={e => setRequest({ ...request, workOrderCode: e.target.value })} /><input placeholder={t("mes.smtExemption.line", locale)} value={request.lineCode} onChange={e => setRequest({ ...request, lineCode: e.target.value })} /><input placeholder={t("mes.smtExemption.exceptionId", locale)} value={request.exceptionId} onChange={e => setRequest({ ...request, exceptionId: e.target.value })} /></div><textarea placeholder={t("mes.smtExemption.reason", locale)} value={request.body} onChange={e => setRequest({ ...request, body: e.target.value })} style={{ marginTop: 8, width: "100%", minHeight: 80, boxSizing: "border-box" }} /><button disabled={busy} onClick={() => void sendRequest()} style={{ marginTop: 8 }}>{t("mes.smtExemption.sendRequest", locale)}</button></section>
    <section className="surface-panel" style={{ padding: 18, overflowX: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><h3>{t("mes.smtExemption.openTitle", locale)}</h3><button disabled={busy} onClick={() => void load()}>{t("buttons.refresh", locale)}</button></div>
      <div role="tablist" aria-label={t("mes.smtExemption.tabList", locale)} style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>{tabs.map(item => <button key={item.key} role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} style={{ padding: "7px 12px", borderRadius: 6, border: tab === item.key ? "2px solid #0f766e" : "1px solid #cbd5e1", background: tab === item.key ? "#ecfdf5" : "white", cursor: "pointer", fontWeight: tab === item.key ? 700 : 400 }}>{item.label} ({filterExemptions(rows, item.key).length})</button>)}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1250 }}><thead><tr>{["exceptionNo", "exemptionItem", "issueDepartment", "severity", "workOrder", "material", "duration", "approval", "signature", "additionalSignatures", "actions"].map(key => <th key={key} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #cbd5e1", whiteSpace: "nowrap" }}>{t(`mes.smtExemption.${key}`, locale)}</th>)}</tr></thead><tbody>{visibleRows.map(row => <tr key={row.id} style={{ borderBottom: "1px solid #e2e8f0", verticalAlign: "top" }}><td style={{ padding: 8 }}><strong>{row.exceptionNo}</strong><div style={{ color: "#64748b", fontSize: 12 }}>{formatDate(row.detectedAt)}</div></td><td style={{ padding: 8 }}>{itemFor(row)}<div style={{ color: "#64748b", fontSize: 12 }}>{row.status}</div></td><td style={{ padding: 8 }}>{row.ownerDomain || t("mes.smtExemption.none", locale)}</td><td style={{ padding: 8 }}>{row.severity}</td><td style={{ padding: 8 }}>{row.workOrderCode || t("mes.smtExemption.none", locale)}</td><td style={{ padding: 8 }}>{row.materialCode || row.materialSn || t("mes.smtExemption.none", locale)}</td><td style={{ padding: 8 }}>{row.authorizationNo ? <>{formatDate(row.authorizationValidFrom)}<br />→ {formatDate(row.authorizationValidUntil)}</> : t("mes.smtExemption.pendingApproval", locale)}</td><td style={{ padding: 8 }}>{approvalFor(row)}</td><td style={{ padding: 8 }}>{row.authorizedBy || t("mes.smtExemption.pendingSignature", locale)}</td><td style={{ padding: 8 }}>{t("mes.smtExemption.additionalSignaturesPolicy", locale)}</td><td style={{ padding: 8, whiteSpace: "nowrap" }}>{!row.authorizationId && <button disabled={busy} onClick={() => void authorize(row)}>{t("mes.smtExemption.authorize", locale)}</button>} {row.authorizationId && <button disabled={busy} onClick={() => void revoke(row)}>{t("mes.smtExemption.revoke", locale)}</button>}</td></tr>)}</tbody></table>{!visibleRows.length && <div style={{ padding: 24, color: "#64748b" }}>{t("mes.smtExemption.empty", locale)}</div>}
    </section>
  </div>;
}
