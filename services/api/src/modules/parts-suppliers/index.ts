import type { FactoryModule } from "../_shared/module";

export const partsSuppliersModule: FactoryModule = {
  key: "parts-suppliers",
  name: "Parts Supplier Communications",
  owns: ["parts suppliers", "parts supplier comms"],
  routes: [
    { method: "GET",    path: "/parts-suppliers",              summary: "List all parts suppliers", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/parts-supplier-comms",         summary: "List parts supplier communications", requiredPermissions: ["maintenance.view"] },
    { method: "POST",   path: "/parts-supplier-comms",         summary: "Log parts supplier communication", requiredPermissions: ["maintenance.manage"] },
  ],
};
