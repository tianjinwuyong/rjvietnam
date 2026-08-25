import { useEffect, useState } from "react";
import { apiClient } from "../api/client";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { useAmbassador, type BusStats } from "./useAmbassador";
import {
  computeAllHealth, AMBASSADOR_META, STATUS_COLOR, STATUS_BG,
  type AmbassadorHealth, type AmbassadorDimension,
} from "./ambassadorHealth";
import { deriveEffectivenessAlerts } from "./EffectivenessAmbassador";
import { deriveEfficiencyAlerts } from "./EfficiencyAmbassador";
import { deriveSwiftnessAlerts } from "./SwiftnessAmbassador";
import { deriveCollaborationAlerts } from "./CollaborationAmbassador";

// ── Shared alert derivation (re-exported so dashboard can count) ────
export { deriveEffectivenessAlerts, deriveEfficiencyAlerts, deriveSwiftnessAlerts, deriveCollaborationAlerts };

// ── Ambassador cells that show alert counts ─────────────────────────
interface AmbassadorCellProps {
  dimension: AmbassadorDimension;
  health: AmbassadorHealth;
  locale: Locale;
  onNavigate: (dim: AmbassadorDimension) => void;
}

function AmbassadorCell({ dimension, health, locale, onNavigate }: AmbassadorCellProps) {
  const meta = AMBASSADOR_META[dimension];
  const statusColor = STATUS_COLOR[health.status];
  const statusBg = STATUS_BG[health.status];
  const total = health.criticalCount + health.warningCount;

  return (
    <div
      onClick={() => onNavigate(dimension)}
      style={{
        padding: 20,
        borderRadius: 12,
        background: "#fff",
        border: `2px solid ${health.status === "ok" ? "#e0e0e0" : statusColor}`,
        cursor: "pointer",
        transition: "all 0.2s",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)"; (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"; (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)"; }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 28 }}>{meta.icon}</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{t(meta.labelKey, locale)}</span>
        </div>
        <div style={{
          width: 12, height: 12, borderRadius: "50%",
          background: statusColor,
          boxShadow: health.status !== "ok" ? `0 0 8px ${statusColor}` : undefined,
        }} />
      </div>

      {/* Status */}
      <div style={{ marginBottom: 10 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
          background: statusBg, color: statusColor,
        }}>
          {health.status === "ok" ? t("ambassador.status.ok", locale) :
           health.status === "warning" ? t("ambassador.status.warning", locale) :
           t("ambassador.status.critical", locale)}
        </span>
      </div>

      {/* Summary */}
      <div style={{ fontSize: 12, color: "#555", marginBottom: 12, lineHeight: 1.5 }}>
        {health.summary}
      </div>

      {/* Alert counts */}
      <div style={{ display: "flex", gap: 8 }}>
        {health.criticalCount > 0 && (
          <div style={{ flex: 1, textAlign: "center", padding: "6px 8px", borderRadius: 6, background: "#ffebee", border: "1px solid #ef9a9a" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#c62828" }}>{health.criticalCount}</div>
            <div style={{ fontSize: 10, color: "#c62828" }}>{t("ambassador.critical", locale)}</div>
          </div>
        )}
        {health.warningCount > 0 && (
          <div style={{ flex: 1, textAlign: "center", padding: "6px 8px", borderRadius: 6, background: "#fff3e0", border: "1px solid #ffcc80" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#ef6c00" }}>{health.warningCount}</div>
            <div style={{ fontSize: 10, color: "#ef6c00" }}>{t("ambassador.warning", locale)}</div>
          </div>
        )}
        {health.criticalCount === 0 && health.warningCount === 0 && (
          <div style={{ flex: 1, textAlign: "center", padding: "6px 8px", borderRadius: 6, background: "#e8f5e9", border: "1px solid #a5d6a7" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#2e7d32" }}>0</div>
            <div style={{ fontSize: 10, color: "#2e7d32" }}>{t("ambassador.noIssues", locale)}</div>
          </div>
        )}
      </div>

      {/* Click hint */}
      <div style={{ marginTop: 10, fontSize: 11, color: "#aaa", textAlign: "center" }}>
        {t("ambassador.clickToView", locale)} →
      </div>
    </div>
  );
}

// ── Main Dashboard ──────────────────────────────────────────────────
export function AmbassadorDashboard({ locale, onNavigate }: { locale: Locale; onNavigate: (dim: AmbassadorDimension) => void }) {
  const [healthList, setHealthList] = useState<AmbassadorHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const { stats } = useAmbassador(() => [], 8000);

  useEffect(() => {
    if (stats) {
      setHealthList(computeAllHealth(stats));
      setLoading(false);
    }
  }, [stats]);

  const overallCritical = healthList.filter(h => h.status === "critical").length;
  const overallWarning = healthList.filter(h => h.status === "warning").length;

  return (
    <div style={{ padding: "0 0 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 28 }}>🎖️</span>
          <span style={{ fontWeight: 700, fontSize: 18 }}>{t("ambassador.dashboard.title", locale)}</span>
          <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 12, background: loading ? "#fff3e0" : "#e8f5e9", color: loading ? "#ef6c00" : "#2e7d32", fontWeight: 600 }}>
            {loading ? "○ LOADING" : "● ONLINE"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {overallCritical > 0 && (
            <div style={{ padding: "4px 12px", borderRadius: 8, background: "#c62828", color: "#fff", fontWeight: 700, fontSize: 13 }}>
              🚨 {overallCritical} {t("ambassador.critical", locale)}
            </div>
          )}
          {overallWarning > 0 && (
            <div style={{ padding: "4px 12px", borderRadius: 8, background: "#ef6c00", color: "#fff", fontWeight: 700, fontSize: 13 }}>
              ⚠️ {overallWarning} {t("ambassador.warning", locale)}
            </div>
          )}
          {overallCritical === 0 && overallWarning === 0 && (
            <div style={{ padding: "4px 12px", borderRadius: 8, background: "#e8f5e9", color: "#2e7d32", fontWeight: 700, fontSize: 13 }}>
              ✅ {t("ambassador.allNormal", locale)}
            </div>
          )}
        </div>
      </div>

      {/* 5-cell grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {(["safety", "effectiveness", "efficiency", "swiftness", "collaboration"] as AmbassadorDimension[]).map(dim => {
          const health = healthList.find(h => h.dimension === dim) ?? { dimension: dim, status: "ok" as const, criticalCount: 0, warningCount: 0, summary: "—" };
          return (
            <AmbassadorCell
              key={dim}
              dimension={dim}
              health={health}
              locale={locale}
              onNavigate={onNavigate}
            />
          );
        })}
      </div>
    </div>
  );
}