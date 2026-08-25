export type MesTabKey =
  | "smtExemptions"
  | "overview"
  | "dashboard"
  | "processFlow"
  | "stationWorkflow"
  | "stationType"
  | "stationMaster"
  | "processDoc"
  | "processManagement"
  | "foolProof"
  | "firstArticle"
  | "materialVerify"
  | "materialLoad"
  | "dispatchBoard"
  | "retestRules"
  | "timeControl"
  | "stagnation"
  | "scrap"
  | "trace"
  | "stationOperator"
  | "repair"
  | "ictMonitor"
  | "productionLine"
  | "manualLine"
  | "manualLine3d"
  | "autoLine"
  | "autoLine3d"
  | "warehouseStorage"
  | "rework"
  | "ngRevival"
  | "ngTracking"
  | "ngRouting"
  | "ngManagement"
  | "ngClosedLoop"
  | "passShortage"
  | "packagingBoxes"
  | "qrWorkOrders"
  | "pdaLoad"
  | "smtLoader"
  | "managerConsole"
  | "journey"
  | "bomReconciliation"
  | "pdaDevice"    // PDA 设备资产管理
  | "pdaScan"      // PDA 统一扫码上料
  | "pdaOnline"   // PDA 在线监控
  | "materialRollQr"
  | "smtMaterialBindings"
  | "smtLoading3d"
  | "tooljetSmtLoading";

// SMT exception authorization is a dedicated MES material-control page.
export const mesTabKeys: MesTabKey[] = [
  "overview",
  "managerConsole",
  "dashboard",
  "processFlow",
  "stationWorkflow",
  "stationType",
  "stationMaster",
  "processDoc",
  "processManagement",
  "foolProof",
  "firstArticle",
  "materialVerify",
  "materialLoad",
  "dispatchBoard",
  "retestRules",
  "timeControl",
  "stagnation",
  "scrap",
  "trace",
  "stationOperator",
  "repair",
  "ictMonitor",
  "productionLine",
  "manualLine",
  "manualLine3d",
  "autoLine",
  "autoLine3d",
  "warehouseStorage",
  "rework",
  "ngRevival",
  "ngTracking",
  "ngRouting",
  "ngManagement",
  "ngClosedLoop",
  "passShortage",
  "packagingBoxes",
  "qrWorkOrders",
  "pdaLoad",
  "smtLoader",
  "journey",
  "bomReconciliation",
  "pdaDevice",
  "pdaScan",
  "pdaOnline",
  "materialRollQr",
  "smtMaterialBindings",
  "smtLoading3d",
  "tooljetSmtLoading",
  "smtExemptions",
];

export const mesTabTranslationKeys: Record<MesTabKey, string> = {
  overview: "mes.subnav.overview",
  managerConsole: "mes.subnav.managerConsole",
  dashboard: "mes.scanReady",
  processFlow: "mes.subnav.processFlow",
  stationWorkflow: "mes.subnav.stationWorkflow",
  stationType: "mes.subnav.stationType",
  stationMaster: "mes.subnav.stationMaster",
  processDoc: "mes.subnav.processDoc",
  processManagement: "mes.subnav.processManagement",
  foolProof: "mes.subnav.foolProof",
  firstArticle: "mes.subnav.firstArticle",
  materialVerify: "mes.subnav.materialVerify",
  materialLoad: "mes.materialLoad.title",
  dispatchBoard: "mes.dispatchBoard.title",
  retestRules: "mes.subnav.retestRules",
  timeControl: "mes.subnav.timeControl",
  stagnation: "mes.subnav.stagnation",
  scrap: "mes.subnav.scrap",
  trace: "mes.subnav.trace",
  stationOperator: "mes.subnav.stationOperator",
  repair: "mes.subnav.repair",
  ictMonitor: "mes.subnav.ictMonitor",
  productionLine: "mes.subnav.productionLine",
  manualLine: "mes.subnav.manualLine",
  manualLine3d: "mes.subnav.manualLine3d",
  autoLine: "mes.subnav.autoLine",
  autoLine3d: "mes.subnav.autoLine3d",
  warehouseStorage: "mes.subnav.warehouseStorage",
  rework: "mes.subnav.rework",
  ngRevival: "mes.subnav.ngRevival",
  ngTracking: "mes.subnav.ngTracking",
  ngRouting: "mes.subnav.ngRouting",
  ngManagement: "mes.subnav.ngManagement",
  ngClosedLoop: "mes.subnav.ngManagement",
  passShortage: "mes.subnav.passShortage",
  packagingBoxes: "mes.subnav.packagingBoxes",
  qrWorkOrders: "mes.subnav.qrWorkOrders",
  pdaLoad: "mes.pdaLoad.title",
  pdaDevice: "PDA设备管理",
  pdaScan: "PDA统一扫码",
  pdaOnline: "PDA在线监控",
  materialRollQr: "MES料卷二维码",
  smtMaterialBindings: "SMT物料绑定表",
  smtLoading3d: "SMT上料3D模拟",
  tooljetSmtLoading: "mes.tooljetSmtLoading.title",
  smtLoader: "SMT上料监控",
  journey: "mes.subnav.journey",
  bomReconciliation: "mes.subnav.bomReconciliation",
  smtExemptions: "mes.smtExemption.title",
};

export type MesGroupKey =
  | "productOverview"
  | "productExecution"
  | "productMaterial"
  | "productPackaging"
  | "productTraceability"
  | "productDigitalTwin"
  | "productConfiguration"
  | "ngDetection"
  | "ngRepair"
  | "ngDisposition";

export type MesThemeKey = "product" | "ng";

export const mesGroups: Array<{ key: MesGroupKey; theme: MesThemeKey; labelKey: string; tabs: MesTabKey[] }> = [
  { key: "productOverview", theme: "product", labelKey: "mes.group.overview", tabs: ["overview", "managerConsole", "dashboard"] },
  { key: "productExecution", theme: "product", labelKey: "mes.group.execution", tabs: ["productionLine", "manualLine", "autoLine", "stationOperator", "processFlow", "stationWorkflow"] },
  { key: "productMaterial", theme: "product", labelKey: "mes.group.material", tabs: ["materialVerify", "materialLoad", "smtMaterialBindings", "materialRollQr", "smtLoading3d", "tooljetSmtLoading", "dispatchBoard", "smtLoader", "pdaLoad", "pdaDevice", "pdaScan", "pdaOnline", "smtExemptions"] },
  { key: "productPackaging", theme: "product", labelKey: "mes.group.packaging", tabs: ["packagingBoxes", "qrWorkOrders"] },
  { key: "productTraceability", theme: "product", labelKey: "mes.group.traceability", tabs: ["trace", "journey", "bomReconciliation"] },
  { key: "productDigitalTwin", theme: "product", labelKey: "mes.group.digitalTwin", tabs: ["manualLine3d", "autoLine3d", "warehouseStorage", "ictMonitor"] },
  { key: "productConfiguration", theme: "product", labelKey: "mes.group.configuration", tabs: ["stationType", "stationMaster", "processDoc", "processManagement", "timeControl"] },
  { key: "ngDetection", theme: "ng", labelKey: "mes.group.ngDetection", tabs: ["ngTracking", "firstArticle", "foolProof"] },
  { key: "ngRepair", theme: "ng", labelKey: "mes.group.ngRepair", tabs: ["ngManagement", "ngClosedLoop", "ngRouting", "repair", "rework", "ngRevival", "retestRules"] },
  { key: "ngDisposition", theme: "ng", labelKey: "mes.group.ngDisposition", tabs: ["stagnation", "passShortage", "scrap"] },
];

export const mesThemes: Array<{ key: MesThemeKey; labelKey: string }> = [
  { key: "product", labelKey: "mes.theme.product" },
  { key: "ng", labelKey: "mes.theme.ng" },
];

export type MesContribution = {
  product: 1 | 2 | 3 | 4 | 5;
  ng: 1 | 2 | 3 | 4 | 5;
  rationaleKey: string;
};

const productCore = new Set<MesTabKey>([
  "overview", "dashboard", "productionLine", "manualLine", "autoLine", "stationOperator",
  "processFlow", "stationWorkflow", "trace", "journey", "bomReconciliation", "packagingBoxes", "qrWorkOrders",
]);
const ngCore = new Set<MesTabKey>(["ngTracking", "ngRouting", "ngManagement", "repair", "rework", "ngRevival", "retestRules", "scrap"]);
const ngPrevention = new Set<MesTabKey>(["firstArticle", "foolProof", "stagnation", "passShortage"]);
const materialSupport = new Set<MesTabKey>(["materialVerify", "materialLoad", "smtMaterialBindings", "materialRollQr", "smtLoading3d", "tooljetSmtLoading", "dispatchBoard", "smtLoader", "pdaLoad", "pdaDevice", "pdaScan", "pdaOnline"]);
const digitalTwinSupport = new Set<MesTabKey>(["manualLine3d", "autoLine3d", "warehouseStorage", "ictMonitor"]);

export function getMesContribution(tab: MesTabKey): MesContribution {
  if (ngCore.has(tab)) return { product: 4, ng: 5, rationaleKey: "mes.contribution.reason.ngClosure" };
  if (ngPrevention.has(tab)) return { product: 4, ng: 4, rationaleKey: "mes.contribution.reason.ngPrevention" };
  if (productCore.has(tab)) return { product: 5, ng: 3, rationaleKey: "mes.contribution.reason.productCore" };
  if (materialSupport.has(tab)) return { product: 4, ng: 2, rationaleKey: "mes.contribution.reason.material" };
  if (digitalTwinSupport.has(tab)) return { product: 2, ng: 2, rationaleKey: "mes.contribution.reason.projection" };
  return { product: 3, ng: 3, rationaleKey: "mes.contribution.reason.governance" };
}

export { NgManagementPage } from "./NgManagementPage";
export { NgClosedLoopBoard } from "./NgClosedLoopBoard";
export { ProcessFlow } from "./ProcessFlow";
export { StationWorkflow } from "./StationWorkflow";
export { ProcessDocumentation } from "./ProcessDocumentation";
export { ProcessManagement } from "./ProcessManagement";
export { FoolProofRules } from "./FoolProofRules";
export { FirstArticleInspectionPage } from "./FirstArticleInspection";
export { MaterialVerificationPage } from "./MaterialVerification";
export { RetestRules } from "./RetestRules";
export { TimeControl } from "./TimeControl";
export { StagnationTracking } from "./StagnationTracking";
export { ScrapRegistration } from "./ScrapRegistration";
export { TraceabilitySearch } from "./TraceabilitySearch";
export { StationOperator } from "./StationOperator";
export { MaterialLoadingDashboard } from "./MaterialLoadingDashboard";
export { MaterialLoadingWorkflow } from "./MaterialLoadingWorkflow";
export { MaterialDispatchBoard } from "./MaterialDispatchBoard";
export { StationTypeList } from "./StationTypeList";
export { StationMaster } from "./StationMaster";
export { RepairStation } from "./RepairStation";
export { RepairWorkflow } from "./RepairWorkflow";
export { ProductionLineDashboard } from "./ProductionLineDashboard";
export { AutoLineDashboard } from "./AutoLineDashboard";
export { ReworkDashboard } from "./ReworkDashboard";
export { NgRevivalManagement } from "./NgRevivalManagement";
export { NgRealtimeTracking } from "./NgRealtimeTracking";
export { NgRouteConfigurator } from "./NgRouteConfigurator";
export { PassShortageManagement } from "./PassShortageManagement";
export { PackagingBoxManagement } from "./PackagingBoxManagement";
export { QrWorkOrderManagement } from "./QrWorkOrderManagement";
export { PdaLoadDashboard } from "./PdaLoadDashboard";
export { MesManagerConsole } from "./MesManagerConsole";
export { MesOverview } from "./MesOverview";
export { ProductGateManagement } from "./ProductGateManagement";
export { JourneySearch } from "./JourneySearch";
export { BomReconciliation } from "./BomReconciliation";
export { PdaDeviceManagement } from "./PdaDeviceManagement";
export { PdaUnifiedScanning } from "./PdaUnifiedScanning";
export { PdaOnlineMonitor } from "./PdaOnlineMonitor";
export { SmtMaterialExemptions } from "./SmtMaterialExemptions";
export { FeederPreparationMapping } from "./FeederPreparationMapping";
export { MaterialRollQrGenerator } from "./MaterialRollQrGenerator";
export { SmtLoading3dSimulator } from "./SmtLoading3dSimulator";
export { SmtMaterialBindingTable } from "./SmtMaterialBindingTable";
