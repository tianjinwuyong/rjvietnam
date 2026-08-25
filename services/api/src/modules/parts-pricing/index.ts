import type { FactoryModule } from "../_shared/module";

export const partsPricingModule: FactoryModule = {
  key: "parts-pricing",
  name: "Parts Pricing Management",
  owns: ["parts pricing history", "supplier quotes"],
  routes: [
    { method: "GET",    path: "/parts-pricing",                summary: "Current prices for all parts", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/parts-pricing/stale",           summary: "Parts with stale pricing (>90 days)", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/parts-pricing/:partId/history",  summary: "Price history for a part", requiredPermissions: ["maintenance.view"] },
    { method: "POST",   path: "/parts-pricing",                 summary: "Record a new price entry", requiredPermissions: ["maintenance.manage"] },
    { method: "GET",    path: "/supplier-quotes",               summary: "List supplier quotes", requiredPermissions: ["maintenance.view"] },
    { method: "POST",   path: "/supplier-quotes",              summary: "Record a supplier quote", requiredPermissions: ["maintenance.manage"] },
  ],
};
