export type PmcTabKey =
  | "dashboard" | "workOrders" | "workOrderDetail" | "createWorkOrder"
  | "productionReporting" | "materialIssue" | "wipTracking" | "alertDashboard"
  | "ganttView" | "andonBoard" | "stationCheckin" | "woFreeze" | "woQualityReport"
  | "alertHistory" | "ngReview" | "compensationApproval"
  | "poList" | "masterData" | "materialStatus" | "supplementaryMaterial" | "bom" | "patrolDashboard" | "deliveryWatch" | "closedLoop" | "mobile";

export type BomTabKey = "bomList" | "bomChangeControl" | "bomHistory" | "bomPatrol" | "bomAlerts" | "bomAiChat";
export const bomTabKeys: BomTabKey[] = ["bomList", "bomChangeControl", "bomHistory", "bomPatrol", "bomAlerts", "bomAiChat"];
export const bomTabTranslationKeys: Record<BomTabKey, string> = {
  bomList: "bom.tab.list",
  bomChangeControl: "bom.tab.changeControl",
  bomHistory: "bom.tab.history",
  bomPatrol: "bom.tab.patrol",
  bomAlerts: "bom.tab.alerts",
  bomAiChat: "bom.tab.aiChat",
};

export const pmcTabKeys: PmcTabKey[] = [
  "dashboard",
  "workOrders", "workOrderDetail", "createWorkOrder",
  "productionReporting", "materialIssue", "wipTracking", "alertDashboard",
  "ganttView", "andonBoard", "stationCheckin", "woFreeze", "woQualityReport",
  "alertHistory", "ngReview", "compensationApproval",
  "poList", "masterData", "materialStatus", "supplementaryMaterial",
  "bom",
  "patrolDashboard", "deliveryWatch",
  "closedLoop", "mobile",
];

export const pmcTabTranslationKeys: Record<PmcTabKey, string> = {
  dashboard: "pmc.subnav.dashboard",
  workOrders: "pmc.subnav.workOrders",
  workOrderDetail: "pmc.subnav.workOrderDetail",
  createWorkOrder: "pmc.subnav.createWorkOrder",
  productionReporting: "pmc.subnav.productionReporting",
  materialIssue: "pmc.subnav.materialIssue",
  wipTracking: "pmc.subnav.wipTracking",
  alertDashboard: "pmc.subnav.alertDashboard",
  ganttView: "pmc.subnav.ganttView",
  andonBoard: "pmc.subnav.andonBoard",
  stationCheckin: "pmc.subnav.stationCheckin",
  woFreeze: "pmc.subnav.woFreeze",
  woQualityReport: "pmc.subnav.woQualityReport",
  alertHistory: "pmc.subnav.alertHistory",
  ngReview: "pmc.subnav.ngReview",
  compensationApproval: "pmc.subnav.compensationApproval",
  poList: "pmc.subnav.poList",
  masterData: "pmc.subnav.masterData",
  materialStatus: "pmc.subnav.materialStatus",
  supplementaryMaterial: "pmc.subnav.supplementaryMaterial",
  bom: "pmc.subnav.bom",
  patrolDashboard: "pmc.subnav.patrolDashboard",
  deliveryWatch: "pmc.subnav.deliveryWatch",
  closedLoop: "pmc.subnav.closedLoop",
  mobile: "pmc.subnav.mobile",
};

export { PmcDashboard } from "./PmcDashboard";
export { PmcWorkOrderList } from "./PmcWorkOrderList";
export { PmcWorkOrderDetail } from "./PmcWorkOrderDetail";
export { PmcCreateWorkOrder } from "./PmcCreateWorkOrder";
export { PmcProductionReporting } from "./PmcProductionReporting";
export { PmcMaterialIssue } from "./PmcMaterialIssue";
export { PmcWipTracking } from "./PmcWipTracking";
export { PmcAlertDashboard } from "./PmcAlertDashboard";
export { PmcGanttView } from "./PmcGanttView";
export { PmcAndonBoard } from "./PmcAndonBoard";
export { PmcStationCheckin } from "./PmcStationCheckin";
export { PmcWoFreeze } from "./PmcWoFreeze";
export { PmcWoQualityReport } from "./PmcWoQualityReport";
export { PmcNgReview } from "./PmcNgReview";
export { PmcCompensationApproval } from "./PmcCompensationApproval";
export { PmcAlertHistory } from "./PmcAlertHistory";
export { PmcPoList } from "./PmcPoList";
export { PmcCustomerProductMaster } from "./PmcCustomerProductMaster";
export { PmcMaterialStatus } from "./PmcMaterialStatus";
export { PmcSupplementaryMaterial } from "./PmcSupplementaryMaterial";
export { BomList } from "./BomList";
export { BomHistory } from "./BomHistory";
export { BomPatrol } from "./BomPatrol";
export { BomAlerts } from "./BomAlerts";
export { BomAiChat } from "./BomAiChat";
export { BomChangeControl } from "./BomChangeControl";
export { PmcPatrolDashboard } from "./PmcPatrolDashboard";
export { PmcDeliveryWatch } from "./PmcDeliveryWatch";
export { PmcClosedLoop } from "./PmcClosedLoop";
