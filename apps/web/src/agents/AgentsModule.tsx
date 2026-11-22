import { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { AgentDashboard } from "./AgentDashboard";
import { ServiceRegistry } from "./ServiceRegistry";
import { AgentBusMonitor } from "./AgentBusMonitor";
import { VirtualEmployeeCenter } from "./VirtualEmployeeCenter";
import { VirtualEmployeeManagement } from "./VirtualEmployeeManagement";
import { VirtualEmployeeDevelopment } from "./VirtualEmployeeDevelopment";
import { FactoryArchitectureView } from "./FactoryArchitectureView";
import { type SignInResult } from "../auth/AuthSignIn";

export type AgentTabKey = "runtime" | "manage" | "development" | "architecture" | "org" | "services" | "bus";
interface Props { locale: Locale; currentUser: SignInResult }

const TAB_KEYS: Record<AgentTabKey, string> = {
  runtime: "agents.tab.runtime",
  manage: "agents.tab.manage",
  development: "agents.tab.development",
  architecture: "agents.tab.architecture",
  org: "agents.tab.org",
  services: "agents.tab.services",
  bus: "agents.tab.bus",
};

export function AgentsModule({ locale, currentUser }: Props) {
  const [activeTab, setActiveTab] = useState<AgentTabKey>("runtime");
  const tabs: AgentTabKey[] = ["runtime", "manage", "development", "architecture", "org", "services", "bus"];
  return <main className="screen-stack" aria-label={t("nav.agents", locale)} data-testid="agents.page">
    <section className="surface-panel">
      <div className="page-header">
        <div>
          <h2>{t("agents.center.title", locale)}</h2>
          <p>{t("agents.center.subtitle", locale)}</p>
        </div>
      </div>
    </section>
    <nav className="toolbar" aria-label={t("agents.center.title", locale)} data-testid="agents.tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={activeTab === tab ? "active" : ""}
          data-testid={`agents.tab.${tab}`}
          title={t(TAB_KEYS[tab], locale)}
          onClick={() => setActiveTab(tab)}
        >
          {t(TAB_KEYS[tab], locale)}
        </button>
      ))}
    </nav>
    {activeTab === "runtime" && <VirtualEmployeeCenter locale={locale} />}
    {activeTab === "manage" && <VirtualEmployeeManagement locale={locale} />}
    {activeTab === "development" && <VirtualEmployeeDevelopment locale={locale} />}
    {activeTab === "architecture" && <FactoryArchitectureView />}
    {activeTab === "org" && <AgentDashboard locale={locale} currentUser={currentUser} />}
    {activeTab === "services" && <ServiceRegistry locale={locale} canManage={true} />}
    {activeTab === "bus" && <AgentBusMonitor locale={locale} />}
  </main>;
}
