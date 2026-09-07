import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { apiClient } from "../api/client";
import { t } from "../i18n";

type IqcTask = {
  id: number;
  task_type?: string;
  title?: string;
  status?: string;
  requires_human?: boolean;
  lot_no?: string;
  material_code?: string;
  supplier_code?: string;
  sample_size?: number;
  payload?: Record<string, unknown>;
};

const steps = ["iqcQueue", "identityCheck", "history", "samplingPlan", "pdaTask", "humanEvidence", "evidenceGate", "decision"] as const;

function taskStep(task?: IqcTask) {
  if (!task) return 0;
  const value = `${task.task_type || ""} ${task.status || ""}`.toUpperCase();
  if (/DONE|DECISION|RESULT/.test(value)) return 7;
  if (/EVIDENCE|REVIEW|APPROVAL/.test(value)) return 6;
  if (/INSPECT|PHOTO|TEST|PDA/.test(value)) return 5;
  if (/ASSIGNED|DISPATCH/.test(value)) return 4;
  if (/SAMPLE|PLAN|RISK/.test(value)) return 3;
  if (/HISTORY|SUPPLIER/.test(value)) return 2;
  if (/IDENTITY|PO|QR|LOT/.test(value)) return 1;
  return 0;
}

export function IqcEmployeeCommunication({ locale }: { locale: Locale }) {
  const [tasks, setTasks] = useState<IqcTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const load = useCallback(async () => {
    try {
      const response: any = await apiClient.get("/qms/iqc/virtual-employee/tasks", { status: "" });
      setTasks(response.items ?? response.data?.items ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("iqcGuide.connectionFailed", locale));
    }
  }, [locale]);
  useEffect(() => { void load(); const timer = window.setInterval(load, 5000); return () => window.clearInterval(timer); }, [load]);
  const current = useMemo(() => tasks.find(task => task.requires_human) || tasks.find(task => !["DONE", "CANCELLED"].includes(String(task.status))) || tasks[0], [tasks]);
  const activeIndex = taskStep(current);
  const node = steps[activeIndex];
  useEffect(() => {
    const focus = () => { try { if (frameRef.current?.contentWindow) frameRef.current.contentWindow.location.hash = `focus=${node}`; } catch { /* same-origin frame */ } };
    focus(); const timer = window.setTimeout(focus, 250); return () => window.clearTimeout(timer);
  }, [node, expanded]);
  const run = async () => { setBusy(true); try { await apiClient.post("/qms/iqc/virtual-employee/run-now", {}); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("iqcGuide.connectionFailed", locale)); } finally { setBusy(false); } };
  const awaitingHuman = activeIndex === 5 || Boolean(current?.requires_human);
  const open = tasks.filter(task => !["DONE", "CANCELLED"].includes(String(task.status))).length;
  const done = tasks.filter(task => task.status === "DONE").length;

  return <section className="surface-panel" style={{ marginBottom: 14, border: "2px solid #0f766e", overflow: "hidden" }}>
    <div style={{ padding: "12px 16px", background: "linear-gradient(90deg,#064e3b,#0f766e)", color: "white", display: "flex", alignItems: "center", gap: 12 }}>
      <img src="/avatars/iqc-employee-2026.png" alt={t("iqcGuide.specialist", locale)} style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,.75)" }} />
      <span style={{ width: 10, height: 10, borderRadius: 10, background: error ? "#f87171" : "#4ade80", boxShadow: "0 0 0 4px rgba(255,255,255,.15)" }} />
      <div><strong>IQC-VIRTUAL-01 · {t("iqcGuide.specialist", locale)}</strong><div style={{ fontSize: 11, opacity: .82 }}>{error ? t("iqcGuide.reconnecting", locale) : t("iqcGuide.online", locale)} · {t(`iqcGuide.step.${node}`, locale)}</div></div>
      <button type="button" onClick={() => void run()} disabled={busy} title={t("iqcGuide.checkTooltip", locale)} style={{ marginLeft: "auto", background: "white", color: "#065f46", border: 0, borderRadius: 7, padding: "8px 14px", fontWeight: 700 }}>{busy ? t("iqcGuide.checking", locale) : t("iqcGuide.checkNow", locale)}</button>
    </div>
    <div style={{ padding: "12px 16px", background: awaitingHuman ? "#fff7ed" : "#ecfdf5", borderBottom: `2px solid ${awaitingHuman ? "#f97316" : "#10b981"}`, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <span style={{ padding: "5px 9px", borderRadius: 999, background: error ? "#d97706" : "#16a34a", color: "white", fontSize: 12, fontWeight: 900 }}>{error ? t("iqcGuide.reconnecting", locale) : t("iqcGuide.online", locale)}</span>
      <div style={{ minWidth: 240 }}><div style={{ fontSize: 11, fontWeight: 900, color: "#475569" }}>{t("iqcGuide.currentStatus", locale)}</div><div style={{ fontSize: 20, fontWeight: 900, color: awaitingHuman ? "#9a3412" : "#064e3b" }}>{t(`iqcGuide.step.${node}`, locale)}</div></div>
      <div style={{ flex: 1, minWidth: 260 }}>{t(`iqcGuide.guidance.${node}`, locale)}</div>
      <div style={{ fontFamily: "monospace", fontSize: 12 }}>LOT {current?.lot_no || "—"} · {current?.material_code || "—"}</div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: expanded ? "1fr" : "minmax(420px,1.45fr) minmax(340px,1fr)", gap: 12, padding: 14 }}>
      <div style={{ minWidth: 0, border: "1px solid #99f6e4", borderRadius: 10, overflow: "hidden", background: "#f8fafc" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid #ccfbf1" }}><strong style={{ color: "#115e59" }}>Archify {t("iqcGuide.liveFlow", locale)}</strong><span style={{ marginLeft: "auto", fontSize: 12 }}>{t("iqcGuide.currentNode", locale)}：{t(`iqcGuide.step.${node}`, locale)}</span><button type="button" onClick={() => setExpanded(value => !value)} title={t("iqcGuide.expandTooltip", locale)}>{expanded ? t("iqcGuide.collapse", locale) : t("iqcGuide.expand", locale)}</button><a href="/architecture/iqc-virtual-employee-workflow.html" target="_blank" rel="noreferrer">{t("iqcGuide.openSeparate", locale)}</a></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8,minmax(74px,1fr))", gap: 5, padding: "9px 10px", background: "#f0fdfa", borderBottom: "1px solid #99f6e4" }}>{steps.map((step, index) => <div key={step} style={{ padding: "10px 4px", borderRadius: 7, textAlign: "center", fontSize: 10, fontWeight: 800, color: index === activeIndex ? "white" : index < activeIndex ? "#166534" : "#64748b", background: index === activeIndex ? "#0f766e" : index < activeIndex ? "#dcfce7" : "#e2e8f0" }}>{index + 1}. {t(`iqcGuide.short.${step}`, locale)}</div>)}</div>
        <iframe ref={frameRef} title={t("iqcGuide.diagramTitle", locale)} src={`/architecture/iqc-virtual-employee-workflow.html#focus=${node}`} style={{ width: "100%", height: expanded ? 720 : 470, border: 0, display: "block", background: "#f8fafc" }} />
      </div>
      <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
        <div style={{ padding: 14, borderRadius: 9, background: "#eff6ff", border: "1px solid #93c5fd" }}><div style={{ fontSize: 11, color: "#1e40af", fontWeight: 800 }}>{t("iqcGuide.execution", locale)}</div><h3 style={{ margin: "8px 0 6px" }}>{current?.title || t(`iqcGuide.step.${node}`, locale)}</h3><p style={{ margin: 0 }}>{t(`iqcGuide.guidance.${node}`, locale)}</p><div style={{ marginTop: 12, fontSize: 12 }}>LOT：<b>{current?.lot_no || "—"}</b>　{t("iqcGuide.material", locale)}：<b>{current?.material_code || "—"}</b><br />{t("iqcGuide.supplier", locale)}：<b>{current?.supplier_code || "—"}</b>　{t("iqcGuide.sample", locale)}：<b>{current?.sample_size || String(current?.payload?.sampleSize || "—")}</b></div></div>
        <div style={{ padding: 14, borderRadius: 9, background: "#fff7ed", border: "2px solid #f97316" }}><div style={{ color: "#9a3412", fontWeight: 900 }}>🔴 {t("iqcGuide.waitingInput", locale)}</div><div style={{ marginTop: 10 }}><b>{t("iqcGuide.provider", locale)}：</b>{awaitingHuman ? t("iqcGuide.inspector", locale) : t("iqcGuide.system", locale)}</div><div style={{ marginTop: 6 }}><b>{t("iqcGuide.required", locale)}：</b>{t(`iqcGuide.required.${node}`, locale)}</div><div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: "white", color: "#166534" }}><b>{t("iqcGuide.trigger", locale)}：</b>{t(`iqcGuide.trigger.${node}`, locale)}</div><div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: "#ecfdf5", color: "#064e3b" }}><b>{t("iqcGuide.after", locale)}：</b>{t(`iqcGuide.after.${node}`, locale)}</div></div>
        <div style={{ padding: 14, borderRadius: 9, background: "#f8fafc", border: "1px solid #cbd5e1" }}><div style={{ fontSize: 11, fontWeight: 800 }}>{t("iqcGuide.queue", locale)}</div><div style={{ display: "flex", gap: 16, marginTop: 10 }}><b>{t("iqcGuide.open", locale)} {open}</b><b style={{ color: "#c2410c" }}>{t("iqcGuide.human", locale)} {tasks.filter(task => task.requires_human).length}</b><b style={{ color: "#15803d" }}>{t("iqcGuide.done", locale)} {done}</b></div></div>
      </div>
    </div>
    {error && <div style={{ padding: "0 14px 12px", color: "#b91c1c" }}>{t("iqcGuide.communicationError", locale)}：{error}</div>}
  </section>;
}
