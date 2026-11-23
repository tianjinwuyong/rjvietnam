// Pmc 域 —— 阶段4步2 从 App.tsx 整段搬迁（refactor-plan-2026-11-21）。
// dispatcher 与其独占 helper/页面 import 一起搬出;App.tsx 改 lazy() 加载,使这些页面
// 离开 eager main chunk。声明体逐字未改;共享名按名 import(路径按新文件位置 rebase)。
import { useState } from "react";
import { SectionHeader, SurfacePanel } from "../components/primitives";
import { Locale } from "../../../../packages/shared-types/src/factory";
import { t } from "../i18n";
import { MobileCheckin } from "../MobileCheckin";
import { PmcTabKey, pmcTabKeys, pmcTabTranslationKeys, PmcDashboard, PmcWorkOrderList, PmcWorkOrderDetail, PmcCreateWorkOrder, PmcProductionReporting, PmcMaterialIssue, PmcWipTracking, PmcAlertDashboard, PmcGanttView, PmcAndonBoard, PmcStationCheckin, PmcWoFreeze, PmcWoQualityReport, PmcAlertHistory, PmcNgReview, PmcCompensationApproval, PmcPoList, PmcCustomerProductMaster, PmcMaterialStatus, PmcSupplementaryMaterial, BomList, PmcPatrolDashboard, PmcDeliveryWatch, PmcClosedLoop } from "./";
import { lazy } from "react";


export function Pmc({ locale, permissions }: { locale: Locale; permissions: string[] }) {
  const [activeTab, setActiveTab] = useState<PmcTabKey>("dashboard");
  // Rule 6.1: Only roles with pmc.manage or pmc.create permission can create work orders
  const canCreate = permissions.includes("pmc.manage") || permissions.includes("pmc.create");
  const visibleTabs = pmcTabKeys.filter((k) => k !== "createWorkOrder" || canCreate);

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard": return <PmcDashboard locale={locale} />;
      case "workOrders": return <PmcWorkOrderList locale={locale} />;
      case "workOrderDetail": return <PmcWorkOrderDetail locale={locale} />;
      case "createWorkOrder": return <PmcCreateWorkOrder locale={locale} />;
      case "productionReporting": return <PmcProductionReporting locale={locale} />;
      case "materialIssue": return <PmcMaterialIssue locale={locale} />;
      case "wipTracking": return <PmcWipTracking locale={locale} />;
      case "alertDashboard": return <PmcAlertDashboard locale={locale} />;
      case "alertHistory": return <PmcAlertHistory locale={locale} />;
      case "ngReview": return <PmcNgReview locale={locale} />;
      case "compensationApproval": return <PmcCompensationApproval locale={locale} />;
      case "ganttView": return <PmcGanttView locale={locale} />;
      case "andonBoard": return <PmcAndonBoard locale={locale} />;
      case "stationCheckin": return <PmcStationCheckin locale={locale} />;
      case "woFreeze": return <PmcWoFreeze locale={locale} />;
      case "woQualityReport": return <PmcWoQualityReport locale={locale} />;
      case "poList": return <PmcPoList locale={locale} />;
      case "masterData": return <PmcCustomerProductMaster locale={locale} />;
      case "materialStatus": return <PmcMaterialStatus locale={locale} />;
      case "supplementaryMaterial": return <PmcSupplementaryMaterial locale={locale} />;
      case "bom": return <BomList locale={locale} />;
      case "patrolDashboard": return <PmcPatrolDashboard locale={locale} />;
      case "deliveryWatch": return <PmcDeliveryWatch locale={locale} />;
      case "closedLoop": return <PmcClosedLoop locale={locale} />;
      case "mobile": return <MobileCheckin locale={locale} />;
    }
  };

  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.pmc", locale)} subtitle={t("page.pmc", locale)} />
        <div className="toolbar" data-testid="pmc.tabs">
          {visibleTabs.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={activeTab === tabKey ? "active" : ""}
              data-testid={`pmc.tab.${tabKey}`}
              title={t(pmcTabTranslationKeys[tabKey], locale)}
              onClick={() => setActiveTab(tabKey)}
            >
              {t(pmcTabTranslationKeys[tabKey], locale)}
            </button>
          ))}
        </div>
      </SurfacePanel>
      {renderActiveView()}
    </div>
  );
}

