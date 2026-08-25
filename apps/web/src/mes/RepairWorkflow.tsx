import { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { RepairStation } from "./RepairStation";
import { ProcessFlow } from "./ProcessFlow";
import { mesApi } from "../api/mes";
import { useEffect } from "react";
import { RepairLoopDisplay } from "./RepairLoopDisplay";

export function RepairWorkflow({ locale }: { locale: Locale }) {
  const [activeTab, setActiveTab] = useState<"operate" | "monitor" | "process">("operate");

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
          MES &gt; {t("mes.subnav.repair", locale)}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          {t("mes.repair.title", locale)}
        </h2>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          paddingBottom: 0,
        }}
      >
        {(["operate", "monitor", "process"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid var(--info)" : "2px solid transparent",
              background: "none",
              color: activeTab === tab ? "var(--info)" : "var(--muted)",
              fontWeight: activeTab === tab ? 700 : 400,
              cursor: "pointer",
              fontSize: 13,
              borderRadius: "4px 4px 0 0",
              transition: "color 0.15s",
            }}
          >
            {tab === "operate"
              ? t("mes.repair.title", locale)
              : tab === "monitor" ? (locale === "zh-CN" ? "闭环监控" : locale === "vi-VN" ? "Giám sát vòng kín" : "Loop monitor") : t("mes.stationWorkflow.flow", locale)}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "operate" ? (
        <RepairStation locale={locale} />
      ) : activeTab === "monitor" ? (
        <RepairLoopDisplay locale={locale} />
      ) : (
        <ProcessFlow locale={locale} />
      )}
    </div>
  );
}
