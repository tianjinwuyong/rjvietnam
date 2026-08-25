import type { FactoryModule } from "../_shared/module";

export const dashboardModule: FactoryModule = {
  key: "dashboard",
  name: "Factory dashboard",
  owns: ["factory KPIs", "line status summary", "delivery and quality alerts"],
  routes: [
    {
      method: "GET",
      path: "/dashboard/summary",
      summary: "Factory dashboard metrics and live SMT line status",
      requiredPermissions: ["dashboard.view"],
    },
  ],
};
