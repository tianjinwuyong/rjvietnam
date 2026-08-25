import { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import { projectMgmtTabKeys, projectMgmtTabTranslationKeys, type ProjectMgmtTabKey } from "./index";
import type { Project } from "../api/projectMgmt";
import { ProjectMgmtDashboard } from "./ProjectMgmtDashboard";
import { ProjectMgmtList } from "./ProjectMgmtList";
import { ProjectMgmtRegistration } from "./ProjectMgmtRegistration";

interface Props {
  locale: Locale;
}

export function ProjectMgmt({ locale }: Props) {
  const [activeTab, setActiveTab] = useState<ProjectMgmtTabKey>("dashboard");
  const [editTarget, setEditTarget] = useState<Project | null>(null);

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard":
        return <ProjectMgmtDashboard locale={locale} />;
      case "register":
        return <ProjectMgmtRegistration locale={locale} editProject={null} onSaved={() => setActiveTab("list")} onCancel={() => setActiveTab("list")} />;
      case "list":
        return <ProjectMgmtList locale={locale} onEdit={(p) => { setEditTarget(p); setActiveTab("register"); }} />;
    }
  };

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("nav.projectMgmt", locale)}</h2>
            <p>{t("page.projectMgmt", locale)}</p>
          </div>
          {activeTab === "list" && (
            <button className="action-button" type="button" onClick={() => { setEditTarget(null); setActiveTab("register"); }}>
              {t("projectMgmt.form.newProject", locale)}
            </button>
          )}
        </div>
        <div className="toolbar">
          {projectMgmtTabKeys.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={activeTab === tabKey ? "active" : ""}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(projectMgmtTabTranslationKeys[tabKey], locale)}
            </button>
          ))}
        </div>
      </div>
      {renderActiveView()}
    </div>
  );
}
