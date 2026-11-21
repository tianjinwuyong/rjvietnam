import type { FactoryModule } from "../_shared/module";

/**
 * Reports module — 8 report definitions backed by SQL views.
 * Route handlers delegate to the shared SQL query executor in
 * services/api/src/reports/queries.ts (created alongside this file).
 */
export const reportsModule: FactoryModule = {
  key: "reports",
  name: "Management reports",
  owns: [
    "work-order-progress",
    "inventory-ledger",
    "material-movement",
    "iqc-summary",
    "oee-by-line",
    "defect-analysis",
    "material-balance",
    "delivery-risk",
  ],
  routes: [
    // ── List / Run ─────────────────────────────────────────────
    {
      method: "GET",
      path: "/reports",
      summary: "List all available report keys and their i18n titles",
      requiredPermissions: ["reports.view"],
    },
    {
      method: "GET",
      path: "/reports/work-order-progress",
      summary: "R1 — Work order progress: planned vs completed qty, status, material readiness",
      requiredPermissions: ["reports.view"],
    },
    {
      method: "GET",
      path: "/reports/inventory-ledger",
      summary: "R2 — Inventory ledger: current stock per material lot with location",
      requiredPermissions: ["reports.view"],
    },
    {
      method: "GET",
      path: "/reports/material-movement",
      summary: "R3 — Material movement: full inventory transaction log",
      requiredPermissions: ["reports.view"],
    },
    {
      method: "GET",
      path: "/reports/iqc-summary",
      summary: "R4 — IQC summary: lot counts and qty by status per material/supplier",
      requiredPermissions: ["reports.view"],
    },
    {
      method: "GET",
      path: "/reports/oee-by-line",
      summary: "R5 — OEE by line: daily availability/performance/quality per line",
      requiredPermissions: ["reports.view"],
    },
    {
      method: "GET",
      path: "/reports/defect-analysis",
      summary: "R6 — Defect analysis: fail counts by defect code and station",
      requiredPermissions: ["reports.view"],
    },
    {
      method: "GET",
      path: "/reports/material-balance",
      summary: "R7 — Material balance: received/issued/scrapped/balance per material",
      requiredPermissions: ["reports.view"],
    },
    {
      method: "GET",
      path: "/reports/delivery-risk",
      summary: "R8 — Delivery risk: open POs with balance qty and risk level",
      requiredPermissions: ["reports.view"],
    },
    // ── Export ─────────────────────────────────────────────────
    {
      method: "GET",
      path: "/reports/:reportKey/export",
      summary: "Export a named report as CSV",
      requiredPermissions: ["reports.view"],
    },
  ],
};
