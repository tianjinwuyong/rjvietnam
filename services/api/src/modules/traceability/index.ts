import type { FactoryModule } from "../_shared/module";

export const traceabilityModule: FactoryModule = {
  key: "traceability",
  name: "End to end traceability",
  owns: ["trace events", "PO to shipment chains", "PCB serial history", "material reel history"],
  routes: [
    {
      method: "GET",
      path: "/traceability/{traceKey}",
      summary: "Return PO, WO, PCB, reel, lot, or shipment chain",
      requiredPermissions: ["traceability.view"],
    },
    {
      method: "GET",
      path: "/traceability/events",
      summary: "List trace events for audit and troubleshooting",
      requiredPermissions: ["traceability.view"],
    },
    {
      method: "POST",
      path: "/traceability/events",
      summary: "Append auditable trace event from a normal transaction",
      requiredPermissions: ["traceability.view"],
    },
  ],
};
