import type { FactoryModule } from "../_shared/module";

export const equipmentSuppliersModule: FactoryModule = {
  key: "equipment-suppliers",
  name: "Equipment Supplier Communications",
  owns: ["equipment suppliers", "equipment supplier comms"],
  routes: [
    { method: "GET",    path: "/equipment-suppliers",          summary: "List all equipment suppliers", requiredPermissions: ["maintenance.view"] },
    { method: "POST",  path: "/equipment-suppliers",           summary: "Create equipment supplier", requiredPermissions: ["maintenance.manage"] },
    { method: "GET",    path: "/equipment-supplier-comms",      summary: "List equipment supplier communications", requiredPermissions: ["maintenance.view"] },
    { method: "POST",   path: "/equipment-supplier-comms",      summary: "Log equipment supplier communication", requiredPermissions: ["maintenance.manage"] },
  ],
};
