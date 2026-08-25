export type MaintenanceTabKey = "dashboard" | "equipment" | "equipmentDetail" | "plan" | "history" | "maintenanceCard" | "inspection" | "inspectionRecords" | "pmSchedule" | "pmExecution" | "faultReport" | "spareParts" | "supplierComms" | "checklists" | "workOrders" | "consumables" | "fixtures" | "andon" | "health" | "pda" | "import" | "reports" | "factory3d" | "carousel" | "bom";

export const maintenanceTabKeys: MaintenanceTabKey[] = ["dashboard", "equipment", "equipmentDetail", "plan", "workOrders", "consumables", "fixtures", "spareParts", "history", "maintenanceCard", "inspection", "inspectionRecords", "pmSchedule", "pmExecution", "faultReport", "supplierComms", "checklists", "andon", "health", "pda", "import", "reports", "factory3d", "carousel", "bom"];

export const maintenanceTabTranslationKeys: Record<MaintenanceTabKey, string> = {
  dashboard: "maintenance.subnav.dashboard",
  equipment: "maintenance.subnav.equipment",
  equipmentDetail: "maintenance.subnav.equipmentDetail",
  plan: "maintenance.subnav.plan",
  history: "maintenance.subnav.history",
  maintenanceCard: "maintenance.subnav.maintenanceCard",
  inspection: "maintenance.subnav.inspection",
  inspectionRecords: "maintenance.subnav.inspectionRecords",
  pmSchedule: "pm.schedule",
  pmExecution: "pm.execution",
  faultReport: "maintenance.subnav.faultReport",
  spareParts: "maintenance.subnav.spareParts",
  supplierComms: "maintenance.subnav.supplierComms",
  checklists: "maintenance.subnav.checklists",
  workOrders: "maintenance.subnav.workOrders",
  consumables: "maintenance.subnav.consumables",
  fixtures: "maintenance.subnav.fixtures",
  andon: "maintenance.subnav.andon",
  health: "maintenance.subnav.health",
  pda: "maintenance.subnav.pda",
  import: "maintenance.subnav.import",
  reports: "maintenance.subnav.reports",
  factory3d: "maintenance.subnav.factory3d",
  carousel: "maintenance.subnav.carousel",
  bom: "maintenance.subnav.bom",
};

export { MaintenanceDashboard } from "./MaintenanceDashboard";
export { MaintenanceEquipmentList } from "./MaintenanceEquipmentList";
export { MaintenanceEquipmentDetail } from "./MaintenanceEquipmentDetail";
export { MaintenancePlan } from "./MaintenancePlan";
export { MaintenanceHistory } from "./MaintenanceHistory";
export { InspectionPlan } from "./InspectionPlan";
export { InspectionRecords } from "./InspectionRecords";
export { PmSchedule } from "./PmSchedule";
export { PmExecution } from "./PmExecution";
export { FaultReportList } from "./FaultReportList";
export { SparePartsWarehouse } from "../spareparts";
export { SupplierComms } from "../spareparts/SupplierComms";
export { EquipmentChecklists } from "./EquipmentChecklists";
export { MaintenanceWorkOrders } from "./MaintenanceWorkOrders";
export { MaintenanceCard } from "./MaintenanceCard";
export { ConsumablesManagement } from "./ConsumablesManagement";
export { FixtureManagement } from "./FixtureManagement";

export { default as AndonBoard } from './AndonBoard';
export { default as EquipmentHealth } from './EquipmentHealth';
export { default as PdaEquipment } from './PdaEquipment';

export { default as ExcelImport } from './ExcelImport';

export { default as EquipmentReports } from './EquipmentReports';

export { default as Factory3D } from './Factory3D';

export { default as DashboardCarousel } from './DashboardCarousel';
export { default as EquipmentBom } from './EquipmentBom';
export { default as EmergencyManagement } from './EmergencyManagement';
