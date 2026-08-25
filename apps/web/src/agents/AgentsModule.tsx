import { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { AgentDashboard } from "./AgentDashboard";
import { ServiceRegistry } from "./ServiceRegistry";
import { AgentBusMonitor } from "./AgentBusMonitor";
import { type SignInResult } from "../auth/AuthSignIn";

export type AgentTabKey = "org" | "services" | "bus";

interface Props {
  locale: Locale;
  currentUser: SignInResult;
}

export function AgentsModule({ locale, currentUser }: Props) {
  const [activeTab, setActiveTab] = useState<AgentTabKey>("org");

  return (
    <div>
      {/* Tab nav */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
        {(["org", "services", "bus"] as AgentTabKey[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              background: "none",
              border: "none",
              borderBottom: activeTab === tab ? "2px solid var(--info)" : "2px solid transparent",
              color: activeTab === tab ? "var(--text)" : "var(--muted)",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {tab === "org"
              ? t("agents.tab.org", locale)
              : tab === "services"
              ? t("agents.tab.services", locale)
              : t("agents.tab.bus", locale)}
          </button>
        ))}
      </div>

      {activeTab === "org" && <AgentDashboard locale={locale} currentUser={currentUser} />}
      {activeTab === "services" && <ServiceRegistry locale={locale} canManage={true} />}
      {activeTab === "bus" && <AgentBusMonitor locale={locale} />}
    </div>
  );
}
