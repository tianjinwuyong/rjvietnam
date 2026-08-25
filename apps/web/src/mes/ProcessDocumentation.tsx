import { useState } from "react";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { TranslationKey } from "../i18n";
import { t } from "../i18n";

// ── Flowchart metadata ─────────────────────────────────────────────
const FLOWS = [
  {
    id: "auto-line",
    image: "/mes-flowcharts/sheet1-auto-line-flow.png",
    labelKey: "mes.process.smtFlow" as TranslationKey,
    subtitleKey: "mes.process.smtFlow.subtitle" as TranslationKey,
  },
  {
    id: "po",
    image: "/mes-flowcharts/sheet2-po-flow.png",
    labelKey: "mes.process.poFlow" as TranslationKey,
    subtitleKey: "mes.process.poFlow.subtitle" as TranslationKey,
  },
  {
    id: "trace",
    image: "/mes-flowcharts/sheet3-traceability.png",
    labelKey: "trace.title" as TranslationKey,
    subtitleKey: "mes.process.trace.subtitle" as TranslationKey,
  },
  {
    id: "retest",
    image: "/mes-flowcharts/sheet4-retest.png",
    labelKey: "mes.subnav.retestRules" as TranslationKey,
    subtitleKey: "mes.process.retest.subtitle" as TranslationKey,
  },
  {
    id: "time",
    image: "/mes-flowcharts/sheet5-time-control.png",
    labelKey: "mes.subnav.timeControl" as TranslationKey,
    subtitleKey: "mes.process.time.subtitle" as TranslationKey,
  },
  {
    id: "stations",
    image: "/mes-flowcharts/sheet6-mes-stations.png",
    labelKey: "mes.process.mesStations" as TranslationKey,
    subtitleKey: "mes.process.mesStations.subtitle" as TranslationKey,
  },
] as const;

// ── Component ───────────────────────────────────────────────────────

export function ProcessDocumentation({ locale }: { locale: Locale }) {
  const [activeId, setActiveId] = useState<string>(FLOWS[0]!.id);

  const active = FLOWS.find((f) => f.id === activeId) ?? FLOWS[0];

  return (
    <div className="surface-panel" style={{ padding: "16px 0" }}>
      {/* Source note */}
      <div style={{
        margin: "0 16px 12px",
        padding: "8px 12px",
        background: "var(--nav)",
        borderRadius: 6,
        fontSize: 12,
        color: "var(--muted)",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        <span style={{ color: "var(--info)" }}>📋</span>
        <span>
          {t("mes.process.sourceNote" as TranslationKey, locale)}
          {" — "}
          <span style={{ color: "var(--text)" }}>MES流程(1).xlsx</span>
          {" · 6 {0} · ".replace("{0}", String(FLOWS.length))}
          <span style={{ color: "var(--ok)" }}>PNG</span>
        </span>
      </div>

      {/* Tab strip */}
      <div className="toolbar" style={{ padding: "0 16px", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {FLOWS.map((flow) => (
          <button
            key={flow.id}
            type="button"
            className={activeId === flow.id ? "active" : ""}
            style={{
              background: activeId === flow.id ? "var(--info)" : "var(--nav)",
              color: activeId === flow.id ? "white" : "var(--text)",
              border: "1px solid",
              borderColor: activeId === flow.id ? "var(--info)" : "transparent",
              borderRadius: 6,
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: activeId === flow.id ? 600 : 400,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onClick={() => setActiveId(flow.id)}
          >
            {t(flow.labelKey, locale)}
          </button>
        ))}
      </div>

      {/* Flow image */}
      <div style={{ padding: "0 16px" }}>
        <div style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          background: "#0F172A",
          textAlign: "center",
        }}>
          <img
            key={active.id}
            src={active.image}
            alt={t(active.labelKey, locale)}
            style={{
              width: "100%",
              height: "auto",
              maxHeight: "70vh",
              objectFit: "contain",
              display: "block",
              margin: "0 auto",
            }}
          />
        </div>

        {/* Caption */}
        <div style={{
          marginTop: 8,
          fontSize: 11,
          color: "var(--muted)",
          textAlign: "center",
        }}>
          {t(active.subtitleKey, locale)}
        </div>
      </div>
    </div>
  );
}
