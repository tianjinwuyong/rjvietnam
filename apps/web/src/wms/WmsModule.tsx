// Wms 域 dispatcher —— 阶段4步2 从 App.tsx 整段搬迁（refactor-plan-2026-11-21）。
// dispatcher 与其独占页面组件 import 一起搬出,App.tsx 改 lazy() 加载,使这些页面离开
// eager main chunk。声明体逐字未改;共享基元/类型按名 import(路径按新文件位置 rebase)。
import { useEffect, useState, Suspense, lazy } from "react";
import { SectionHeader, SurfacePanel } from "../components/primitives";
import { Locale } from "../../../../packages/shared-types/src/factory";
import { TranslationKey, t } from "../i18n";
import { WmsIqcTemplates } from "./WmsIqcTemplates";
import { WmsGraftedOps } from "./WmsGraftedOps";
import { WmsMaterialSubstitution } from "./WmsMaterialSubstitution";
import { WmsTabKey, wmsMenuGroups, wmsTabTranslationKeys, WmsDashboard, WmsMenuPage, WmsIncoming, WmsMaterialReceiving, WmsMaterialLoading, WmsSmtClosedLoop, WmsNonSmtClosedLoop, WmsFinishedGoods, WmsReceiving, WmsReturnReceiving, WmsSupplierReturn, WmsSalesReturn, WmsIqc, WmsIqcClosedLoop, WmsIqcDefectLoop, WmsIqcInspection, WmsIqcReport, WmsIqcStandards, WmsSupplierKpi, WmsSupplierManagement, WmsQualityTrend, WmsPutAway, WmsInventory, WmsPicking, WmsIssue, WmsWoHandover, WmsTransactions, WmsMaterialConsumption, WmsSmartShelfTester, WmsShelfApiTester, WmsShelfSimulator, WmsShelfOperations, WmsSqlConsole, WmsRackSimulator, WmsSmartRackManager, SmartRackWorkflow, WmsMaterialMaster, WmsLocationManagement, WmsBatchManagement, WmsBasicData, WmsRjvnData, WmsRjvnIqc, WmsRjvnReceipt, WmsRjvnInventory, WmsRjvnPicking, WmsRjvnDocFlow, WmsCanonicalData, WmsRjvnClassic, WmsCycleCount, WmsTransferAdjust, WmsExpiryControl, WmsFifoMonitor, WmsTraceability, WmsMaterialTraceRoute, WmsMsd, WmsSolderPaste, WmsAuxiliary, WmsCollaborationDashboard, WmsClosureDashboard, WmsLifecycleDashboard, WmsFifoSimulation, WmsPdaReceivingMobile, WmsPdaConsumption, WmsPdaCycleCount, WmsPdaIqc, WmsPdaHistory, WmsInboundOrders, WmsOutboundOrders, WmsRequisitions, WmsReturnSlips, WmsReplenishments, WmsSyncHealth, WmsProductionInbound, WmsProductionOutbound, WmsSlips, WmsOverPicking, WmsRework, WmsSupplierDebt, WmsDefectiveMove, WmsMrb, WmsSupplierReturnOrder, WmsNotices, WmsMesSync } from "./";
import { WmsNonIqcClosedLoop } from "./WmsNonIqcClosedLoop";
import { WmsMaterialBarcodeLoop } from "./WmsMaterialBarcodeLoop";
import { WmsMaterialDistribution } from "./WmsMaterialDistribution";
import { WmsIqcFlowPages } from "./WmsIqcFlowPages";
import { WmsIqcInspectionLevels } from "./WmsIqcInspectionLevels";
import { QmsDashboard, QmsOqcBatches, QmsNgCases, QmsEightD } from "../qms";

const LazyWms3dFlow = lazy(() => import("./Wms3dFlow").then(m => ({ default: m.Wms3dFlow })));
const LazyWmsInventoryControlCenter = lazy(() => import("./WmsInventoryControlCenter").then(m => ({ default: m.WmsInventoryControlCenter })));
// 评审 N4:仓库组里偏工程/管理的 tab(非日常作业),用于弱化显示 + tooltip 前缀。
const WMS_ENGINEERING_TABS: Partial<Record<WmsTabKey, true>> = {
  batchManagement: true, locationManagement: true, fifoSimulation: true, transactions: true,
};

export function Wms({ locale, permissions, roleKey }: { locale: Locale; permissions: string[]; roleKey: string }) {
  const [activeTab, setActiveTab] = useState<WmsTabKey>(() => {
    const requested = new URLSearchParams(window.location.search).get("wmsTab") as WmsTabKey | null;
    return requested && Object.prototype.hasOwnProperty.call(wmsTabTranslationKeys, requested)
      ? requested
      : "dashboard";
  });

  useEffect(() => {
    const onFactoryNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string; wmsTab?: string }>).detail;
      if (detail?.view === "wms" && detail.wmsTab && Object.prototype.hasOwnProperty.call(wmsTabTranslationKeys, detail.wmsTab)) {
        setActiveTab(detail.wmsTab as WmsTabKey);
      }
    };
    window.addEventListener("factory:navigate", onFactoryNavigate);
    return () => window.removeEventListener("factory:navigate", onFactoryNavigate);
  }, []);

  const navigateWms = (tab: WmsTabKey) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "wms");
    url.searchParams.set("wmsTab", tab);
    window.history.replaceState({}, "", url);
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard": return <WmsDashboard locale={locale} />;
      case "rjvnData": return <WmsRjvnData locale={locale} />;
      case "rjvnIqc": return <WmsRjvnIqc locale={locale} />;
      case "rjvnReceipt": return <WmsRjvnReceipt locale={locale} />;
      case "rjvnInventory": return <WmsRjvnInventory locale={locale} />;
      case "rjvnPicking": return <WmsRjvnPicking locale={locale} />;
      case "rjvnDocFlow": return <WmsRjvnDocFlow locale={locale} />;
      case "rjvnCanonical": return <WmsCanonicalData locale={locale} />;
      case "rjvnClassic": return <WmsRjvnClassic locale={locale} roleKey={roleKey} />;
      case "receiving": return <WmsReceiving locale={locale} />;
      case "returnReceive": return <WmsReturnReceiving locale={locale} />;
      case "supplierReturn": return <WmsSupplierReturn locale={locale} />;
      case "salesReturn": return <WmsSalesReturn locale={locale} />;
      case "iqc": return <WmsIqc locale={locale} />;
      case "iqcClosedLoop": return <WmsIqcClosedLoop locale={locale} />;
      case "iqcDefectLoop": return <WmsIqcDefectLoop locale={locale} />;
      case "iqcInspectionLevels": return <WmsIqcInspectionLevels locale={locale} />;
      case "poReceipt": return <WmsIqcFlowPages page="poReceipt" locale={locale} />;
      case "lineReturn": return <WmsIqcFlowPages page="lineReturn" locale={locale} />;
      case "subcontractReturn": return <WmsIqcFlowPages page="subcontractReturn" locale={locale} />;
      case "mrbReworkReturn": return <WmsIqcFlowPages page="mrbReworkReturn" locale={locale} />;
      case "qrBinding": return <WmsIqcFlowPages page="qrBinding" locale={locale} />;
      case "iqcPassMaintenance": return <WmsIqcFlowPages page="iqcPassMaintenance" locale={locale} />;
      case "defectArchive": return <WmsIqcFlowPages page="defectArchive" locale={locale} />;
      case "mrbApproval": return <WmsIqcFlowPages page="mrbApproval" locale={locale} />;
      case "scrapFinanceApproval": return <WmsIqcFlowPages page="scrapFinanceApproval" locale={locale} />;
      case "reworkComplete": return <WmsIqcFlowPages page="reworkComplete" locale={locale} />;
      case "iqcReinspection": return <WmsIqcFlowPages page="iqcReinspection" locale={locale} />;
      case "iqcInspect": return <WmsIqcInspection locale={locale} />;
      case "iqcReport": return <WmsIqcReport locale={locale} />;
      case "iqcStandards": return <WmsIqcStandards locale={locale} />;
      case "supplierKpi": return <WmsSupplierKpi locale={locale} />;
      case "supplierManagement": return <WmsSupplierManagement locale={locale} roleKey={roleKey} />;
      case "qualityTrend": return <WmsQualityTrend locale={locale} />;
      case "putaway": return <WmsPutAway locale={locale} />;
      case "inventory": return <WmsInventory locale={locale} />;
      case "picking": return <WmsPicking locale={locale} />;
      case "issue": return <WmsIssue locale={locale} />;
      case "woHandover": return <WmsWoHandover locale={locale} />;
      case "slips": return <WmsSlips locale={locale} />;
      case "cycleCount": return <WmsCycleCount locale={locale} />;
      case "transferAdjust": return <WmsTransferAdjust locale={locale} />;
      case "expiryControl": return <WmsExpiryControl locale={locale} />;
      case "iqcTemplates": return <WmsIqcTemplates locale={locale} />;
      case "graftOps": return <WmsGraftedOps locale={locale} />;
      case "substitution": return <WmsMaterialSubstitution locale={locale} />;
      case "fifoMonitor": return <WmsFifoMonitor locale={locale} />;
      case "transactions": return <WmsTransactions locale={locale} />;
      case "materialConsumption": return <WmsMaterialConsumption locale={locale} />;
      case "materialDistribution": return <WmsMaterialDistribution locale={locale} />;
      case "traceability": return <WmsTraceability locale={locale} />;
      case "materialTrace": return <WmsMaterialTraceRoute locale={locale} />;
      case "wms3dFlow": return <Suspense fallback={<div className="surface-panel"><div className="placeholder-view">Loading 3D WMS flow...</div></div>}><LazyWms3dFlow locale={locale} /></Suspense>;
      case "inventoryControl": return <Suspense fallback={<div className="surface-panel"><div className="placeholder-view">Loading inventory control...</div></div>}><LazyWmsInventoryControlCenter locale={locale} /></Suspense>;
      case "msd": return <WmsMsd locale={locale} />;
      case "solderPaste": return <WmsSolderPaste locale={locale} />;
      case "auxiliary": return <WmsAuxiliary locale={locale} />;
      case "collaboration": return <WmsCollaborationDashboard locale={locale} />;
      case "closure": return <WmsClosureDashboard locale={locale} />;
      case "smartShelf": return <WmsSmartShelfTester locale={locale} />;
      case "shelfApi": return <WmsShelfApiTester locale={locale} />;
      case "shelfSim": return <WmsShelfSimulator locale={locale} />;
      case "shelfSim3d": return <div className="surface-panel"><div className="placeholder-view"><p>🏭 3D 货架模拟器 — 入口：主厂房 → 视图 → 原材料仓库</p><p style={{fontSize:12,color:"#64748b",marginTop:8}}>Smart shelf 3D view is integrated in the Manual Line 3D dashboard (主厂房 → 视图 → 原材料仓库)</p></div></div>;
      case "shelfOps": return <WmsShelfOperations />;
      case "sqlConsole": return <WmsSqlConsole />;
      case "rackSim": return <WmsRackSimulator />;
      case "smartRack": return <WmsSmartRackManager locale={locale} />;
      case "smartRackWorkflow": return <SmartRackWorkflow locale={locale} />;
      case "lifecycle": return <WmsLifecycleDashboard permissions={permissions} locale={locale} />;
      case "fifoSimulation": return <WmsFifoSimulation locale={locale} />;
      case "materialMaster": return <WmsMaterialMaster locale={locale} />;
      case "materialBarcodeLoop": return <WmsMaterialBarcodeLoop locale={locale} />;
      case "locationManagement": return <WmsLocationManagement locale={locale} />;
      case "basicData": return <WmsBasicData locale={locale} onNavigate={setActiveTab} />;
      case "batchManagement": return <WmsBatchManagement locale={locale} />;
      // PDA receiving intentionally uses the same full receiving workspace as
      // the management system. This keeps QR/label printing, material-code
      // mapping, pallet/box binding, OA and IQC state on one API-backed flow.
      case "pdaReceiving": return <WmsMaterialReceiving locale={locale} />;
      case "pdaReceivingMobile": return <WmsPdaReceivingMobile locale={locale} />;
      case "pdaConsumption": return <WmsPdaConsumption locale={locale} />;
      case "pdaMsd": return <WmsMsd locale={locale} initialTab="pdaSync" />;
      case "pdaCycleCount": return <WmsPdaCycleCount locale={locale} />;
      case "pdaIqc": return <WmsPdaIqc locale={locale} />;
      case "pdaHistory": return <WmsPdaHistory locale={locale} />;
      case "inboundOrders": return <WmsInboundOrders />;
      case "outboundOrders": return <WmsOutboundOrders />;
      case "requisitions": return <WmsRequisitions locale={locale} />;
      case "returnSlips": return <WmsReturnSlips />;
      case "replenishments": return <WmsReplenishments locale={locale} />;
      case "syncHealth": return <WmsSyncHealth locale={locale} />;
      case "incoming": return <WmsIncoming locale={locale} />;
      case "materialReceiving": return <WmsMaterialReceiving locale={locale} />;
      case "materialLoading": return <WmsMaterialLoading locale={locale} />;
      case "smtClosedLoop": return <WmsSmtClosedLoop locale={locale} />;
      case "nonSmtClosedLoop": return <WmsNonSmtClosedLoop locale={locale} />;
      case "nonIqcClosedLoop": return <WmsNonIqcClosedLoop locale={locale} />;
      case "finishedGoods": return <WmsFinishedGoods locale={locale} />;
      case "productionInbound": return <WmsProductionInbound locale={locale} />;
      case "productionOutbound": return <WmsProductionOutbound locale={locale} />;
      case "qualityDashboard": return <QmsDashboard locale={locale} />;
      case "oqc": return <QmsOqcBatches locale={locale} />;
      case "ngManagement": return <QmsNgCases locale={locale} />;
      case "eightD": return <QmsEightD locale={locale} />;
      case "overPicking": return <WmsOverPicking locale={locale} />;
      case "rework": return <WmsRework locale={locale} />;
      case "supplierDebt": return <WmsSupplierDebt locale={locale} />;
      case "defectiveMove": return <WmsDefectiveMove locale={locale} />;
      case "mrb": return <WmsMrb locale={locale} />;
      case "supplierReturnOrder": return <WmsSupplierReturnOrder locale={locale} />;
      case "notices": return <WmsNotices locale={locale} />;
      case "mesSync": return <WmsMesSync locale={locale} />;
      default:
        return (
          <SurfacePanel>
            <div className="placeholder-view">
              {t("common.open", locale)}
            </div>
          </SurfacePanel>
        );
    }
  };

  const activeGroup = wmsMenuGroups.find((group) => group.tabs.includes(activeTab)) ?? wmsMenuGroups[0];

  const isMenuPage = activeTab === "dashboard";

  return (
    <div className="screen-stack">
      {isMenuPage ? (
        <WmsMenuPage locale={locale} onNavigate={navigateWms} />
      ) : (
        <>
          <SurfacePanel>
            <SectionHeader title={t("nav.wms", locale)} subtitle={t("page.wms", locale)} />
            <div className="toolbar" style={{ flexWrap: "wrap", overflowX: "visible" }} data-testid="wms.groups">
              <button
                className="action-button"
                type="button"
                title={t("wms.backToMenu", locale)}
                style={{ background: "var(--nav)", marginRight: 8 }}
                onClick={() => navigateWms("dashboard")}
              >
                ← {t("wms.menuPage", locale)}
              </button>
              {wmsMenuGroups.map((group) => (
                <button
                  className="action-button"
                  key={group.key}
                  type="button"
                  data-testid={`wms.group.${group.key}`}
                  title={t(group.translationKey as TranslationKey, locale)}
                  style={{ background: activeGroup.key === group.key ? "var(--info)" : "var(--nav)" }}
                  onClick={() => { if (!group.tabs.includes(activeTab)) navigateWms(group.tabs[0]); }}
                >
                  {t(group.translationKey as TranslationKey, locale)}
                </button>
              ))}
            </div>
          </SurfacePanel>

          <SurfacePanel>
            <div className="toolbar" style={{ flexWrap: "wrap", overflowX: "visible" }} data-testid="wms.tabs">
              {activeGroup.tabs.map((subKey) => (
                <button
                  key={subKey}
                  type="button"
                  className={activeTab === subKey ? "active" : ""}
                  data-testid={`wms.tab.${subKey}`}
                  // 评审 N4:仓库组 13 个 tab 平铺时,工程/管理类(批次序列号、库位精细化、
                  // FIFO 模拟、履历)与日常作业同权重。tooltip 里加"管理/工程"前缀标注,
                  // 不增加点击深度、不改路由。
                  title={(activeGroup.key === "warehouse" && WMS_ENGINEERING_TABS[subKey]
                    ? `${t("wms.engineeringTabHint" as TranslationKey, locale)} · ` : "")
                    + t(wmsTabTranslationKeys[subKey] as TranslationKey, locale)}
                  onClick={() => navigateWms(subKey)}
                  style={activeGroup.key === "warehouse" && WMS_ENGINEERING_TABS[subKey] ? { opacity: 0.78 } : undefined}
                >
                  {t(wmsTabTranslationKeys[subKey] as TranslationKey, locale)}
                </button>
              ))}
            </div>
          </SurfacePanel>
        </>
      )}

      {!isMenuPage && renderActiveView()}
    </div>
  );
}

