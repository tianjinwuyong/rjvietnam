export type WmsTabKey =
  | "dashboard" | "receiving" | "returnReceive" | "supplierReturn" | "salesReturn"
  | "iqc" | "iqcClosedLoop" | "iqcDefectLoop" | "iqcInspect" | "iqcReport" | "iqcStandards" | "supplierKpi" | "qualityTrend"
  | "poReceipt" | "lineReturn" | "subcontractReturn" | "mrbReworkReturn" | "qrBinding" | "iqcPassMaintenance" | "defectArchive" | "mrbApproval" | "scrapFinanceApproval" | "reworkComplete" | "iqcReinspection"
  | "putaway" | "inventory" | "picking" | "issue"
  | "cycleCount" | "transferAdjust" | "expiryControl" | "fifoMonitor" | "fifoSimulation"
  | "transactions" | "traceability" | "materialTrace" | "wms3dFlow" | "inventoryControl"
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
  | "inboundOrders" | "outboundOrders" | "requisitions" | "returnSlips" | "replenishments" | "syncHealth";

export const wmsTabKeys: WmsTabKey[] = [
  "dashboard",
  "receiving", "returnReceive", "supplierReturn", "salesReturn",
  "iqc", "iqcClosedLoop", "iqcDefectLoop", "iqcInspect", "iqcReport", "iqcStandards", "supplierKpi", "qualityTrend",
  "poReceipt", "lineReturn", "subcontractReturn", "mrbReworkReturn", "qrBinding", "iqcPassMaintenance", "defectArchive", "mrbApproval", "scrapFinanceApproval", "reworkComplete", "iqcReinspection",
  "putaway", "inventory", "picking", "issue",
  "cycleCount", "transferAdjust", "expiryControl", "fifoMonitor", "fifoSimulation",
  "transactions", "traceability", "materialTrace", "wms3dFlow", "inventoryControl",
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
  "incoming", "materialReceiving", "materialLoading", "smtClosedLoop", "nonSmtClosedLoop", "nonIqcClosedLoop", "finishedGoods", "pdaReceiving", "pdaConsumption", "pdaMsd", "pdaIqc", "pdaHistory",
  "inboundOrders", "outboundOrders", "requisitions", "returnSlips", "replenishments", "syncHealth",
  "productionInbound", "productionOutbound",
];

export type WmsMenuGroupKey =
  | "overview" | "warehouse" | "receivingManagement" | "iqcManagement" | "collaborationManagement" | "specialMaterials"
  | "traceability" | "msd" | "quality";

export interface WmsMenuGroup {
  key: WmsMenuGroupKey;
  translationKey: string;
  tabs: WmsTabKey[];
}

// Canonical operator menu from WMS菜单界面.xlsx. Engineering/test utilities
// remain routable for maintainers but are intentionally absent here.
export const wmsMenuGroups: WmsMenuGroup[] = [
  { key: "overview", translationKey: "wms.group.overview", tabs: ["dashboard", "closure"] },
  { key: "receivingManagement", translationKey: "wms.group.receiving", tabs: ["materialReceiving", "pdaReceiving", "inboundOrders", "iqcClosedLoop", "pdaIqc", "putaway", "locationManagement", "batchManagement", "pdaHistory"] },
  { key: "warehouse", translationKey: "wms.group.warehouse", tabs: [
    "materialMaster", "materialBarcodeLoop", "locationManagement", "batchManagement", "materialLoading", "smtClosedLoop", "nonSmtClosedLoop", "nonIqcClosedLoop",
    "receiving", "inboundOrders", "returnReceive", "putaway",
    "requisitions", "picking", "outboundOrders", "issue", "returnSlips", "replenishments", "pdaMsd",
    "productionInbound", "productionOutbound",
    "inventory", "inventoryControl", "cycleCount", "transactions", "smartRack", "pdaConsumption",
    "transferAdjust", "expiryControl", "fifoMonitor", "fifoSimulation",
    "smartShelf", "shelfApi", "shelfSim", "shelfSim3d", "shelfOps", "rackSim", "smartRackWorkflow",
  ] },
  { key: "iqcManagement", translationKey: "wms.group.iqc", tabs: [
    "poReceipt", "lineReturn", "subcontractReturn", "mrbReworkReturn", "qrBinding", "incoming", "iqc", "iqcPassMaintenance", "defectArchive", "mrbApproval", "scrapFinanceApproval", "reworkComplete", "iqcReinspection", "iqcClosedLoop", "iqcDefectLoop", "iqcInspect", "iqcStandards", "iqcReport", "supplierReturn",
    "salesReturn", "supplierKpi", "qualityTrend", "pdaIqc",
  ] },
  { key: "collaborationManagement", translationKey: "wms.group.collaboration", tabs: ["syncHealth", "pdaCycleCount", "pdaHistory", "collaboration"] },
  { key: "specialMaterials", translationKey: "wms.group.special", tabs: ["lifecycle", "solderPaste", "auxiliary"] },
  { key: "traceability", translationKey: "wms.group.traceability", tabs: ["traceability", "materialTrace", "wms3dFlow"] },
  { key: "quality", translationKey: "wms.group.quality", tabs: ["qualityDashboard", "oqc", "ngManagement", "eightD"] },
  { key: "msd", translationKey: "wms.group.msd", tabs: ["msd"] },
];

export const wmsTabTranslationKeys: Record<WmsTabKey, string> = {
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
  qualityTrend: "wms.subnav.qualityTrend",
  putaway: "wms.subnav.putaway",
  inventory: "wms.subnav.inventory",
  picking: "wms.subnav.picking",
  issue: "wms.subnav.issue",
  cycleCount: "wms.subnav.cycleCount",
  transferAdjust: "wms.subnav.transferAdjust",
  expiryControl: "wms.subnav.expiryControl",
  fifoMonitor: "wms.subnav.fifoMonitor",
  fifoSimulation: "wms.subnav.fifoSimulation",
  transactions: "wms.subnav.transactions",
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
};

export { WmsIncoming } from "./WmsIncoming";
export { WmsMaterialReceiving } from "./WmsMaterialReceiving";
export { WmsMaterialLoading } from "./WmsMaterialLoading";
export { WmsSmtClosedLoop } from "./WmsSmtClosedLoop";
export { WmsNonSmtClosedLoop } from "./WmsNonSmtClosedLoop";
export { WmsNonIqcClosedLoop } from "./WmsNonIqcClosedLoop";
export { WmsFinishedGoods } from "./WmsFinishedGoods";
export { WmsDashboard } from "./WmsDashboard";
export { WmsReceiving } from "./WmsReceiving";
export { WmsIqc } from "./WmsIqc";
export { WmsIqcClosedLoop } from "./WmsIqcClosedLoop";
export { WmsIqcDefectLoop } from "./WmsIqcDefectLoop";
export { WmsIqcFlowPages } from "./WmsIqcFlowPages";
export { WmsPutAway } from "./WmsPutAway";
export { WmsInventory } from "./WmsInventory";
export { WmsPicking } from "./WmsPicking";
export { WmsIssue } from "./WmsIssue";
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
export { WmsQualityDashboard } from "./WmsQualityDashboard";
export { WmsOqc } from "./WmsOqc";
export { WmsNgManagement } from "./WmsNgManagement";
export { Wms8DReport } from "./Wms8DReport";
