import type { FactoryModule } from "../_shared/module";

export const equipmentArchivesModule: FactoryModule = {
  key: "equipment-archives",
  name: "Equipment Archives",
  owns: ["equipment archives", "equipment status history", "equipment hours log", "equipment wear history"],
  routes: [
    { method: "GET",    path: "/equipment-archives",                       summary: "List all equipment archives", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/equipment-archives/stats/summary",         summary: "Fleet-wide equipment statistics", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/equipment-archives/:id",                   summary: "Single equipment archive", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/equipment-archives/:id/status-history",    summary: "Status change history", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/equipment-archives/:id/hours-log",         summary: "Running hours log", requiredPermissions: ["maintenance.view"] },
    { method: "GET",    path: "/equipment-archives/:id/wear-history",      summary: "Wear history", requiredPermissions: ["maintenance.view"] },
  ],
};
