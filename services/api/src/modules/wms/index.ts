import type { FactoryModule } from "../_shared/module";

export const wmsModule: FactoryModule = {
  key: "wms",
  name: "Warehouse material control",
  owns: ["receiving", "IQC status", "inventory transactions", "storage", "picking", "line issue", "returns"],
  routes: [
    {
      method: "POST",
      path: "/wms/receiving/label-ai",
      summary: "Parse a receiving-label image with local Ollama vision and return editable fields",
      requiredPermissions: ["wms.execute"],
    },
    {
      method: "GET",
      path: "/wms/material-lots",
      summary: "List material lots with IQC status, reserve state, and location",
      requiredPermissions: ["wms.view"],
    },
    {
      method: "GET",
      path: "/wms/storage-locations",
      summary: "List storage locations and hold locations",
      requiredPermissions: ["wms.view"],
    },
    {
      method: "GET",
      path: "/wms/stock",
      summary: "Return derived stock balances by material, location, and IQC status",
      requiredPermissions: ["wms.view"],
    },
    {
      method: "GET",
      path: "/wms/inventory-transactions",
      summary: "List the auditable inventory ledger",
      requiredPermissions: ["wms.view"],
    },
    {
      method: "POST",
      path: "/wms/transactions",
      summary: "Append a material movement command such as receive, put-away, reserve, pick, issue, return, scrap, or adjust",
      requiredPermissions: ["wms.receive"],
    },
  ],
};
