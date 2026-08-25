import { useState } from "react";
import { t } from "../i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";
import type { AppEntry, ProjectTabKey } from "./index";
import { projectTabKeys, projectTabTranslationKeys } from "./index";
import { ProjectDashboard } from "./ProjectDashboard";
import { ProjectList } from "./ProjectList";
import { ProjectRegistration } from "./ProjectRegistration";

interface Props {
  locale: Locale;
}

export function Projects({ locale }: Props) {
  const [activeTab, setActiveTab] = useState<ProjectTabKey>("dashboard");
  const [editEntry, setEditEntry] = useState<AppEntry | null>(null);

  const handleEdit = (app: AppEntry) => {
    setEditEntry(app);
    setActiveTab("register");
  };

  const handleSaved = () => {
    setEditEntry(null);
    setActiveTab("dashboard");
  };

  const handleCancel = () => {
    setEditEntry(null);
    setActiveTab("dashboard");
  };

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <div className="section-header">
          <div>
            <h2>{t("nav.projects", locale)}</h2>
            <p>{t("page.projects", locale)}</p>
          </div>
        </div>
        <div className="toolbar">
          {projectTabKeys.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={activeTab === tabKey ? "active" : ""}
              onClick={() => { setActiveTab(tabKey); setEditEntry(null); }}
            >
              {t(projectTabTranslationKeys[tabKey] as any, locale)}
            </button>
          ))}
        </div>
      </div>
      {activeTab === "dashboard" && <ProjectDashboard locale={locale} onEdit={handleEdit} />}
      {activeTab === "list" && <ProjectList locale={locale} onEdit={handleEdit} />}
      {activeTab === "register" && <ProjectRegistration locale={locale} editEntry={editEntry} onSaved={handleSaved} onCancel={handleCancel} />}
    </div>
  );
}
