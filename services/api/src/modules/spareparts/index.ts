import type { FactoryModule } from "../_shared/module";

export const sparepartsModule: FactoryModule = {
  key: "spare-parts",
  name: "Spare Parts Warehouse & Wear Management",
  owns: ["spare parts master", "parts wear schedule", "parts consumption log", "parts wear alerts"],
  routes: [
    { method: "GET",    path: "/spare-parts",              summary: "List all parts (filterable)", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/spare-parts/low-stock",      summary: "Parts below min_stock", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/spare-parts/wear-alerts",    summary: "Active wear alerts", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/spare-parts/wear-schedule",  summary: "Parts wear schedule", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/spare-parts/consumption",     summary: "Consumption history", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/spare-parts/stats/summary",  summary: "KPI summary", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/spare-parts/:id",            summary: "Single part detail", requiredPermissions: ["maintenance.view"] },
    { method: "POST",   path: "/spare-parts",                summary: "Create a new part", requiredPermissions: ["maintenance.manage"] },
    { method: "PUT",    path: "/spare-parts/:id",            summary: "Update part", requiredPermissions: ["maintenance.manage"] },
    { method: "POST",   path: "/spare-parts/:id/consume",    summary: "Record consumption", requiredPermissions: ["maintenance.manage"] },
    { method: "PUT",    path: "/spare-parts/:id/replace",    summary: "Record part replacement", requiredPermissions: ["maintenance.manage"] },
    { method: "POST",   path: "/spare-parts/:id/acknowledge",summary: "Acknowledge alert", requiredPermissions: ["maintenance.manage"] },
    { method: "POST",   path: "/spare-parts/:id/adjust-stock",summary: "Manual stock adjustment", requiredPermissions: ["maintenance.manage"] },
  ],
};
