import { AlertTriangle } from "lucide-react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";

type MsdStats = { total: number; expired: number; warning: number; urgent: number; baking: number };

export function MsdEmployeeCommunication({ locale, stats }: { locale: Locale; stats: MsdStats }) {
  const risk = stats.expired + stats.urgent + stats.baking;
  const node = stats.baking ? "bake" : stats.expired || stats.urgent ? "lock" : stats.warning ? "productionCheck" : stats.total ? "lifeClock" : "receive";
  const alertLevel = stats.expired || stats.urgent ? "danger" : stats.baking || stats.warning ? "warning" : "normal";
  const alertColor = alertLevel === "danger" ? "#dc2626" : alertLevel === "warning" ? "#f59e0b" : "#10b981";

  return (
    <section className="surface-panel" style={{ marginBottom: 14, border: "2px solid #0f766e", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", background: "linear-gradient(90deg,#064e3b,#0f766e)", color: "white", display: "flex", alignItems: "center", gap: 12 }}>
        <img src="/avatars/msd-control-employee-2026.png" alt={t("msdGuide.specialist", locale)} style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,.75)" }} />
        <span title={t(`msdGuide.alert.${alertLevel}`, locale)} style={{ width: 10, height: 10, borderRadius: 10, background: alertColor, boxShadow: "0 0 0 4px rgba(255,255,255,.15)" }} />
        <div><strong>MSD-CONTROL-VIRTUAL-01 · {t("msdGuide.specialist", locale)}</strong><div style={{ fontSize: 11, opacity: .82 }}>{t("msdGuide.monitoring", locale)} · {t(`msdGuide.step.${node}`, locale)}</div></div>
        <a href="/architecture/msd-control-virtual-employee-workflow.html" target="_blank" rel="noreferrer" title={t("msdGuide.openTooltip", locale)} style={{ marginLeft: "auto", background: "white", color: "#065f46", borderRadius: 7, padding: "8px 14px", fontWeight: 700 }}>{t("msdGuide.openFlow", locale)}</a>
      </div>
      <div role={alertLevel === "normal" ? "status" : "alert"} style={{ padding: "12px 16px", background: alertLevel === "danger" ? "#fef2f2" : alertLevel === "warning" ? "#fff7ed" : "#ecfdf5", borderBottom: `2px solid ${alertColor}`, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
        {alertLevel !== "normal" && <AlertTriangle size={22} color={alertColor} />}
        <div><small>{t("msdGuide.currentStatus", locale)}</small><div style={{ fontSize: 20, fontWeight: 900, color: alertLevel === "danger" ? "#991b1b" : "#064e3b" }}>{t(`msdGuide.step.${node}`, locale)}</div></div>
        <div style={{ flex: 1 }}><b>{t(`msdGuide.alert.${alertLevel}`, locale)}</b><br />{t(`msdGuide.guidance.${node}`, locale)}</div>
        <b>{t("msdGuide.opened", locale)} {stats.total} · {t("msdGuide.warning", locale)} {stats.warning} · {t("msdGuide.locked", locale)} {stats.expired} · {t("msdGuide.baking", locale)} {stats.baking}</b>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 12, padding: 14 }}>
        <div style={{ border: "1px solid #99f6e4", borderRadius: 10, overflow: "hidden", minWidth: 0 }}><div style={{ padding: "9px 12px", background: "#f0fdfa", borderBottom: "1px solid #99f6e4" }}><strong style={{ color: "#115e59" }}>Archify {t("msdGuide.liveFlow", locale)}</strong></div><iframe title={t("msdGuide.diagramTitle", locale)} src={`/architecture/msd-control-virtual-employee-workflow.html#focus=${node}`} style={{ width: "100%", height: 470, border: 0, display: "block" }} /></div>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ padding: 14, borderRadius: 9, background: "#eff6ff", border: "1px solid #93c5fd" }}><small style={{ color: "#1e40af", fontWeight: 800 }}>{t("msdGuide.execution", locale)}</small><h3>{t(`msdGuide.step.${node}`, locale)}</h3><p>{t(`msdGuide.guidance.${node}`, locale)}</p></div>
          <div style={{ padding: 14, borderRadius: 9, background: "#fff7ed", border: "2px solid #f97316" }}><strong style={{ color: "#9a3412" }}>● {t("msdGuide.waitingInput", locale)}</strong><p><b>{t("msdGuide.required", locale)}：</b>{t(`msdGuide.required.${node}`, locale)}</p><div style={{ padding: 8, background: "white", color: "#166534", borderRadius: 6 }}><b>{t("msdGuide.trigger", locale)}：</b>{t(`msdGuide.trigger.${node}`, locale)}</div><div style={{ marginTop: 8, padding: 8, background: "#ecfdf5", color: "#064e3b", borderRadius: 6 }}><b>{t("msdGuide.after", locale)}：</b>{t(`msdGuide.after.${node}`, locale)}</div></div>
        </div>
      </div>
    </section>
  );
}
