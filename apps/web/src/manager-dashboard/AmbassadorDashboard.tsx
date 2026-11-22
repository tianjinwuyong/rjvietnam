import { useEffect, useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { useAmbassador } from "./useAmbassador";
import {
  computeAllHealth, AMBASSADOR_META,
  type AmbassadorHealth, type AmbassadorDimension,
} from "./ambassadorHealth";
import { deriveEffectivenessAlerts } from "./EffectivenessAmbassador";
import { deriveEfficiencyAlerts } from "./EfficiencyAmbassador";
import { deriveSwiftnessAlerts } from "./SwiftnessAmbassador";
import { deriveCollaborationAlerts } from "./CollaborationAmbassador";

// ── Shared alert derivation (re-exported so dashboard can count) ────
export { deriveEffectivenessAlerts, deriveEfficiencyAlerts, deriveSwiftnessAlerts, deriveCollaborationAlerts };

// Status tone per health, mapped onto the shared badge vocabulary so the
// warning = at-risk / danger = blocked rule holds on every page (brief #5).
const HEALTH_TONE: Record<AmbassadorHealth["status"], "ok" | "warning" | "danger"> = {
  ok: "ok",
  warning: "warning",
  critical: "danger",
};

const STATUS_LABEL_KEY: Record<AmbassadorHealth["status"], string> = {
  ok: "ambassador.status.ok",
  warning: "ambassador.status.warning",
  critical: "ambassador.status.critical",
};

const DIMENSIONS: AmbassadorDimension[] = ["safety", "effectiveness", "efficiency", "swiftness", "collaboration"];

// ── Ambassador cells that show alert counts ─────────────────────────
interface AmbassadorCellProps {
  dimension: AmbassadorDimension;
  health: AmbassadorHealth;
  locale: Locale;
  onNavigate: (dim: AmbassadorDimension) => void;
}

function AmbassadorCell({ dimension, health, locale, onNavigate }: AmbassadorCellProps) {
  const meta = AMBASSADOR_META[dimension];
  const tone = HEALTH_TONE[health.status];
  const total = health.criticalCount + health.warningCount;
  const label = t(meta.labelKey, locale);

  return (
    <button
      type="button"
      className={`ambassador-cell tone-${tone}`}
      data-testid={`ambassador.cell.${dimension}`}
      aria-label={`${label} — ${t(STATUS_LABEL_KEY[health.status], locale)}`}
      title={health.summary}
      onClick={() => onNavigate(dimension)}
    >
      <span className="ambassador-cell-head">
        <span className="glyph" aria-hidden="true">{meta.icon}</span>
        <strong>{label}</strong>
        <span className={`badge badge-${tone}`} data-testid={`ambassador.status.${dimension}`}>
          {t(STATUS_LABEL_KEY[health.status], locale)}
        </span>
      </span>
      <span className="ambassador-cell-summary">{health.summary}</span>
      <span className="ambassador-cell-counts">
        {total > 0 ? (
          <>
            {health.criticalCount > 0 && <span className="badge badge-danger" title={t("ambassador.critical", locale)}>{health.criticalCount} {t("ambassador.critical", locale)}</span>}
            {health.warningCount > 0 && <span className="badge badge-warning" title={t("ambassador.warning", locale)}>{health.warningCount} {t("ambassador.warning", locale)}</span>}
          </>
        ) : (
          <span className="badge badge-ok" title={t("ambassador.noIssues", locale)}>0 {t("ambassador.noIssues", locale)}</span>
        )}
      </span>
      <span className="ambassador-cell-hint">{t("ambassador.clickToView", locale)} →</span>
    </button>
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
    <section className="screen-stack" aria-label={t("ambassador.dashboard.title", locale)} data-testid="ambassador.page">
      <div className="page-header">
        <div>
          <h2>
            <span className="glyph" aria-hidden="true">🎖️</span>{" "}
            {t("ambassador.dashboard.title", locale)}
          </h2>
          <p>{t("page.ambassadorDashboard", locale)}</p>
        </div>
        <div className="toolbar" style={{ gap: 8 }}>
          <span className={`badge badge-${loading ? "warning" : "ok"}`} data-testid="ambassador.live" title={loading ? t("common.refreshing", locale) : t("app.liveData", locale)}>
            {loading ? t("common.refreshing", locale) : t("app.liveData", locale)}
          </span>
          {overallCritical > 0 && <span className="badge badge-danger" data-testid="ambassador.total-critical">{overallCritical} {t("ambassador.critical", locale)}</span>}
          {overallWarning > 0 && <span className="badge badge-warning" data-testid="ambassador.total-warning">{overallWarning} {t("ambassador.warning", locale)}</span>}
          {!loading && overallCritical === 0 && overallWarning === 0 && (
            <span className="badge badge-ok" data-testid="ambassador.all-normal">{t("ambassador.allNormal", locale)}</span>
          )}
        </div>
      </div>

      {/* 5-cell grid */}
      <div className="card-grid ambassador-grid" data-testid="ambassador.grid">
        {DIMENSIONS.map(dim => {
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
    </section>
  );
}
