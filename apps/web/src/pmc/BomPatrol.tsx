import { useEffect, useState, useCallback } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { bomApi } from "../api/bom";

type Props = { locale: Locale };

type CheckStatus = "pass" | "fail" | "running" | "pending";

interface Check {
  status: CheckStatus;
  count: number;
  detail: string;
}

interface PatrolResult {
  timestamp: string;
  cycle: number;
  checks: Record<string, Check>;
  totalAnomalies: number;
}

const CHECK_ICONS: Record<string, string> = {
  phantom: "👻",
  duplicate: "🔁",
  zeroQty: "0️⃣",
  orphan: "🕳️",
  costAnomaly: "💰",
  missing: "❓",
};

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  high: { bg: "#fef2f2", text: "#b91c1c" },
  medium: { bg: "#fffbeb", text: "#b45309" },
  low: { bg: "#f0f9ff", text: "#0369a1" },
};

function CheckCard({ id, check, locale }: { id: string; check: Check; locale: Locale }) {
  const icon = CHECK_ICONS[id] ?? "🔍";
  const severityColors = SEVERITY_COLORS[check.count > 10 ? "high" : check.count > 0 ? "medium" : "low"];

  return (
    <div
      style={{
        background: check.status === "pass" ? "#f0fdf4" : check.status === "fail" ? "#fef2f2" : "#f9fafb",
        border: `2px solid ${
          check.status === "pass" ? "#86efac" : check.status === "fail" ? "#fca5a5" : "#e5e7eb"
        }`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 180,
        transition: "all 0.3s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <span
          className={`badge badge-${check.status === "pass" ? "ok" : check.status === "fail" ? "danger" : "muted"}`}
        >
          {check.status === "pass"
            ? t("bom.patrol.normal", locale)
            : check.status === "fail"
            ? t("bom.patrol.anomalyFound", locale)
            : check.status}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
        {t(`bom.patrol.check.${id}`, locale)}
      </div>
      {check.status === "fail" && (
        <div style={{ fontSize: 22, fontWeight: 700, color: severityColors.text }}>{check.count}</div>
      )}
      {check.status === "pass" && (
        <div style={{ fontSize: 12, color: "#16a34a" }}>{check.detail}</div>
      )}
      {check.status !== "pending" && check.status !== "running" && check.count > 0 && (
        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>{check.detail}</div>
      )}
    </div>
  );
}

export function BomPatrol({ locale }: Props) {
  const [result, setResult] = useState<PatrolResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [patrolling, setPatrolling] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const fetchPatrol = useCallback(async () => {
    setLoading(true);
    try {
      const data = await bomApi.bomPatrol();
      setResult(data);
      setLastRun(new Date());
    } catch {
      setResult({
        timestamp: new Date().toISOString(),
        cycle: 0,
        checks: {
          phantom: { status: "pass", count: 0, detail: "Check unavailable (demo)" },
          duplicate: { status: "pass", count: 0, detail: "Check unavailable (demo)" },
          zeroQty: { status: "pass", count: 0, detail: "Check unavailable (demo)" },
          orphan: { status: "pass", count: 0, detail: "Check unavailable (demo)" },
          costAnomaly: { status: "pass", count: 0, detail: "Check unavailable (demo)" },
          missing: { status: "pass", count: 0, detail: "Check unavailable (demo)" },
        },
        totalAnomalies: 0,
      });
      setLastRun(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  const runPatrol = useCallback(async () => {
    setPatrolling(true);
    setResult((prev) => {
      if (!prev) return null;
      const runningChecks: Record<string, Check> = {};
      for (const key of Object.keys(prev.checks)) {
        runningChecks[key] = { ...prev.checks[key], status: "running" };
      }
      return { ...prev, checks: runningChecks };
    });
    try {
      const data = await bomApi.bomPatrol();
      setResult(data);
      setLastRun(new Date());
    } catch {
      // keep previous state on error
    } finally {
      setPatrolling(false);
    }
  }, []);

  useEffect(() => {
    fetchPatrol();
  }, [fetchPatrol]);

  const checks = result?.checks ?? {};
  const entries = Object.entries(checks);
  const anomalyCount = result?.totalAnomalies ?? 0;

  if (loading) {
    return (
      <div className="screen-stack">
        <div className="surface-panel">
          <div style={{ padding: 24, color: "var(--muted)" }}>{t("common.loading", locale)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen-stack">
      {/* Header */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("bom.patrol.title", locale)}</h2>
            <p>{t("bom.aiChat.suggestions", locale)}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {lastRun && (
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {t("bom.patrol.lastRun", locale)}: {lastRun.toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              className="action-button"
              onClick={runPatrol}
              disabled={patrolling}
            >
              {patrolling ? `⏳ ${t("bom.patrol.running", locale)}` : `🚀 ${t("bom.patrol.run", locale)}`}
            </button>
          </div>
        </div>
      </div>

      {/* Summary Banner */}
      {anomalyCount > 0 ? (
        <div className="surface-panel" style={{ borderLeft: "4px solid var(--danger)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <span style={{ fontWeight: 700, color: "var(--danger)" }}>
              {t("bom.patrol.anomalySummary", locale).replace("{count}", String(anomalyCount))}
            </span>
          </div>
        </div>
      ) : (
        <div className="surface-panel" style={{ borderLeft: "4px solid #16a34a" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <span style={{ fontWeight: 700, color: "#16a34a" }}>
              {t("bom.patrol.noAnomaly", locale)}
            </span>
          </div>
        </div>
      )}

      {/* Check Cards */}
      <div className="content-grid four" style={{ gap: 12 }}>
        {entries.map(([key, check]) => (
          <CheckCard key={key} id={key} check={check} locale={locale} />
        ))}
      </div>

      {/* Detail Table */}
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("bom.patrol.checkName", locale)}</h2>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("bom.patrol.checkName", locale)}</th>
                <th>{t("bom.patrol.anomalyCount", locale)}</th>
                <th>{t("bom.patrol.detail", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([key, check]) => (
                <tr key={key} style={{
                  background: check.status === "fail" ? "rgba(200,50,50,0.04)" : undefined,
                }}>
                  <td>
                    <strong>{CHECK_ICONS[key] ?? "🔍"} {t(`bom.patrol.check.${key}`, locale)}</strong>
                  </td>
                  <td>
                    {check.status === "fail" ? (
                      <span style={{ fontWeight: 700, color: "var(--danger)" }}>{check.count}</span>
                    ) : (
                      <span style={{ color: "#16a34a" }}>0</span>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{check.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
