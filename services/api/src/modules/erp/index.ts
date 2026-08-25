import type { FactoryModule } from "../_shared/module";

export const erpModule: FactoryModule = {
  key: "erp",
  name: "ERP and commercial master data",
  owns: ["customers", "suppliers", "products", "BOMs", "customer POs", "delivery plans"],
  routes: [
    {
      method: "GET",
      path: "/erp/customer-pos",
      summary: "List customer POs by status, customer, or due date",
      requiredPermissions: ["erp.view"],
    },
    {
      method: "POST",
      path: "/erp/customer-pos",
      summary: "Create confirmed customer demand",
      requiredPermissions: ["erp.view"],
    },
    {
      method: "GET",
      path: "/erp/products",
      summary: "List product master data and active BOM revisions",
      requiredPermissions: ["erp.view"],
    },
    {
      method: "GET",
      path: "/erp/customers",
      summary: "List customer master records",
      requiredPermissions: ["erp.view"],
    },
    {
      method: "GET",
      path: "/erp/suppliers",
      summary: "List supplier master records",
      requiredPermissions: ["erp.view"],
    },
    {
      method: "GET",
      path: "/erp/materials",
      summary: "List material master records",
      requiredPermissions: ["erp.view"],
    },
    {
      method: "GET",
      path: "/erp/boms",
      summary: "List BOM headers and lines",
      requiredPermissions: ["erp.view"],
    },
  ],
};
