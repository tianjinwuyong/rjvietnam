export type WmsTabKey =
  | "dashboard" | "receiving" | "returnReceive" | "supplierReturn" | "salesReturn"
  | "iqc" | "iqcClosedLoop" | "iqcDefectLoop" | "iqcInspectionLevels" | "iqcInspect" | "iqcReport" | "iqcStandards" | "supplierKpi" | "supplierManagement" | "qualityTrend"
  | "poReceipt" | "lineReturn" | "subcontractReturn" | "mrbReworkReturn" | "qrBinding" | "iqcPassMaintenance" | "defectArchive" | "mrbApproval" | "scrapFinanceApproval" | "reworkComplete" | "iqcReinspection"
  | "putaway" | "inventory" | "picking" | "issue" | "materialDistribution" | "woHandover"
  | "cycleCount" | "transferAdjust" | "expiryControl" | "fifoMonitor" | "fifoSimulation"
  | "transactions" | "materialConsumption" | "traceability" | "materialTrace" | "wms3dFlow" | "inventoryControl"
  | "msd" | "solderPaste" | "auxiliary"
  | "collaboration" | "closure"
  | "smartShelf"
  | "shelfApi"
  | "shelfSim"
  | "shelfSim3d"
  | "shelfOps"
  | "rackSim"
  | "smartRack"
  | "smartRackWorkflow"
  | "sqlConsole"
  | "lifecycle"
  | "basicData"
  | "qualityDashboard"
  | "oqc"
  | "ngManagement"
  | "eightD" | "materialMaster" | "materialBarcodeLoop" | "locationManagement" | "batchManagement"
  | "incoming" | "materialReceiving" | "materialLoading" | "smtClosedLoop" | "nonSmtClosedLoop" | "nonIqcClosedLoop" | "finishedGoods"
  | "pdaReceiving" | "pdaReceivingMobile" | "pdaConsumption" | "pdaMsd" | "pdaCycleCount" | "pdaIqc" | "pdaHistory"
  | "productionInbound" | "productionOutbound"
  | "inboundOrders" | "outboundOrders" | "requisitions" | "returnSlips" | "replenishments" | "syncHealth"
  | "rjvnData" | "rjvnIqc" | "rjvnReceipt" | "rjvnInventory" | "rjvnPicking" | "rjvnDocFlow" | "rjvnCanonical" | "rjvnClassic"
  | "slips"
  | "overPicking"
  | "rework"
  | "supplierDebt"
  | "defectiveMove"
  | "mrb"
  | "supplierReturnOrder"
  | "iqcTemplates"
  | "graftOps"
  | "substitution"
  | "notices"
  | "mesSync";

export const wmsTabKeys: WmsTabKey[] = [
  "dashboard",
  "receiving", "returnReceive", "supplierReturn", "salesReturn",
  "iqc", "iqcClosedLoop", "iqcDefectLoop", "iqcInspectionLevels", "iqcInspect", "iqcReport", "iqcStandards", "supplierKpi", "supplierManagement", "qualityTrend",
  "poReceipt", "lineReturn", "subcontractReturn", "mrbReworkReturn", "qrBinding", "iqcPassMaintenance", "defectArchive", "mrbApproval", "scrapFinanceApproval", "reworkComplete", "iqcReinspection",
  "putaway", "inventory", "picking", "issue", "materialDistribution",
  "cycleCount", "transferAdjust", "expiryControl", "fifoMonitor", "fifoSimulation",
  "transactions", "materialConsumption", "traceability", "materialTrace", "wms3dFlow", "inventoryControl",
  "msd", "solderPaste", "auxiliary",
  "collaboration", "closure",
  "smartShelf",
  "shelfApi",
  "shelfSim",
  "shelfSim3d",
  "shelfOps",
  "rackSim",
  "smartRack",
  "smartRackWorkflow",
  "sqlConsole",
  "lifecycle",
  "basicData", "materialMaster", "materialBarcodeLoop", "locationManagement", "batchManagement",
  "incoming", "materialReceiving", "materialLoading", "smtClosedLoop", "nonSmtClosedLoop", "nonIqcClosedLoop", "finishedGoods", "pdaReceiving", "pdaReceivingMobile", "pdaConsumption", "pdaMsd", "pdaIqc", "rework", "supplierDebt", "defectiveMove", "pdaHistory",
  "inboundOrders", "outboundOrders", "requisitions", "returnSlips", "replenishments", "syncHealth",
  "productionInbound", "productionOutbound",
  "rjvnData", "rjvnIqc", "rjvnReceipt", "rjvnInventory", "rjvnPicking", "rjvnDocFlow", "rjvnCanonical", "rjvnClassic",
  "slips",
  "overPicking",
  "mrb",
  "supplierReturnOrder",
  "iqcTemplates",
  "graftOps",
  "substitution",
  "notices",
  "mesSync",
];

export type WmsMenuGroupKey =
  | "overview" | "warehouse" | "receivingManagement" | "iqcManagement" | "collaborationManagement" | "specialMaterials"
  | "traceability" | "msd" | "quality" | "issuingManagement" | "returnsRework" | "basicData" | "devices";

export interface WmsMenuGroup {
  key: WmsMenuGroupKey;
  translationKey: string;
  tabs: WmsTabKey[];
}

// Canonical operator menu from WMS菜单界面.xlsx. Engineering/test utilities
// remain routable for maintainers but are intentionally absent here.
// 运营菜单按「货往哪走」排：首页 → 收货入库 → IQC → 库内 → 领料发料 → 退货返工 → 特殊物料 → 追溯 → 基础资料 → 质量 → 设备协同。
// 原 WMS 的 62 个菜单在图里都能找到落点（docs/wms-menu-map-2026-11-20.md）。
// 联调/测试类（shelfApi、shelfSim、sqlConsole）仍可按 URL 打开，不进运营菜单。
export const wmsMenuGroups: WmsMenuGroup[] = [
  { key: "overview", translationKey: "wms.group.overview", tabs: [
    "dashboard", "closure", "rjvnClassic", "rjvnData", "rjvnCanonical", "notices",
  ] },
  { key: "receivingManagement", translationKey: "wms.group.receiving", tabs: [
    "materialReceiving", "receiving", "returnReceive", "pdaReceiving", "pdaReceivingMobile",
    "inboundOrders", "poReceipt", "putaway", "qrBinding", "materialLoading", "syncHealth",
  ] },
  { key: "iqcManagement", translationKey: "wms.group.iqc", tabs: [
    "iqc", "iqcInspect", "iqcInspectionLevels", "iqcClosedLoop", "iqcDefectLoop",
    "iqcReport", "iqcStandards", "iqcTemplates", "iqcPassMaintenance", "defectArchive",
    "iqcReinspection", "pdaIqc", "rjvnIqc", "qualityTrend", "graftOps",
  ] },
  { key: "warehouse", translationKey: "wms.group.warehouse", tabs: [
    "inventory", "inventoryControl", "rjvnInventory", "cycleCount", "transferAdjust",
    "expiryControl", "lifecycle", "fifoMonitor", "fifoSimulation", "defectiveMove",
    "transactions", "batchManagement", "locationManagement",
  ] },
  { key: "issuingManagement", translationKey: "wms.group.issuing", tabs: [
    "picking", "issue", "requisitions", "slips", "materialDistribution", "woHandover",
    "outboundOrders", "returnSlips", "replenishments", "overPicking",
    "pdaConsumption", "rjvnPicking", "rjvnDocFlow", "productionInbound", "productionOutbound",
    "materialConsumption", "smtClosedLoop", "nonSmtClosedLoop", "nonIqcClosedLoop",
    "mesSync",
  ] },
  { key: "returnsRework", translationKey: "wms.group.returns", tabs: [
    "supplierReturn", "supplierReturnOrder", "salesReturn", "lineReturn", "rework", "reworkComplete",
    "mrb", "mrbApproval", "mrbReworkReturn", "subcontractReturn", "scrapFinanceApproval",
    "supplierDebt",
  ] },
  { key: "specialMaterials", translationKey: "wms.group.special", tabs: [
    "solderPaste", "auxiliary", "msd", "pdaMsd",
  ] },
  { key: "traceability", translationKey: "wms.group.traceability", tabs: [
    "traceability", "materialTrace", "wms3dFlow",
  ] },
  { key: "basicData", translationKey: "wms.group.basicData", tabs: [
    "materialMaster", "materialBarcodeLoop", "substitution", "supplierManagement",
    "supplierKpi", "basicData", "incoming",
  ] },
  { key: "quality", translationKey: "wms.group.quality", tabs: [
    "qualityDashboard", "oqc", "ngManagement", "eightD",
  ] },
  { key: "devices", translationKey: "wms.group.devices", tabs: [
    "smartRack", "smartShelf", "shelfOps", "rackSim", "smartRackWorkflow",
    "pdaCycleCount", "pdaHistory", "collaboration",
  ] },
];

export const wmsTabTranslationKeys: Record<WmsTabKey, string> = {
  rjvnData: "wms.rjvn.title",
  rjvnIqc: "wms.rjvnIqc.title",
  rjvnReceipt: "wms.rjvnReceipt.title",
  rjvnInventory: "wms.rjvnInventory.title",
  rjvnPicking: "wms.rjvnPicking.title",
  rjvnDocFlow: "wms.rjvnDoc.title",
  rjvnCanonical: "wms.canonical.title",
  rjvnClassic: "wms.orig.nav.systemTitle",
  dashboard: "wms.subnav.dashboard",
  receiving: "wms.subnav.receiving",
  returnReceive: "wms.subnav.returnReceive",
  supplierReturn: "wms.subnav.supplierReturn",
  salesReturn: "wms.subnav.salesReturn",
  incoming: "wms.subnav.incoming",
  materialReceiving: "wms.subnav.incoming",
  materialLoading: "wms.subnav.materialLoading",
  smtClosedLoop: "wms.subnav.smtClosedLoop",
  nonSmtClosedLoop: "wms.subnav.nonSmtClosedLoop",
  nonIqcClosedLoop: "wms.subnav.nonIqcClosedLoop",
  finishedGoods: "wms.subnav.finishedGoods",
  iqc: "wms.subnav.iqc",
  iqcClosedLoop: "wms.subnav.iqcClosedLoop",
  iqcDefectLoop: "wms.subnav.iqcDefectLoop",
  iqcInspectionLevels: "wms.subnav.iqcInspectionLevels",
  poReceipt: "wms.subnav.poReceipt",
  lineReturn: "wms.subnav.lineReturn",
  subcontractReturn: "wms.subnav.subcontractReturn",
  mrbReworkReturn: "wms.subnav.mrbReworkReturn",
  qrBinding: "wms.subnav.qrBinding",
  iqcPassMaintenance: "wms.subnav.iqcPassMaintenance",
  defectArchive: "wms.subnav.defectArchive",
  mrbApproval: "wms.subnav.mrbApproval",
  scrapFinanceApproval: "wms.subnav.scrapFinanceApproval",
  reworkComplete: "wms.subnav.reworkComplete",
  iqcReinspection: "wms.subnav.iqcReinspection",
  iqcInspect: "wms.subnav.iqcInspect",
  iqcReport: "wms.subnav.iqcReport",
  iqcStandards: "wms.subnav.iqcStandards",
  pdaReceiving: "wms.subnav.pdaReceiving",
  pdaReceivingMobile: "wms.subnav.pdaReceivingMobile",
  pdaConsumption: "wms.subnav.issue",
  pdaMsd: "wms.subnav.msd",
  pdaCycleCount: "wms.subnav.pdaCycleCount",
  pdaIqc: "wms.subnav.pdaIqc",
  pdaHistory: "wms.subnav.pdaHistory",
  supplierKpi: "wms.subnav.supplierKpi",
  supplierManagement: "wms.subnav.supplierManagement",
  qualityTrend: "wms.subnav.qualityTrend",
  putaway: "wms.subnav.putaway",
  inventory: "wms.subnav.inventory",
  picking: "wms.subnav.picking",
  issue: "wms.subnav.issue",
  woHandover: "wms.subnav.woHandover",
  slips: "wms.subnav.slips",
  materialDistribution: "wms.subnav.materialDistribution",
  cycleCount: "wms.subnav.cycleCount",
  transferAdjust: "wms.subnav.transferAdjust",
  expiryControl: "wms.subnav.expiryControl",
  fifoMonitor: "wms.subnav.fifoMonitor",
  fifoSimulation: "wms.subnav.fifoSimulation",
  transactions: "wms.subnav.transactions",
  materialConsumption: "wms.subnav.materialConsumption",
  traceability: "wms.subnav.traceability",
  materialTrace: "wms.subnav.materialTrace",
  wms3dFlow: "wms.subnav.wms3dFlow",
  inventoryControl: "wms.subnav.inventoryControl",
  msd: "wms.subnav.msd",
  solderPaste: "wms.subnav.solderPaste",
  auxiliary: "wms.subnav.auxiliary",
  collaboration: "wms.subnav.collaboration",
  closure: "wms.subnav.closure",
  smartShelf: "wms.subnav.smartShelf",
  shelfApi: "wms.subnav.shelfApi",
  shelfSim: "wms.subnav.shelfSim",
  shelfSim3d: "wms.subnav.shelfSim3d",
  shelfOps: "wms.subnav.shelfOps",
  rackSim: "wms.subnav.rackSim",
  smartRack: "wms.subnav.smartRack",
  smartRackWorkflow: "wms.subnav.smartRackWorkflow",
  sqlConsole: "wms.subnav.sqlConsole",
  lifecycle: "wms.subnav.lifecycle",
  basicData: "wms.subnav.basicData",
  qualityDashboard: "wms.subnav.qualityDashboard",
  oqc: "wms.subnav.oqc",
  ngManagement: "wms.subnav.ngManagement",
  eightD: "wms.subnav.eightD",
  materialMaster: "wms.subnav.materialMaster",
  materialBarcodeLoop: "wms.subnav.materialBarcodeLoop",
  locationManagement: "wms.subnav.locationManagement",
  batchManagement: "wms.subnav.batchManagement",
  inboundOrders: "wms.subnav.inboundOrders",
  outboundOrders: "wms.subnav.outboundOrders",
  requisitions: "wms.subnav.requisitions",
  returnSlips: "wms.subnav.returnSlips",
  replenishments: "wms.subnav.replenishments",
  syncHealth: "wms.subnav.syncHealth",
  productionInbound: "wms.subnav.productionInbound",
  productionOutbound: "wms.subnav.productionOutbound",
  overPicking: "wms.subnav.overPicking",
  rework: "wms.subnav.rework",
  supplierDebt: "wms.subnav.supplierDebt",
  defectiveMove: "wms.subnav.defectiveMove",
  mrb: "wms.subnav.mrb",
  supplierReturnOrder: "wms.subnav.supplierReturnOrder",
  iqcTemplates: "wms.subnav.iqcTemplates",
  graftOps: "wms.subnav.graftOps",
  substitution: "wms.subnav.substitution",
  notices: "wms.subnav.notices",
  mesSync: "wms.subnav.mesSync",
};

export { WmsIncoming } from "./WmsIncoming";
export { WmsSupplierLabel } from "./WmsSupplierLabel";
export { WmsMaterialReceiving } from "./WmsMaterialReceiving";
export { WmsMaterialLoading } from "./WmsMaterialLoading";
export { WmsSmtClosedLoop } from "./WmsSmtClosedLoop";
export { WmsNonSmtClosedLoop } from "./WmsNonSmtClosedLoop";
export { WmsNonIqcClosedLoop } from "./WmsNonIqcClosedLoop";
export { WmsFinishedGoods } from "./WmsFinishedGoods";
export { WmsDashboard } from "./WmsDashboard";
export { WmsReceiving } from "./WmsReceiving";
export { WmsIqc } from "./WmsIqc";
export { WmsRjvnData } from "./WmsRjvnData";
export { WmsRjvnIqc } from "./WmsRjvnIqc";
export { WmsRjvnReceipt } from "./WmsRjvnReceipt";
export { WmsRjvnInventory } from "./WmsRjvnInventory";
export { WmsRjvnPicking } from "./WmsRjvnPicking";
export { WmsRjvnDocFlow } from "./WmsRjvnDocFlow";
export { WmsCanonicalData } from "./WmsCanonicalData";
export { WmsRjvnClassic } from "./WmsRjvnClassic";
export { WmsIqcClosedLoop } from "./WmsIqcClosedLoop";
export { WmsIqcDefectLoop } from "./WmsIqcDefectLoop";
export { WmsIqcInspectionLevels } from "./WmsIqcInspectionLevels";
export { WmsIqcFlowPages } from "./WmsIqcFlowPages";
export { WmsPutAway } from "./WmsPutAway";
export { WmsInventory } from "./WmsInventory";
export { WmsPicking } from "./WmsPicking";
export { WmsIssue } from "./WmsIssue";
export { WmsWoHandover } from "./WmsWoHandover";
export { WmsSlips } from "./WmsSlips";
export { WmsPdaConsumption } from "./WmsPdaConsumption";
export { WmsTransactions } from "./WmsTransactions";
export { WmsSmartShelfTester } from "./WmsSmartShelfTester";
export { WmsShelfApiTester } from "./WmsShelfApiTester";
export { WmsShelfSimulator } from "./WmsShelfSimulator";
export { default as WmsShelfOperations } from "./WmsShelfOperations";
export { WmsSqlConsole } from "./WmsSqlConsole";
export { WmsRackSimulator } from "./WmsRackSimulator";
export { WmsSmartRackManager } from "./WmsSmartRackManager";
export { SmartRackWorkflow } from "./SmartRackWorkflow";
export { WmsMaterialMaster } from "./WmsMaterialMaster";
export { WmsLocationManagement } from "./WmsLocationManagement";
export { WmsReturnReceiving } from "./WmsReturnReceiving";
export { WmsSupplierReturn } from "./WmsSupplierReturn";
export { WmsCycleCount } from "./WmsCycleCount";
export { WmsLifecycleDashboard } from "./WmsLifecycleDashboard";
export { WmsLifecycleAlerts } from "./WmsLifecycleAlerts";
export { WmsLifecycleReinspection } from "./WmsLifecycleReinspection";
export { WmsLifecycleOpenings } from "./WmsLifecycleOpenings";
export { WmsLifecycleScrapping } from "./WmsLifecycleScrapping";
export { WmsLifecycleExempt } from "./WmsLifecycleExempt";
export { WmsFifoSimulation } from "./WmsFifoSimulation";
export { WmsPdaReceiving } from "./WmsPdaReceiving";
export { WmsPdaReceivingMobile } from "./WmsPdaReceivingMobile";
export { WmsPdaCycleCount } from "./WmsPdaCycleCount";
export { WmsPdaIqc } from "./WmsPdaIqc";
export { WmsPdaHistory } from "./WmsPdaHistory";
export { WmsSalesReturn } from "./WmsSalesReturn";
export { WmsIqcInspection } from "./WmsIqcInspection";
export { WmsIqcReport } from "./WmsIqcReport";
export { WmsIqcStandards } from "./WmsIqcStandards";
export { WmsSupplierKpi } from "./WmsSupplierKpi";
export { WmsQualityTrend } from "./WmsQualityTrend";
export { WmsTransferAdjust } from "./WmsTransferAdjust";
export { WmsExpiryControl } from "./WmsExpiryControl";
export { WmsFifoMonitor } from "./WmsFifoMonitor";
export { WmsTraceability } from "./WmsTraceability";
export { WmsMaterialConsumption } from "./WmsMaterialConsumption";
export { WmsMaterialDistribution } from "./WmsMaterialDistribution";
export { WmsMaterialTraceRoute } from "./WmsMaterialTraceRoute";
export { Wms3dFlow } from "./Wms3dFlow";
export { WmsInventoryControlCenter } from "./WmsInventoryControlCenter";
export { WmsMsd } from "./WmsMsd";
export { WmsSolderPaste } from "./WmsSolderPaste";
export { WmsAuxiliary } from "./WmsAuxiliary";
export { WmsCollaborationDashboard } from "./WmsCollaborationDashboard";
export { WmsClosureDashboard } from "./WmsClosureDashboard";
export { WmsInboundOrders } from "./WmsInboundOrders";
export { WmsOutboundOrders } from "./WmsOutboundOrders";
export { WmsRequisitions } from "./WmsRequisitions";
export { WmsReturnSlips } from "./WmsReturnSlips";
export { WmsReplenishments } from "./WmsReplenishments";
export { WmsSyncHealth } from "./WmsSyncHealth";
export { WmsBatchManagement } from "./WmsBatchManagement";
export { WmsMenuPage } from "./WmsMenuPage";

export { WmsBasicData } from "./WmsBasicData";
export { WmsMaterialBarcodeLoop } from "./WmsMaterialBarcodeLoop";
export { WmsProductionInbound } from "./WmsProductionInbound";
export { WmsProductionOutbound } from "./WmsProductionOutbound";
export { WmsSupplierManagement } from "./WmsSupplierManagement";
export { WmsQualityDashboard } from "./WmsQualityDashboard";
export { WmsOqc } from "./WmsOqc";
export { WmsNgManagement } from "./WmsNgManagement";
export { Wms8DReport } from "./Wms8DReport";
export { WmsOverPicking } from "./WmsOverPicking";
export { WmsRework } from "./WmsRework";
export { WmsSupplierDebt } from "./WmsSupplierDebt";
export { WmsDefectiveMove } from "./WmsDefectiveMove";
export { WmsMrb } from "./WmsMrb";
export { WmsSupplierReturnOrder } from "./WmsSupplierReturnOrder";
export { WmsNotices } from "./WmsNotices";
export { WmsMesSync } from "./WmsMesSync";
