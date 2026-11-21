export type ReportPeriod = "daily" | "weekly" | "monthly";

export type ReportTabKey =
  | "dashboard"
  // Production
  | "work-order-progress"
  | "oee-by-line"
  | "defect-analysis"
  // Warehouse
  | "inventory-ledger"
  | "material-movement"
  | "material-balance"
  // Quality
  | "iqc-summary"
  | "delivery-risk"
  | "aoi-yield"
  | "spi-yield"
  | "oqc-summary"
  // HR & Equipment
  | "attendance-summary"
  | "equipment-downtime"
  | "maintenance-summary"
  // Finance
  | "ar-aging"
  | "ap-aging"
  // Memory
  | "memory-query"
  // Flint Demo
  | "ict-flint-demo"
  | "flint-demo"
  // Station Reports
  | "station-reports"
  | "station-charts";

export type ReportDomain =
  | "production"
  | "warehouse"
  | "quality"
  | "hr-equipment"
  | "finance"
  | "memory";

export const reportDomainOf: Record<ReportTabKey, ReportDomain | "dashboard"> = {
  dashboard: "dashboard",
  // Production
  "work-order-progress": "production",
  "oee-by-line": "production",
  "defect-analysis": "production",
  // Warehouse
  "inventory-ledger": "warehouse",
  "material-movement": "warehouse",
  "material-balance": "warehouse",
  // Quality
  "iqc-summary": "quality",
  "delivery-risk": "quality",
  "aoi-yield": "quality",
  "spi-yield": "quality",
  "oqc-summary": "quality",
  // HR & Equipment
  "attendance-summary": "hr-equipment",
  "equipment-downtime": "hr-equipment",
  "maintenance-summary": "hr-equipment",
  // Finance
  "ar-aging": "finance",
  "ap-aging": "finance",
  // Memory
  "memory-query": "memory",
  // Flint Demo
  "ict-flint-demo": "production",
  "flint-demo": "production",
  // Station Reports
  "station-reports": "production",
  "station-charts": "production",
};

// Reports that support daily/weekly/monthly granularity switcher
export const PERIOD_REPORTS: ReportTabKey[] = [
  "oee-by-line",
  "defect-analysis",
  "material-movement",
  "iqc-summary",
  "aoi-yield",
  "spi-yield",
  "oqc-summary",
  "attendance-summary",
  "equipment-downtime",
  "maintenance-summary",
];

export const reportTabKeys: ReportTabKey[] = [
  "dashboard",
  // Production
  "work-order-progress",
  "oee-by-line",
  "defect-analysis",
  // Warehouse
  "inventory-ledger",
  "material-movement",
  "material-balance",
  // Quality
  "iqc-summary",
  "delivery-risk",
  "aoi-yield",
  "spi-yield",
  "oqc-summary",
  // HR & Equipment
  "attendance-summary",
  "equipment-downtime",
  "maintenance-summary",
  // Finance
  "ar-aging",
  "ap-aging",
  // Memory
  "memory-query",
  // Flint Demo
  "ict-flint-demo",
  "flint-demo",
  // Station Reports
  "station-reports",
  "station-charts",
];

export const reportTabI18nKey: Record<ReportTabKey, string> = {
  dashboard: "reports.subtitle",
  // Production
  "work-order-progress": "report.tab.work-order-progress",
  "oee-by-line": "report.tab.oee-by-line",
  "defect-analysis": "report.tab.defect-analysis",
  // Warehouse
  "inventory-ledger": "report.tab.inventory-ledger",
  "material-movement": "report.tab.material-movement",
  "material-balance": "report.tab.material-balance",
  // Quality
  "iqc-summary": "report.tab.iqc-summary",
  "delivery-risk": "report.tab.delivery-risk",
  "aoi-yield": "report.tab.aoi-yield",
  "spi-yield": "report.tab.spi-yield",
  "oqc-summary": "report.tab.oqc-summary",
  // HR & Equipment
  "attendance-summary": "report.tab.attendance-summary",
  "equipment-downtime": "report.tab.equipment-downtime",
  "maintenance-summary": "report.tab.maintenance-summary",
  // Finance
  "ar-aging": "report.tab.ar-aging",
  "ap-aging": "report.tab.ap-aging",
  // Memory
  "memory-query": "report.tab.memory-query",
  // Flint Demo
  "ict-flint-demo": "report.tab.ict-flint-demo",
  "flint-demo": "report.tab.flint-demo",
  // Station Reports
  "station-reports": "report.tab.station-reports",
  "station-charts": "report.tab.station-charts",
};

// Domain i18n keys
export const reportDomainI18nKey: Record<ReportDomain, string> = {
  production: "report.domain.production",
  warehouse: "report.domain.warehouse",
  quality: "report.domain.quality",
  "hr-equipment": "report.domain.hr-equipment",
  finance: "report.domain.finance",
  memory: "report.domain.memory",
};

export { ReportsDashboard } from "./ReportsDashboard";
export { FlintDemo } from "./FlintDemo";
export { IctFlintDemo } from "./IctFlintDemo";
export { StationReports } from "./StationReports";
// @ts-nocheck
