import { AlertTriangle } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import type { PoAdjustmentRequest, PurchaseOrderHeader } from "../api/procurement";

export function PoManagementEmployeeCommunication({ locale, items, adjustments }: { locale: Locale; items: PurchaseOrderHeader[]; adjustments: PoAdjustmentRequest[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const active = items.filter(po => !["closed", "cancelled"].includes(po.status));
  const overdue = active.filter(po => po.promisedDate && po.promisedDate < today && po.status !== "received").length;
  const unacknowledged = active.filter(po => ["draft", "sent"].includes(po.status)).length;
  const pending = adjustments.filter(item => item.status === "PENDING").length;
  const risk = overdue + pending;
  const level = risk ? "danger" : unacknowledged ? "warning" : "normal";
  const node = pending ? "approval" : overdue ? "alert" : unacknowledged ? "acknowledge" : active.length ? "receive" : "validate";
  const color = level === "danger" ? "#dc2626" : level === "warning" ? "#f59e0b" : "#10b981";

  return <section className="surface-panel" style={{ marginBottom: 14, border: "2px solid #0f766e", overflow: "hidden" }}>
    <div style={{ padding: "12px 16px", background: "linear-gradient(90deg,#064e3b,#0f766e)", color: "white", display: "flex", alignItems: "center", gap: 12 }}>
      <img src="/avatars/purchasing-employee-2026.png" alt={t("poGuide.specialist", locale)} style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,.75)" }} />
      <span title={t(`poGuide.alert.${level}`, locale)} style={{ width: 10, height: 10, borderRadius: 10, background: color, boxShadow: "0 0 0 4px rgba(255,255,255,.15)" }} />
      <div><strong>PURCHASING-VIRTUAL-01 · {t("poGuide.specialist", locale)}</strong><div style={{ fontSize: 11, opacity: .82 }}>{t("poGuide.monitoring", locale)} · {t(`poGuide.step.${node}`, locale)}</div></div>
      <a href="/architecture/po-management-virtual-employee-workflow.html" target="_blank" rel="noreferrer" title={t("poGuide.openTooltip", locale)} style={{ marginLeft: "auto", background: "white", color: "#065f46", borderRadius: 7, padding: "8px 14px", fontWeight: 700 }}>{t("poGuide.openFlow", locale)}</a>
    </div>
    <div role={level === "normal" ? "status" : "alert"} style={{ padding: "12px 16px", background: level === "danger" ? "#fef2f2" : level === "warning" ? "#fff7ed" : "#ecfdf5", borderBottom: `2px solid ${color}`, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      {level !== "normal" && <AlertTriangle size={22} color={color} />}
      <div style={{ flex: 1 }}><b>{t(`poGuide.alert.${level}`, locale)}</b><div>{t(`poGuide.guidance.${node}`, locale)}</div></div>
      <b>{t("poGuide.open", locale)} {active.length} · {t("poGuide.unacknowledged", locale)} {unacknowledged} · {t("poGuide.overdue", locale)} {overdue} · {t("poGuide.pendingApproval", locale)} {pending}</b>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 12, padding: 14 }}>
      <div style={{ border: "1px solid #99f6e4", borderRadius: 10, overflow: "hidden" }}><div style={{ padding: "9px 12px", background: "#f0fdfa" }}><strong style={{ color: "#115e59" }}>Archify {t("poGuide.liveFlow", locale)}</strong></div><iframe title={t("poGuide.diagramTitle", locale)} src={`/architecture/po-management-virtual-employee-workflow.html#focus=${node}`} style={{ width: "100%", height: 470, border: 0, display: "block" }} /></div>
      <div style={{ display: "grid", gap: 10, alignContent: "start" }}><div style={{ padding: 14, borderRadius: 9, background: "#eff6ff", border: "1px solid #93c5fd" }}><small style={{ color: "#1e40af", fontWeight: 800 }}>{t("poGuide.execution", locale)}</small><h3>{t(`poGuide.step.${node}`, locale)}</h3><p>{t(`poGuide.guidance.${node}`, locale)}</p></div><div style={{ padding: 14, borderRadius: 9, background: "#fff7ed", border: "2px solid #f97316" }}><strong style={{ color: "#9a3412" }}>● {t("poGuide.waitingInput", locale)}</strong><p>{t(`poGuide.required.${node}`, locale)}</p></div></div>
    </div>
  </section>;
}
