// DOM side panel shown when a worker avatar is clicked. All strings via local labels.ts.
import type { CSSProperties } from "react";
import type { Locale, VirtualEmployee } from "./types";
import { domainLabel, levelLabel, modeLabel, statusLabel, t } from "./labels";
import { domainColor } from "./layout";

const panelStyle: CSSProperties = {
  position: "absolute", top: 64, right: 12, bottom: 64, width: 300, zIndex: 20,
  background: "rgba(10, 14, 26, 0.94)", border: "1px solid #334155", borderRadius: 12,
  padding: 14, overflowY: "auto", color: "#e2e8f0", fontSize: 12.5,
  boxShadow: "0 12px 32px rgba(0,0,0,0.5)", backdropFilter: "blur(6px)",
};
const labelStyle: CSSProperties = { color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 10, marginBottom: 3 };
const chipStyle: CSSProperties = { display: "inline-block", padding: "2px 7px", margin: "0 4px 4px 0", borderRadius: 6, background: "#1e293b", border: "1px solid #334155", fontSize: 10.5, fontFamily: "ui-monospace, monospace" };
const gateChipStyle: CSSProperties = { ...chipStyle, background: "#451a03", borderColor: "#92400e", color: "#fcd34d" };

export function EmployeePanel({ employee, locale, onClose }: {
  employee: VirtualEmployee;
  locale: Locale;
  onClose: () => void;
}) {
  const color = domainColor(employee.domain);
  const counts = employee.taskCounts ?? {};
  const isActive = employee.mode === "ACTIVE_EXECUTOR";
  return (
    <aside style={panelStyle} data-testid="vf.panel" aria-label={t("panel.title", locale)}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: color, marginTop: 3, flexShrink: 0 }} aria-hidden="true" />
        <strong style={{ fontSize: 14, lineHeight: 1.3 }}>{employee.display_name || employee.name}</strong>
        <button
          type="button"
          onClick={onClose}
          title={t("panel.close", locale)}
          aria-label={t("panel.close", locale)}
          data-testid="vf.panel.close"
          style={{ marginLeft: "auto", background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 12 }}
        >
          ✕
        </button>
      </div>
      <code style={{ color: "#7dd3fc", fontSize: 11 }}>{employee.id}</code>

      <div style={labelStyle}>{t("panel.domain", locale)}</div>
      <div><span style={{ color, fontWeight: 700 }}>{domainLabel(employee.domain, locale)}</span></div>

      <div style={labelStyle}>{t("panel.level", locale)}</div>
      <div>{levelLabel(employee.level, locale)}</div>

      <div style={labelStyle}>{t("panel.mode", locale)}</div>
      <div>
        <span style={{
          display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
          background: isActive ? "#052e16" : "#042f2e",
          border: `1px solid ${isActive ? "#22c55e" : "#14b8a6"}`,
          color: isActive ? "#4ade80" : "#2dd4bf",
        }}>
          {modeLabel(employee.mode, locale)}
        </span>
      </div>

      <div style={labelStyle}>{t("panel.status", locale)}</div>
      <div data-testid="vf.panel.status">{statusLabel(employee.status, locale)}</div>

      <div style={labelStyle}>{t("panel.taskCounts", locale)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {(["OPEN", "WAITING_APPROVAL", "DONE"] as const).map(key => (
          <div key={key} style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: "6px 4px", textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: key === "WAITING_APPROVAL" && Number(counts[key] ?? 0) > 0 ? "#f59e0b" : "#e2e8f0" }}>
              {Number(counts[key] ?? 0)}
            </div>
            <div style={{ fontSize: 9.5, color: "#94a3b8" }}>{t(`task.${key}`, locale)}</div>
          </div>
        ))}
      </div>

      <div style={labelStyle}>{t("panel.jobDescription", locale)}</div>
      <p style={{ margin: 0, lineHeight: 1.55, color: "#cbd5e1" }}>
        {employee.jobDescription || t("panel.none", locale)}
      </p>

      <div style={labelStyle}>{t("panel.capabilities", locale)}</div>
      <div>
        {(employee.capabilities ?? []).length === 0 && <span style={{ color: "#64748b" }}>{t("panel.none", locale)}</span>}
        {(employee.capabilities ?? []).map(cap => <span key={cap} style={chipStyle}>{cap}</span>)}
      </div>

      <div style={labelStyle}>{t("panel.humanGates", locale)}</div>
      <div>
        {(employee.humanGates ?? []).length === 0 && <span style={{ color: "#64748b" }}>{t("panel.none", locale)}</span>}
        {(employee.humanGates ?? []).map(gate => <span key={gate} style={gateChipStyle}>{gate}</span>)}
      </div>
    </aside>
  );
}
