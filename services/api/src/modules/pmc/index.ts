import type { FactoryModule } from "../_shared/module";

export const pmcModule: FactoryModule = {
  key: "pmc",
  name: "Production planning and control",
  owns: ["work orders", "11 digit work order codes", "production schedule", "delivery risk"],
  routes: [
    {
      method: "GET",
      path: "/pmc/work-orders",
      summary: "List work orders with readiness and execution status",
      requiredPermissions: ["pmc.view"],
    },
    {
      method: "POST",
      path: "/pmc/work-orders",
      summary: "Create work order and allocate preserved code",
      requiredPermissions: ["pmc.manage"],
    },
    {
      method: "PATCH",
      path: "/pmc/work-orders/{code}",
      summary: "Change work-order lifecycle state such as release, hold, close, or cancel",
      requiredPermissions: ["pmc.manage"],
    },
    {
      method: "GET",
      path: "/pmc/schedules",
      summary: "Return production schedule by line, date range, or priority",
      requiredPermissions: ["pmc.view"],
    },
    // ── BOM routes (registered under /erp prefix per api-contract) ──
    {
      method: "GET",
      path: "/erp/boms",
      summary: "List BOMs with optional productCode / status / q filter",
      requiredPermissions: ["bom.view"],
    },
    {
      method: "GET",
      path: "/erp/boms/:id",
      summary: "Get a single BOM with all lines",
      requiredPermissions: ["bom.view"],
    },
    {
      method: "GET",
      path: "/erp/boms/product/:code",
      summary: "Get latest active BOM for a product code",
      requiredPermissions: ["bom.view"],
    },
    {
      method: "POST",
      path: "/erp/boms",
      summary: "Create BOM with material lines",
      requiredPermissions: ["bom.edit"],
    },
    {
      method: "DELETE",
      path: "/erp/boms/:id",
      summary: "Delete a BOM and its lines",
      requiredPermissions: ["bom.edit"],
    },
    {
      method: "POST",
      path: "/erp/boms/import",
      summary: "Import BOM from parsed Excel data (upserts product + materials + BOM lines)",
      requiredPermissions: ["bom.edit"],
    },
    {
      method: "GET",
      path: "/erp/boms/:id/history",
      summary: "Get BOM edit history",
      requiredPermissions: ["bom.view"],
    },
    {
      method: "POST",
      path: "/erp/boms/:id/history",
      summary: "Record a BOM edit history entry",
      requiredPermissions: ["bom.edit"],
    },
  ],
};
